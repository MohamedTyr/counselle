"""The extraction run: route pages, call the model per extraction group,
remap citations, run validators, build packets, write them (plan §B4).

Orchestration only (ADR 0017) -- no SQL and no model calls live here; every
I/O call goes through `adapters/cds_gemini.py`, `adapters/cds_pdf.py`, or
`adapters/cds_store.py`, and every rule (packet shape, validators, page math)
comes from `domain/cds/`. `app/cds/jobs.py` claims a `cds_extractions` row and
calls `run_extraction` once per claimed job; this module never touches the
lease/claim machinery itself beyond checking the cooperative `lease_lost`
signal jobs.py sets when its background renewal fails.

**Spike-settled decisions this module implements exactly** (see
`specs/cds-pipeline/plan/spike-part-a.md` / `spike-part-b.md`):

1. Always page-narrow when routing finds the requested domains' CDS section
   codes; whole-document is the fallback when routing comes up empty, never
   the default (40-57% cheaper, and the only thing that works at all on the
   corpus's largest files -- every file >=4.8MB failed 9/9 whole-document
   attempts with `httpx.WriteTimeout`).
2. A narrowed call's `page_number` is never trusted as an original physical
   page -- 90% of narrowed findings in the spike cited the sub-PDF position
   instead, despite an explicit in-prompt remap table. Every citation is
   translated through the deterministic `page_map` in code
   (`citation_remap.remap_findings` / `pages.resolve_cited_page`), which also
   accepts the minority of citations that already name the correct original
   page (routing-tuning.md §1/§3), tie-broken by excerpt content when a raw
   number is valid under both readings, instead of dropping them.
3. The C7 checkbox grid uses one strategy for every document class: the
   routed C7 page narrowed to a 1-page sub-PDF (native vision already reads
   checkbox/table content with no textual mark at all). A 150 DPI PNG of the
   same page is sent alongside it as a targeted supplement, never a
   replacement, never 300 DPI (identical tokens, 3x latency, zero gain).
4. No self-consistency voting -- `gemini-3.1-flash-lite` was byte-identical
   across repeated runs at `temperature=0` in the spike; one call per group.
5. Excerpt verification is conditioned on text-layer health: when
   `detect_corrupt_text_layer` fires, `page_text` is withheld from
   `DocFacts` so `excerpt_on_cited_page` no-ops (its per-page lookup returns
   `None` -> skip) instead of flagging 100%-accurate, visually-read values as
   fabricated citations -- exactly Caltech's failure mode in the spike, where
   all 10 "fabricated" citations were independently confirmed correct.
6. Retry policy (routing-tuning.md §3/§4, added after a live Harvard run
   stored packets for only 5/13 domains): a narrowed call with zero
   findings, or a dropped out-of-range citation, gets ONE retry against a
   wider window (`_run_call`/`_retry_clusters`) before the engine accepts
   the loss. A domain still empty after that -- e.g. it shared a call with
   a domain-mate that DID succeed -- gets one isolated single-domain retry;
   see `app/cds/starved_retry.py`. Dropping stays the last resort.
7. Per-metric batching (routing-tuning.md §8): a call asking for a whole
   domain's metric catalog at once measured near-zero recall on large
   domains (e.g. `admissions`, 2/152 verified), while spike-part-a.md
   measured 99.3% accuracy on a ~25-metric schema. Every domain's catalog is
   split into `app.cds.batching.Batch`es of at most
   `manifest.DEFAULT_METRIC_BATCH_SIZE` metrics -- one CDS section per
   batch, chunked further only when a section alone exceeds that ceiling,
   and `manifest.DELIBERATION_HINTS` sections isolated into batches of their
   own -- each with its OWN narrowed page window routed from just that batch's
   `source_hints`. One call per batch, bounded-concurrency
   (`app/cds/batch_run.py`) so call count multiplying ~6-10x does not also
   multiply wall-clock the same amount. Findings from every batch belonging
   to one domain accumulate before that domain's packet is built once, at
   the end of the run -- never one packet per batch.

The routing/prompt-construction machinery lives in `app/cds/routing.py`, one
model call plus its retry policy and resulting packet in
`app/cds/calling.py`, and usage/cost accumulation in `app/cds/usage.py` --
all three split out of this module purely to keep it under the file-size
budget; this module remains the orchestrator that sequences them.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Literal

import asyncpg
import structlog

from adapters import cds_gemini, cds_pdf, cds_store
from app.cds import batch_run, batching, starved_retry
from app.cds import manifest as manifest_mod
from app.cds.calling import DomainOutcome
from app.cds.routing import _route_batches, _route_domains
from app.cds.usage import _estimate_cost_usd, _usage_dict, _zero_usage
from domain.cds import packet_build, validators
from domain.cds.manifest_compile import CompiledManifest
from domain.cds.pages import padded_domain_ranges

logger = structlog.get_logger(__name__)

# The write path's identity for every model-produced packet (plan §A3): a
# distinct string from the ported pipeline's `gemini-routed-extraction-v8`,
# because reusing that identity for a different engine would make the
# provenance label a lie (AGENTS.md principle 3). `human-review-v1` is a
# separate identity used only by the (not-yet-built) correction service.
EXTRACTOR_VERSION = "counselle-cds-v1"


@dataclass
class _RunState:
    domain_outcomes: dict[str, DomainOutcome]
    call_records: list[dict[str, Any]]
    usage_total: cds_gemini.Usage


def _observed_model_id(results: list[batch_run.BatchOutcome], settings: Any) -> str:
    """One model id for the whole run: every batch call uses the same fixed
    `settings.model_cds_extract` (decision 4 -- no per-call model choice), so
    the actually-observed id from any successful call is equivalent to
    deriving it from settings directly; prefer the observed one when at
    least one batch succeeded, falling back to the settings string only when
    every batch in the entire run failed (nothing observed at all)."""
    observed_model_id = next(
        (
            call_result.model_id
            for _, call_result, error in results
            if error is None and call_result
        ),
        None,
    )
    return observed_model_id or settings.model_cds_extract.split(":", 1)[-1]


async def _process_calls(
    *,
    pool: asyncpg.Pool,
    settings: Any,
    manifest: CompiledManifest,
    batches: list[batching.Batch],
    requested_domains: list[str],
    run_contract: dict[str, Any],
    doc: cds_store.DocumentForExtraction,
    extraction: cds_store.ExtractionRecord,
    original_page_count: int,
    routing_text: dict[int, str],
    batch_padded_ranges: dict[str, tuple[int, int]],
    domain_padded_ranges: dict[str, tuple[int, int]],
    doc_facts: validators.DocFacts,
    lease_lost: Any,
) -> _RunState:
    """Run every batch (decision 7) with bounded concurrency, accumulate each
    domain's findings across all of its own batches, then build + store one
    packet per requested domain -- never one packet per batch. Hands off to
    `starved_retry.retry_starved_domains` (still domain-level, using
    `domain_padded_ranges`, not the per-batch windows) for anything still
    empty afterward.

    `lease_lost` is checked once more here, between the batch calls and the
    packet writes: `batch_run._run_one_batch` only consults it BEFORE each
    model call, so a worker whose lease expired mid-run can still reach this
    point having made every call it was going to make. Writing packets built
    from a run the lease sweep may have already marked `failed` would commit
    a half-executed document with no record of what got skipped (plan §E) --
    so a lost lease here skips `store_domain_packets` and the starved retry
    entirely and returns whatever's already in `state` (no outcomes), rather
    than risk even a partial commit. `insert_packet` also fences on the
    lease itself (`adapters/cds_store.py`) as defense in depth, since this
    check and the store loop that follows are not atomic with each other."""
    state = _RunState(domain_outcomes={}, call_records=[], usage_total=_zero_usage())
    results = await batch_run.run_batches(
        batches,
        lease_lost=lease_lost,
        settings=settings,
        manifest_content=manifest.content,
        pdf_content=doc.pdf_content,
        original_page_count=original_page_count,
        routing_text=routing_text,
        padded_ranges=batch_padded_ranges,
        page_text=doc_facts.page_text,
    )
    domain_findings = batch_run.collect_batch_results(results, state, requested_domains)
    if lease_lost is not None and lease_lost.is_set():
        return state
    model_id = _observed_model_id(results, settings)

    state.domain_outcomes = await batch_run.store_domain_packets(
        pool=pool,
        settings=settings,
        manifest=manifest,
        requested_domains=requested_domains,
        domain_findings=domain_findings,
        run_contract=run_contract,
        doc=doc,
        extraction=extraction,
        original_page_count=original_page_count,
        doc_facts=doc_facts,
        model_id=model_id,
    )

    await starved_retry.retry_starved_domains(
        pool=pool,
        settings=settings,
        manifest=manifest,
        state=state,
        run_contract=run_contract,
        doc=doc,
        extraction=extraction,
        original_page_count=original_page_count,
        routing_text=routing_text,
        padded_ranges=domain_padded_ranges,
        doc_facts=doc_facts,
        domain_findings=domain_findings,
        lease_lost=lease_lost,
    )
    return state


def _overall_status(
    domain_outcomes: dict[str, DomainOutcome],
) -> Literal["succeeded", "partial", "failed"]:
    stored = sum(1 for outcome in domain_outcomes.values() if outcome.status is not None)
    if stored == 0:
        return "failed"
    if stored == len(domain_outcomes):
        return "succeeded"
    return "partial"


async def _finish_failed(
    pool: asyncpg.Pool, extraction_id: Any, error_code: str, error_message: str
) -> None:
    try:
        async with pool.acquire() as conn:
            await cds_store.complete_extraction(
                conn,
                extraction_id=extraction_id,
                status="failed",
                error_code=error_code,
                error_message=error_message[:2000],
            )
    except cds_store.LeaseLostError:
        logger.warning("cds_extraction_lease_lost_at_completion", extraction_id=str(extraction_id))


@dataclass(frozen=True)
class _RunInputs:
    manifest: CompiledManifest
    doc: cds_store.DocumentForExtraction
    requested_domains: list[str]
    batches: list[batching.Batch]
    run_contract: dict[str, Any]
    original_page_count: int
    routing_text: dict[int, str]
    batch_padded_ranges: dict[str, tuple[int, int]]
    domain_padded_ranges: dict[str, tuple[int, int]]
    doc_facts: validators.DocFacts
    corrupt_text_layer: bool


async def _prepare_run(
    pool: asyncpg.Pool, manifest: CompiledManifest, extraction: cds_store.ExtractionRecord
) -> _RunInputs:
    """Everything every call in this run shares: PDF bytes, the batch plan
    (decision 7), the run-wide provider contract (built ONCE -- plan §B4),
    routing/corruption facts, and the validators' `DocFacts`."""
    async with pool.acquire() as conn:
        doc = await cds_store.fetch_document_for_extraction(
            conn, document_id=extraction.document_id
        )
    # `calls_for_domains` still validates every requested domain is covered
    # by the manifest's extraction-group partition (an authoring-time
    # invariant) even though batching no longer groups calls by it -- see
    # decision 7's docstring note.
    calls = manifest_mod.calls_for_domains(manifest, extraction.requested_domains)
    requested_domains = [domain_id for group in calls for domain_id in group]
    run_contract = packet_build.provider_contract(manifest.content, extraction.requested_domains)
    original_page_count = await cds_pdf.get_page_count(doc.pdf_content)
    corrupt_report = await cds_pdf.detect_corrupt_text_layer(doc.pdf_content)
    routing_text = await cds_pdf.extract_routing_text(doc.pdf_content)
    batches = batching.batches_for_domains(manifest, requested_domains)
    batch_padded_ranges = padded_domain_ranges(
        _route_batches(routing_text, batches), original_page_count
    )
    domain_padded_ranges = padded_domain_ranges(
        _route_domains(manifest.content, routing_text), original_page_count
    )
    doc_facts = validators.DocFacts(
        # Decision 5: withhold page_text entirely on a corrupt text layer so
        # excerpt_on_cited_page no-ops per metric instead of flagging
        # visually-correct values as fabricated citations.
        page_text={} if corrupt_report.is_corrupt else routing_text,
        corrupt_text_layer=corrupt_report.is_corrupt,
        expected_academic_year=doc.academic_year,
    )
    return _RunInputs(
        manifest=manifest,
        doc=doc,
        requested_domains=requested_domains,
        batches=batches,
        run_contract=run_contract,
        original_page_count=original_page_count,
        routing_text=routing_text,
        batch_padded_ranges=batch_padded_ranges,
        domain_padded_ranges=domain_padded_ranges,
        doc_facts=doc_facts,
        corrupt_text_layer=corrupt_report.is_corrupt,
    )


