"""Offline CDS-extraction runner: one local PDF, an explicit config, JSON out.

Bypasses `app/cds/engine.py:_prepare_run`/`run_extraction` entirely (both are
DB-bound) and instead builds the same inputs by hand from local PDF bytes,
then drives the real batching/routing/model-call/retry seam
(`app/cds/batching.py`, `app/cds/batch_run.py`, `app/cds/engine.py`'s private
`_route_batches`/`_route_domains`/`_run_call_once`) directly. It NEVER calls
`batch_run.store_domain_packets` or `app/cds/starved_retry.py` (both write
`cds_library` through `adapters/cds_store.py`) -- see `_run_starved_retry`
below, a harness-local reimplementation of the starved-retry *call*, minus
the packet build/store half.

No DB pool is ever constructed or acquired anywhere in this file. Grep this
file for `cds_store`/`asyncpg`/`pool` to confirm -- the only reason
`cds_store` appears anywhere in the import graph is that `app.cds.engine`
and `app.cds.batch_run` import it themselves (for the code paths this
harness deliberately never calls); this file never imports or references it.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

from app.cds import batch_run, batching  # noqa: E402
from app.cds import engine as cds_engine  # noqa: E402
from app.cds import manifest as manifest_mod  # noqa: E402
from adapters import cds_pdf  # noqa: E402
from config.settings import get_settings  # noqa: E402
from domain.cds import pages as pages_mod  # noqa: E402
from domain.cds.manifest_compile import CompiledManifest  # noqa: E402

RUNS_DIR = ROOT / "plans" / "cds-pipeline" / "tuning" / "runs"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path, help="local CDS PDF path")
    parser.add_argument("--label", required=True, help="experiment name; output subdirectory")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=manifest_mod.DEFAULT_METRIC_BATCH_SIZE,
        help=f"override manifest.DEFAULT_METRIC_BATCH_SIZE ({manifest_mod.DEFAULT_METRIC_BATCH_SIZE})",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=batch_run._MAX_CONCURRENT_BATCH_CALLS,  # noqa: SLF001 -- read only, for the default
        help="override batch_run._MAX_CONCURRENT_BATCH_CALLS",
    )
    parser.add_argument(
        "--domains",
        default=None,
        help="comma-separated domain ids (default: every domain in the compiled manifest)",
    )
    parser.add_argument("--model", default=None, help="override settings.model_cds_extract")
    parser.add_argument(
        "--thinking-budget",
        type=int,
        default=None,
        help="override settings.model_cds_extract_thinking_budget (0 disables, -1 auto)",
    )
    parser.add_argument(
        "--deliberation-budget",
        type=int,
        default=None,
        help="override settings.model_cds_extract_deliberation_budget (0 = no batch gets the "
        "extra budget; applies only to batches with a hint in manifest.DELIBERATION_HINTS)",
    )
    parser.add_argument(
        "--deliberation-level",
        default=None,
        help="override settings.model_cds_extract_deliberation_level (a types.ThinkingLevel "
        "name, e.g. 'low'; takes precedence over --deliberation-budget for deliberation-"
        "hinted batches when set)",
    )
    parser.add_argument(
        "--prompt-variant",
        type=Path,
        default=None,
        help="file whose text replaces manifest_content['prompt'] for this run",
    )
    parser.add_argument(
        "--starved-retry",
        action="store_true",
        help="run the isolated per-domain retry for domains left with zero findings",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print the batch plan and exit; zero model calls, zero DB access",
    )
    return parser.parse_args(argv)


def _build_batches(
    manifest: CompiledManifest, domain_ids: list[str], batch_size: int
) -> list[batching.Batch]:
    """`batching.batches_for_domains`'s own loop, reimplemented here only to
    thread a custom `max_batch_size` through -- `metric_batches_for_domain`
    (`app/cds/manifest.py:92`) already accepts that parameter; only
    `batches_for_domains` (`app/cds/batching.py:40`) hardcodes the omission
    by never forwarding it. See the harness report for the one-line engine
    change that would make this wrapper unnecessary."""
    batches: list[batching.Batch] = []
    for domain_id in domain_ids:
        chunks = manifest_mod.metric_batches_for_domain(manifest, domain_id, max_batch_size=batch_size)
        for index, metrics in enumerate(chunks):
            hints = frozenset(hint for metric in metrics for hint in metric["source_hints"])
            batches.append(batching.Batch(domain_id, index, metrics, hints))
    return batches


def _resolve_domains(manifest: CompiledManifest, requested: str | None) -> list[str]:
    all_ids = list(manifest_mod.domain_ids(manifest))
    if not requested:
        return all_ids
    wanted = [d.strip() for d in requested.split(",") if d.strip()]
    unknown = [d for d in wanted if d not in all_ids]
    if unknown:
        raise SystemExit(f"unknown domain id(s): {unknown}; manifest has {all_ids}")
    return wanted


def _batch_pages_sent(batch: batching.Batch, padded_ranges: dict[str, tuple[int, int]], page_count: int) -> tuple[tuple[int, int], ...] | None:
    clusters = pages_mod.page_clusters_for_group((batch.key,), padded_ranges)
    return clusters or None  # None means whole-document fallback


def _print_dry_run_plan(
    *,
    batches: list[batching.Batch],
    padded_ranges: dict[str, tuple[int, int]],
    page_count: int,
) -> None:
    print(f"document pages: {page_count}")
    print(f"total planned calls: {len(batches)}")
    total_pages_sent = 0
    by_domain: dict[str, list[batching.Batch]] = {}
    for batch in batches:
        by_domain.setdefault(batch.domain_id, []).append(batch)
    for domain_id, domain_batches in by_domain.items():
        print(f"\ndomain {domain_id}: {len(domain_batches)} batch(es)")
        for batch in domain_batches:
            clusters = _batch_pages_sent(batch, padded_ranges, page_count)
            if clusters is None:
                pages_sent = page_count
                span = "whole-document fallback (routing miss)"
            else:
                pages_sent = sum(end - start + 1 for start, end in clusters)
                span = ", ".join(f"{start}-{end}" for start, end in clusters)
            total_pages_sent += pages_sent
            print(
                f"  batch {batch.batch_index}: {len(batch.metrics)} metrics, "
                f"hints={sorted(batch.hints)}, routed pages=[{span}], pages_sent={pages_sent}"
            )
    print(f"\ntotal planned page-sends: {total_pages_sent}")


async def _run_starved_retry(
    *,
    settings: Any,
    manifest_content: dict[str, Any],
    pdf_bytes: bytes,
    original_page_count: int,
    routing_text: dict[int, str],
    domain_findings: dict[str, list[Any]],
    state: Any,
    requested_domains: list[str],
    corrupt_text_layer: bool,
) -> None:
    """Harness-local counterpart to `app/cds/starved_retry.py`: the same
    isolated-retry *call* (`engine._run_call_once` with a grown, domain-only
    window and the domain's full metric catalog, unbatched) for any domain
    still empty after the batch pass -- but stops after collecting findings,
    never calling `engine._build_and_store_domain_packet` (a DB write)."""
    page_text = {} if corrupt_text_layer else routing_text
    domain_routing = cds_engine._route_domains(manifest_content, routing_text)  # noqa: SLF001
    padded_ranges = pages_mod.padded_domain_ranges(domain_routing, original_page_count)
    starved = [
        domain_id
        for domain_id in requested_domains
        if not domain_findings.get(domain_id) and domain_id in padded_ranges
    ]
    for domain_id in starved:
        clusters = pages_mod.grow_clusters((padded_ranges[domain_id],), original_page_count)
        domain = next(d for d in manifest_content["domains"] if d["id"] == domain_id)
        domain_metrics = tuple(domain["metrics"])
        try:
            attempt = await cds_engine._run_call_once(  # noqa: SLF001
                settings=settings,
                manifest_content=manifest_content,
                pdf_content=pdf_bytes,
                original_page_count=original_page_count,
                routing_text=routing_text,
                batch_metrics=domain_metrics,
                clusters=clusters,
                page_text=page_text,
            )
        except Exception as exc:  # noqa: BLE001 -- isolate one starved domain's failure
            state.call_records.append(
                {"domain": domain_id, "starved_retry": True, "error": f"{type(exc).__name__}: {exc}"}
            )
            continue
        state.usage_total = cds_engine._add_usage(state.usage_total, attempt.usage)  # noqa: SLF001
        state.call_records.append(
            {
                "domain": domain_id,
                "starved_retry": True,
                "narrowed": attempt.narrowed,
                "pages_sent": attempt.pages_sent,
                "findings": len(attempt.remapped_findings),
                "latency_seconds": round(attempt.latency_seconds, 1),
                "usage": cds_engine._usage_dict(attempt.usage),  # noqa: SLF001
                "error": None,
            }
        )
        domain_findings[domain_id].extend(attempt.remapped_findings)


async def _run(args: argparse.Namespace) -> None:
    pdf_bytes = args.pdf.read_bytes()
    sha256 = hashlib.sha256(pdf_bytes).hexdigest()

    manifest = manifest_mod.load_compiled_manifest()
    manifest_content = dict(manifest.content)
    if args.prompt_variant is not None:
        manifest_content["prompt"] = args.prompt_variant.read_text(encoding="utf-8")

    domains = _resolve_domains(manifest, args.domains)

    original_page_count = await cds_pdf.get_page_count(pdf_bytes)
    corrupt_report = await cds_pdf.detect_corrupt_text_layer(pdf_bytes)
    routing_text = await cds_pdf.extract_routing_text(pdf_bytes)

    batches = _build_batches(manifest, domains, args.batch_size)
    batch_routing = cds_engine._route_batches(routing_text, batches)  # noqa: SLF001
    padded_ranges = pages_mod.padded_domain_ranges(batch_routing, original_page_count)

    if args.dry_run:
        _print_dry_run_plan(batches=batches, padded_ranges=padded_ranges, page_count=original_page_count)
        return

    out_dir = RUNS_DIR / args.label
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.pdf.stem}.json"
    if out_path.exists():
        raise SystemExit(
            f"refusing to overwrite existing run file (runs cost money): {out_path}\n"
            "pick a different --label or move/delete the existing file first."
        )

    settings = get_settings()
    settings_update: dict[str, Any] = {}
    if args.model:
        settings_update["model_cds_extract"] = args.model
    if args.thinking_budget is not None:
        settings_update["model_cds_extract_thinking_budget"] = args.thinking_budget
    if args.deliberation_budget is not None:
        settings_update["model_cds_extract_deliberation_budget"] = args.deliberation_budget
    if args.deliberation_level is not None:
        settings_update["model_cds_extract_deliberation_level"] = args.deliberation_level
    if settings_update:
        settings = settings.model_copy(update=settings_update)

    batch_run._MAX_CONCURRENT_BATCH_CALLS = args.concurrency  # noqa: SLF001 -- harness override, see report

    state = cds_engine._RunState(  # noqa: SLF001
        domain_outcomes={}, call_records=[], usage_total=cds_engine._zero_usage()  # noqa: SLF001
    )
    errors: list[str] = []
    started = time.monotonic()
    try:
        page_text = {} if corrupt_report.is_corrupt else routing_text
        results = await batch_run.run_batches(
            batches,
            lease_lost=None,
            settings=settings,
            manifest_content=manifest_content,
            pdf_content=pdf_bytes,
            original_page_count=original_page_count,
            routing_text=routing_text,
            padded_ranges=padded_ranges,
            page_text=page_text,
        )
        domain_findings = batch_run.collect_batch_results(results, state, domains)

        if args.starved_retry:
            await _run_starved_retry(
                settings=settings,
                manifest_content=manifest_content,
                pdf_bytes=pdf_bytes,
                original_page_count=original_page_count,
                routing_text=routing_text,
                domain_findings=domain_findings,
                state=state,
                requested_domains=domains,
                corrupt_text_layer=corrupt_report.is_corrupt,
            )
    except Exception as exc:  # noqa: BLE001 -- always dump whatever we have, even on a hard failure
        errors.append(f"{type(exc).__name__}: {exc}")
        domain_findings = {}
    duration_seconds = time.monotonic() - started

    errors.extend(
        f"{record.get('domain', record.get('domains'))}: {record['error']}"
        for record in state.call_records
        if record.get("error")
    )

    findings_out = [
        {"domain": domain_id, **finding.model_dump()}
        for domain_id, findings in domain_findings.items()
        for finding in findings
    ]

    output = {
        "config": {
            "pdf_path": str(args.pdf),
            "batch_size": args.batch_size,
            "concurrency": args.concurrency,
            "domains": domains,
            "model": settings.model_cds_extract,
            "thinking_budget": settings.model_cds_extract_thinking_budget,
            "deliberation_budget": settings.model_cds_extract_deliberation_budget,
            "deliberation_level": settings.model_cds_extract_deliberation_level,
            "prompt_variant": str(args.prompt_variant) if args.prompt_variant else None,
            "starved_retry": args.starved_retry,
            "label": args.label,
        },
        "document": {
            "path": str(args.pdf),
            "name": args.pdf.name,
            "page_count": original_page_count,
            "sha256": sha256,
            "corrupt_text_layer": corrupt_report.is_corrupt,
        },
        "findings": findings_out,
        "calls": state.call_records,
        "usage_total": cds_engine._usage_dict(state.usage_total),  # noqa: SLF001
        "cost_usd_estimate": cds_engine._estimate_cost_usd(state.usage_total),  # noqa: SLF001
        "duration_seconds": round(duration_seconds, 1),
        "domains_requested": domains,
        "errors": errors,
    }
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_path}")
    print(f"findings={len(findings_out)} calls={len(state.call_records)} "
          f"cost_usd_estimate={output['cost_usd_estimate']} duration_s={output['duration_seconds']}")


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    asyncio.run(_run(args))


if __name__ == "__main__":
    main()
