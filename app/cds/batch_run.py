"""Runs every batch (routing-tuning.md §8, decision 7) with bounded
concurrency, folds the results into per-domain accumulated findings, and
stores one packet per domain -- split out of `app/cds/engine.py` purely to
keep it under the file-size budget, mirroring why `citation_remap.py`/
`starved_retry.py` already exist as their own modules.

`_RunState` is imported from `app.cds.engine` under `TYPE_CHECKING` only (not
at runtime) since `engine.py` imports this module to call `run_batches` and
`store_domain_packets`; a module-level runtime import here would be
circular. `app.cds.calling`/`app.cds.usage` carry no such cycle, so their
functions are imported directly.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

import asyncpg

from adapters import cds_store
from app.cds import batching
from app.cds import usage as usage_mod
from app.cds.calling import DomainOutcome, _build_and_store_domain_packet, _CallResult, _run_call
from domain.cds import validators
from domain.cds.claims import Finding
from domain.cds.manifest_compile import CompiledManifest

if TYPE_CHECKING:
    from app.cds.engine import _RunState

# Batching multiplies one run's call count roughly 6-10x (a ~25-metric
# ceiling against domains with up to 169 metrics). Bounded concurrency keeps
# wall-clock from multiplying by the same factor; each call opens its own
# PyMuPDF document from immutable bytes and its own genai.Client
# (adapters/cds_pdf.py, adapters/cds_gemini.py), so concurrent calls share
# no mutable state. Not unlimited -- this is a shared Vertex Express Mode
# credential (recon-vertex.md §1), so a bound keeps one run from
# monopolizing it.
_MAX_CONCURRENT_BATCH_CALLS = 6

BatchOutcome = tuple[batching.Batch, "_CallResult | None", "str | None"]


async def _run_one_batch(
    batch: batching.Batch,
    *,
    settings: Any,
    manifest_content: dict[str, Any],
    pdf_content: bytes,
    original_page_count: int,
    routing_text: dict[int, str],
    padded_ranges: dict[str, tuple[int, int]],
    page_text: Mapping[int, str] | None,
    semaphore: asyncio.Semaphore,
    lease_lost: Any,
) -> BatchOutcome:
    """One batch's call under the run's shared concurrency bound. Isolates
    one batch's failure from the rest of the run (plan §B4: "Per-domain
    isolation: one domain's failure must not kill the run"), returning
    `(batch, None, error)` instead of raising.

    Catches `Exception` broadly, not just `CdsGeminiError`/`CdsPdfError` --
    `adapters/cds_gemini.py`'s own docstring claims every failure surfaces
    as a typed `CdsGeminiError`, but a raw transport error from the
    underlying SDK call (observed live: `httpx.WriteTimeout` propagating
    unwrapped past the SDK's own internal retries) is neither. Batching
    raised the odds of hitting this: ~5-9x more concurrent calls per run
    than the pre-batching engine means a single transient network blip is
    now common enough to matter, and an uncaught exception from one batch
    inside `asyncio.gather` cancels every OTHER in-flight batch too --
    observed live, a 17-batch group lost all 17 batches (cost=$0, calls=0)
    to one flaky call. `asyncio.CancelledError` is a `BaseException`, not an
    `Exception`, so real task cancellation still propagates correctly."""
    async with semaphore:
        if lease_lost is not None and lease_lost.is_set():
            return batch, None, "lease_lost"
        try:
            result = await _run_call(
                settings=settings,
                manifest_content=manifest_content,
                pdf_content=pdf_content,
                original_page_count=original_page_count,
                routing_text=routing_text,
                batch_metrics=batch.metrics,
                window_key=batch.key,
                padded_ranges=padded_ranges,
                page_text=page_text,
            )
        except Exception as exc:  # noqa: BLE001 -- isolates one batch, see docstring above
            return batch, None, f"{type(exc).__name__}: {exc}"
        return batch, result, None


async def run_batches(
    batches: list[batching.Batch], *, lease_lost: Any, **call_kwargs: Any
) -> list[BatchOutcome]:
    """Every batch's call, bounded by `_MAX_CONCURRENT_BATCH_CALLS` -- how
    decision 7 keeps a ~6-10x call-count multiplier from also multiplying
    wall-clock by the same factor. `call_kwargs` forwards straight to
    `calling._run_call` via `_run_one_batch` (settings/manifest_content/
    pdf_content/original_page_count/routing_text/padded_ranges/page_text).

    `return_exceptions=True` is defense in depth on top of `_run_one_batch`'s
    own broad `except Exception` -- belt-and-suspenders so that even an
    exception raised outside that try block (e.g. while acquiring the
    semaphore) can never cancel every other in-flight batch via
    `asyncio.gather`'s default fail-fast behavior."""
    semaphore = asyncio.Semaphore(_MAX_CONCURRENT_BATCH_CALLS)
    raw_results = await asyncio.gather(
        *(
            _run_one_batch(batch, semaphore=semaphore, lease_lost=lease_lost, **call_kwargs)
            for batch in batches
        ),
        return_exceptions=True,
    )
    return [
        (batch, None, f"{type(result).__name__}: {result}")
        if isinstance(result, BaseException)
        else result
        for batch, result in zip(batches, raw_results, strict=True)
    ]


def batch_call_record(batch: batching.Batch, call_result: _CallResult) -> dict[str, Any]:
    return {
        "domain": batch.domain_id,
        "batch_index": batch.batch_index,
        "hints": sorted(batch.hints),
        "metric_count": len(batch.metrics),
        "narrowed": call_result.narrowed,
        "pages_sent": call_result.pages_sent,
        "retried": call_result.retried,
        "latency_seconds": round(call_result.latency_seconds, 1),
        "findings": len(call_result.findings),
        "usage": {
            "prompt_tokens": call_result.usage.prompt_tokens,
            "output_tokens": call_result.usage.output_tokens,
            "thoughts_tokens": call_result.usage.thoughts_tokens,
            "cached_tokens": call_result.usage.cached_tokens,
            "total_tokens": call_result.usage.total_tokens,
        },
        "error": None,
    }


def collect_batch_results(
    results: list[BatchOutcome], state: _RunState, requested_domains: list[str]
) -> dict[str, list[Finding]]:
    """Fold every batch's outcome into `state.call_records`/`usage_total`
    and return each domain's accumulated findings across all of its own
    batches -- the input `store_domain_packets` needs, since a domain's
    packet is built once from its FULL claim set, never once per batch (a
    metric's `verified`/`conflict` resolution needs every claim that could
    touch it)."""
    domain_findings: dict[str, list[Finding]] = {domain_id: [] for domain_id in requested_domains}
    for batch, call_result, error in results:
        if error is not None or call_result is None:
            state.call_records.append(
                {"domain": batch.domain_id, "batch_index": batch.batch_index, "error": error}
            )
            continue
        state.usage_total = usage_mod._add_usage(state.usage_total, call_result.usage)
        state.call_records.append(batch_call_record(batch, call_result))
        domain_findings[batch.domain_id].extend(call_result.findings)
    return domain_findings


async def store_domain_packets(
    *,
    pool: asyncpg.Pool,
    settings: Any,
    manifest: CompiledManifest,
    requested_domains: list[str],
    domain_findings: dict[str, list[Finding]],
    run_contract: dict[str, Any],
    doc: cds_store.DocumentForExtraction,
    extraction: cds_store.ExtractionRecord,
    original_page_count: int,
    doc_facts: validators.DocFacts,
    model_id: str,
) -> dict[str, DomainOutcome]:
    """One packet per requested domain, built from that domain's ENTIRE
    accumulated findings across every one of its batches."""
    outcomes: dict[str, DomainOutcome] = {}
    for domain_id in requested_domains:
        outcomes[domain_id] = await _build_and_store_domain_packet(
            pool=pool,
            settings=settings,
            manifest=manifest,
            domain_id=domain_id,
            findings=domain_findings[domain_id],
            run_contract=run_contract,
            doc=doc,
            extraction=extraction,
            model_id=model_id,
            original_page_count=original_page_count,
            doc_facts=doc_facts,
        )
    return outcomes


__all__ = [
    "BatchOutcome",
    "batch_call_record",
    "collect_batch_results",
    "run_batches",
    "store_domain_packets",
]