async def _finalize_run(
    pool: asyncpg.Pool,
    extraction: cds_store.ExtractionRecord,
    state: _RunState,
    *,
    corrupt_text_layer: bool,
    duration_seconds: float,
) -> None:
    status = _overall_status(state.domain_outcomes)
    validation_summary = {
        "extractor_version": extraction.extractor_version,
        "requested_domains": list(extraction.requested_domains),
        "corrupt_text_layer": corrupt_text_layer,
        "duration_seconds": round(duration_seconds, 1),
        "calls": state.call_records,
        "usage_total": _usage_dict(state.usage_total),
        "cost_usd_estimate": _estimate_cost_usd(state.usage_total),
        "domains": {
            domain_id: {
                "status": outcome.status,
                "counts": outcome.counts,
                "flags": outcome.flags,
                "error": outcome.error,
            }
            for domain_id, outcome in state.domain_outcomes.items()
        },
    }
    failed = status == "failed"
    try:
        async with pool.acquire() as conn:
            await cds_store.complete_extraction(
                conn,
                extraction_id=extraction.id,
                status=status,
                validation_summary=validation_summary,
                error_code="extraction_failed" if failed else None,
                error_message="no requested domain produced a storable packet" if failed else None,
            )
    except cds_store.LeaseLostError:
        logger.warning("cds_extraction_lease_lost_at_completion", extraction_id=str(extraction.id))


