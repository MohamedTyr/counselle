"""One more retry for a domain that shares a call with a domain-mate that DID
succeed, yet still ends up with zero stored metrics of its own.

`calling._run_call`'s own retry (`calling._retry_clusters`) only fires when
the WHOLE call came back empty or dropped a citation -- it does not catch
this narrower case, observed live: Harvard's `identity` domain, sharing a
call with `class_profile`, produced zero identity findings even though its
A0-A6 pages were fully inside the window (routing-tuning.md §2/§5). Split
into its own module purely to keep `app/cds/engine.py` under the file-size
budget -- this is still engine orchestration, not a `domain/cds/` rule.

`_RunState` is imported from `app.cds.engine` under `TYPE_CHECKING` only (not
at runtime) since `engine.py` imports this module to call
`retry_starved_domains`; a module-level runtime import here would be
circular. `app.cds.calling`/`app.cds.usage` carry no such cycle, so their
functions are imported directly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from adapters import cds_store
from app.cds import calling
from app.cds import usage as usage_mod
from domain.cds import packet_build, validators
from domain.cds import pages as pages_mod
from domain.cds.claims import Finding
from domain.cds.manifest_compile import CompiledManifest

if TYPE_CHECKING:
    from app.cds.engine import _RunState


async def retry_starved_domains(
    *,
    pool: Any,
    settings: Any,
    manifest: CompiledManifest,
    state: _RunState,
    run_contract: dict[str, Any],
    doc: cds_store.DocumentForExtraction,
    extraction: cds_store.ExtractionRecord,
    original_page_count: int,
    routing_text: dict[int, str],
    padded_ranges: dict[str, tuple[int, int]],
    doc_facts: validators.DocFacts,
    domain_findings: dict[str, list[Finding]],
    lease_lost: Any,
) -> None:
    """One retry, ISOLATED to just this domain with its own window grown one
    notch, before the run accepts the loss -- removing the shared-call
    attention confound is itself sometimes the fix. Mutates `state` in
    place; an outcome is only ever REPLACED, and only when the retry
    actually produced a storable packet.

    `domain_findings` is the main pass's already-accumulated findings per
    domain (`batch_run.collect_batch_results`'s return value) -- the retry's
    own findings are ADDED to it, never used alone, so a metric the main
    pass already saw claimed twice with disagreeing values (an honest
    `conflict` in the rebuilt packet) stays a conflict instead of being
    silently overwritten by whatever single value this isolated retry
    happens to see.

    The call itself catches `Exception` broadly, not just
    `CdsGeminiError`/`CdsPdfError` -- same rationale as
    `batch_run._run_one_batch`'s docstring: a raw transport error (observed
    live: `httpx.WriteTimeout`) can escape the SDK unwrapped, matching
    neither type. Left narrow, that error would propagate out of this
    function -> `_process_calls` -> `run_extraction`'s catch-all, which
    marks the WHOLE extraction `failed` with no `validation_summary` at all
    -- even though the main pass's packets already committed."""
    candidates = [
        domain_id
        for domain_id, outcome in state.domain_outcomes.items()
        if outcome.status is None and domain_id in padded_ranges
    ]
    for domain_id in candidates:
        if lease_lost is not None and lease_lost.is_set():
            break
        clusters = pages_mod.grow_clusters((padded_ranges[domain_id],), original_page_count)
        # Deliberately the domain's FULL metric catalog, unbached -- this
        # retry's whole point is isolating the domain from a shared-call
        # confound (module docstring), not narrowing its metric list; the
        # main run's batching (routing-tuning.md §8) already gave it that
        # chance across every one of its own batches before landing here.
        domain_metrics = tuple(
            packet_build.domain_metric_definitions(manifest.content, domain_id).values()
        )
        try:
            attempt = await calling._run_call_once(
                settings=settings,
                manifest_content=manifest.content,
                pdf_content=doc.pdf_content,
                original_page_count=original_page_count,
                routing_text=routing_text,
                batch_metrics=domain_metrics,
                clusters=clusters,
                page_text=doc_facts.page_text,
            )
        except Exception as exc:  # noqa: BLE001 -- see docstring above
            error_record = {"domains": [domain_id], "starved_retry": True, "error": str(exc)}
            state.call_records.append(error_record)
            continue
        state.usage_total = usage_mod._add_usage(state.usage_total, attempt.usage)
        state.call_records.append(
            {
                "domains": [domain_id],
                "narrowed": attempt.narrowed,
                "pages_sent": attempt.pages_sent,
                "retried": True,
                "latency_seconds": round(attempt.latency_seconds, 1),
                "findings": len(attempt.remapped_findings),
                "usage": usage_mod._usage_dict(attempt.usage),
                "error": None,
                "starved_retry": True,
            }
        )
        if not attempt.remapped_findings:
            continue
        # ADD to the main pass's findings for this domain, never replace them --
        # otherwise a metric the main pass already resolved as `conflict` (module
        # docstring: an honesty signal, not noise) would be rebuilt from this
        # retry's single value alone and come out looking like a clean, confident
        # `verified` fact.
        merged_findings = domain_findings.get(domain_id, []) + attempt.remapped_findings
        outcome = await calling._build_and_store_domain_packet(
            pool=pool,
            settings=settings,
            manifest=manifest,
            domain_id=domain_id,
            findings=merged_findings,
            run_contract=run_contract,
            doc=doc,
            extraction=extraction,
            model_id=attempt.model_id,
            original_page_count=original_page_count,
            doc_facts=doc_facts,
        )
        if outcome.status is not None:
            state.domain_outcomes[domain_id] = outcome


__all__ = ["retry_starved_domains"]