async def _reject_if_manifest_mismatched(
    pool: asyncpg.Pool, manifest: CompiledManifest, extraction: cds_store.ExtractionRecord
) -> bool:
    """Fail the extraction and return `True` when the run must not proceed:
    either the extraction was queued against a manifest version that is no
    longer the compiled one, or `config/cds/` has drifted from what was
    published. The caller must return immediately when this returns `True`."""
    if extraction.manifest_version != manifest.version:
        await _finish_failed(
            pool,
            extraction.id,
            "manifest_version_mismatch",
            f"extraction requests manifest {extraction.manifest_version!r} but the compiled "
            f"config/cds/ is {manifest.version!r}",
        )
        return True
    try:
        await manifest_mod.verify_manifest_current(pool, manifest)
    except manifest_mod.ManifestDriftError as exc:
        await _finish_failed(pool, extraction.id, "manifest_drift", str(exc))
        return True
    return False


async def run_extraction(
    pool: asyncpg.Pool,
    settings: Any,
    extraction: cds_store.ExtractionRecord,
    *,
    lease_lost: Any = None,
) -> None:
    """Run one already-claimed `cds_extractions` row end to end: route pages,
    call the model per extraction group, remap citations, validate, build
    packets, write them, and mark the extraction complete.

    `lease_lost` is an optional cooperative-cancellation signal (an
    `asyncio.Event` set by `app/cds/jobs.py`'s background lease renewal on
    failure) -- checked between calls so a worker that lost its claim stops
    making further wasted model calls. Never raises on a normal failure
    path; any unexpected exception is caught and the extraction is marked
    `failed` rather than left `running` until the lease sweep recovers it.

    A lost lease is handled as its own outcome, not folded into the generic
    `engine_error` path: by the time `lease_lost` is set (or `insert_packet`
    raises `LeaseLostError` mid-store, see `_process_calls`), the lease
    sweep has already flipped this row to `failed` with its own
    `error_message` (`cds_store.sweep_expired_leases`), so `_finalize_run`'s
    `complete_extraction` call is doomed to lose its own fencing check no
    matter what -- attempting it anyway would only produce a second, vaguer
    warning log with no actual write. Logging explicitly here instead means
    the log trail says "we stopped because the lease was gone" rather than
    looking like an unexplained silent no-op.
    """
    started = time.monotonic()
    manifest = manifest_mod.load_compiled_manifest()
    if await _reject_if_manifest_mismatched(pool, manifest, extraction):
        return
    try:
        inputs = await _prepare_run(pool, manifest, extraction)
        state = await _process_calls(
            pool=pool,
            settings=settings,
            manifest=manifest,
            batches=inputs.batches,
            requested_domains=inputs.requested_domains,
            run_contract=inputs.run_contract,
            doc=inputs.doc,
            extraction=extraction,
            original_page_count=inputs.original_page_count,
            routing_text=inputs.routing_text,
            batch_padded_ranges=inputs.batch_padded_ranges,
            domain_padded_ranges=inputs.domain_padded_ranges,
            doc_facts=inputs.doc_facts,
            lease_lost=lease_lost,
        )
    except cds_store.LeaseLostError as exc:
        # `insert_packet`'s own lease fencing caught a write racing a lease that
        # expired mid-store (the `_process_calls` pre-store check above can't see
        # a loss that happens partway through that same loop) -- no packets from
        # this call landed for whichever domain hit it, and nothing after it in
        # `store_domain_packets`'s loop ran either.
        logger.warning(
            "cds_engine_lease_lost_mid_store", extraction_id=str(extraction.id), error=str(exc)
        )
        return
    except Exception as exc:  # noqa: BLE001 -- last-resort finalizer, never leave the row `running`
        logger.exception("cds_engine_run_failed", extraction_id=str(extraction.id))
        await _finish_failed(pool, extraction.id, "engine_error", str(exc))
        return

    if lease_lost is not None and lease_lost.is_set():
        logger.warning("cds_engine_lease_lost_no_packets_stored", extraction_id=str(extraction.id))
        return

    await _finalize_run(
        pool,
        extraction,
        state,
        corrupt_text_layer=inputs.corrupt_text_layer,
        duration_seconds=time.monotonic() - started,
    )


__all__ = ["EXTRACTOR_VERSION", "DomainOutcome", "run_extraction"]
