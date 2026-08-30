"""One model call, its retry policy, and the packet it produces once
verified -- split out of `app/cds/engine.py` purely to keep it under the
file-size budget; the design decisions these functions implement (narrow-first
routing, the citation-remap page rules, the retry policy, per-domain packet
isolation) are documented in full in `engine.py`'s own module docstring.

`DomainOutcome` and `_CallResult` live here rather than in `engine.py` because
both are produced by functions in this module (`_run_call`/`_run_call_once`
build `_CallResult`; `_build_and_store_domain_packet` returns `DomainOutcome`).
`engine.py` re-imports `DomainOutcome` for its own `_RunState`/`_overall_status`/
`_finalize_run`, and re-exports it from `__all__` unchanged.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import asyncpg
import structlog

from adapters import cds_gemini, cds_pdf, cds_store
from app.cds import citation_remap
from app.cds import manifest as manifest_mod
from app.cds.routing import _build_prompt, _c7_supplementary_images, _form_mark_pages
from app.cds.usage import _add_usage
from domain.cds import packet_build, validators
from domain.cds import pages as pages_mod
from domain.cds.claims import Finding, WindowExtraction
from domain.cds.manifest_compile import CompiledManifest
from domain.cds.pages import page_clusters_for_group

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class DomainOutcome:
    """One requested domain's result for this run -- `status is None` means
    no packet was stored: either the call failed outright, or the domain
    verified zero claims this call (`packet_build.ZeroVerifiedMetricsError`,
    reported honestly via `error` instead of attempting a doomed store), or
    the packet the builder did produce failed the reader's own round-trip
    self-validation in `insert_packet` (a genuine shape/identity defect)."""

    domain_id: str
    status: str | None
    counts: dict[str, int] | None
    flags: int
    error: str | None


@dataclass(frozen=True)
class _CallResult:
    findings: list[Finding]
    usage: cds_gemini.Usage
    model_id: str
    latency_seconds: float
    narrowed: bool
    pages_sent: int
    retried: bool = False


@dataclass(frozen=True)
class _Attempt:
    """One model call's outcome, before the engine decides whether it needs a
    retry; carries `dropped_pages` since the retry decision needs that, not
    just the kept findings."""

    remapped_findings: list[Finding]
    dropped_pages: list[int]
    usage: cds_gemini.Usage
    model_id: str
    latency_seconds: float
    narrowed: bool
    pages_sent: int


def _is_deliberation_hinted(batch_metrics: tuple[dict[str, Any], ...]) -> bool:
    hints = {hint for metric in batch_metrics for hint in metric["source_hints"]}
    return bool(hints & manifest_mod.DELIBERATION_HINTS)


def _deliberation_config(
    batch_metrics: tuple[dict[str, Any], ...], settings: Any
) -> tuple[int, str | None]:
    """The `(thinking_budget, thinking_level)` pair for one call: the
    deliberation config when this batch carries a hint in
    `manifest.DELIBERATION_HINTS` (the only place the accuracy win was
    measured), the ordinary budget otherwise. Level takes precedence over
    budget for a deliberation-hinted batch when
    `model_cds_extract_deliberation_level` is set -- measured:
    `thinking_budget` is a discrete tier selector on gemini-3.1-flash-lite,
    not an allowance, and every non-trivial budget on that tier costs the
    same fixed ~$0.09/call regardless of size; `thinking_level` reaches
    cheaper tiers the budget field cannot. `model_cds_extract_deliberation_
    budget == 0` and `model_cds_extract_deliberation_level == ""` (both
    defaults) reproduce today's behaviour on every batch, hinted or not."""
    ordinary = (int(settings.model_cds_extract_thinking_budget), None)
    if not _is_deliberation_hinted(batch_metrics):
        return ordinary
    if settings.model_cds_extract_deliberation_level:
        return (0, settings.model_cds_extract_deliberation_level)
    if settings.model_cds_extract_deliberation_budget:
        return (int(settings.model_cds_extract_deliberation_budget), None)
    return ordinary


async def _call_evidence(
    *,
    call_bytes: bytes | None,
    pdf_content: bytes,
    batch_metrics: tuple[dict[str, Any], ...],
    routing_text: dict[int, str],
) -> tuple[bytes | None, tuple[bytes, ...], bool]:
    """The image evidence (if any) this call sends alongside its PDF bytes,
    and the possibly-overridden `call_bytes` to use -- decision 3's C7/
    column-position supplement, plus the AcroForm form-marks path where the
    text layer is positively misleading (module docstring).

    Returns `(call_bytes, image_pngs, form_marks_note)`. Images ONLY, no PDF,
    on the form-marks path -- telling the model the text layer lies is not
    enough -- with both in hand it keeps quoting the empty ballot box (24/24
    wrong on UGA `academics` with the warning AND the image attached). The
    misleading evidence has to be absent, not merely contradicted. Safe
    because this path is gated on every metric in the batch being a boolean,
    whose only truthful witness is the rendering."""
    form_mark_pages = await _form_mark_pages(
        pdf_content=pdf_content, metrics=batch_metrics, routing_text=routing_text
    )
    image_pngs = await _c7_supplementary_images(
        pdf_content=pdf_content,
        metrics=batch_metrics,
        routing_text=routing_text,
        form_mark_pages=form_mark_pages,
    )
    if form_mark_pages:
        call_bytes = None
    return call_bytes, image_pngs, bool(form_mark_pages)


async def _run_call_once(
    *,
    settings: Any,
    manifest_content: dict[str, Any],
    pdf_content: bytes,
    original_page_count: int,
    routing_text: dict[int, str],
    batch_metrics: tuple[dict[str, Any], ...],
    clusters: tuple[tuple[int, int], ...],
    page_text: Mapping[int, str] | None,
) -> _Attempt:
    """A single model call against exactly the page `clusters` given (empty
    -> whole document, decision 1's fallback), asking for exactly
    `batch_metrics` (decision 7). No retry logic here -- that lives in
    `_run_call`, which may call this twice. `page_text` is
    `DocFacts.page_text` (withheld on a corrupt text layer, decision 5) --
    only used for `citation_remap.remap_findings`'s excerpt tie-break."""
    call_bytes: bytes | None
    if clusters:
        physical_pages = [page for start, end in clusters for page in range(start, end + 1)]
        narrowed_bytes, page_map = await cds_pdf.narrow_document(pdf_content, physical_pages)
        call_bytes, narrowed = narrowed_bytes, True
    else:
        call_bytes, page_map, narrowed = pdf_content, None, False

    call_bytes, image_pngs, form_marks_note = await _call_evidence(
        call_bytes=call_bytes,
        pdf_content=pdf_content,
        batch_metrics=batch_metrics,
        routing_text=routing_text,
    )
    prompt = _build_prompt(
        manifest_content=manifest_content,
        metrics=batch_metrics,
        page_map=page_map,
        original_page_count=original_page_count,
        form_marks_note=form_marks_note,
    )
    thinking_budget, thinking_level = _deliberation_config(batch_metrics, settings)
    result = await cds_gemini.generate_structured(
        settings=settings,
        prompt=prompt,
        response_schema=WindowExtraction,
        pdf_bytes=call_bytes,
        image_pngs=image_pngs,
        model_setting=settings.model_cds_extract,
        thinking_budget=thinking_budget,
        thinking_level=thinking_level,
    )
    if not isinstance(result.parsed, WindowExtraction):
        raise cds_gemini.CdsGeminiEmptyResponseError(
            f"model call returned {type(result.parsed).__name__}, expected WindowExtraction"
        )
    pages_sent = len(page_map) if page_map is not None else original_page_count
    return _Attempt(
        remapped_findings=citation_remap.remap_findings(
            result.parsed.findings, page_map, page_text=page_text
        ),
        dropped_pages=citation_remap.dropped_citation_pages(result.parsed.findings, page_map),
        usage=result.usage,
        model_id=result.model_id,
        latency_seconds=result.latency_seconds,
        narrowed=narrowed,
        pages_sent=pages_sent,
    )


def _retry_clusters(
    clusters: tuple[tuple[int, int], ...], dropped_pages: list[int], original_page_count: int
) -> tuple[tuple[int, int], ...]:
    """Widen the window a retry should use: target the specific pages a
    dropped citation pointed at when there are any (the model tried to cite
    something outside its window -- send it that page next time), otherwise
    just grow what routing already found (the model found nothing at all, so
    there is no more specific target than "look wider")."""
    if dropped_pages:
        return pages_mod.widen_clusters(clusters, dropped_pages, original_page_count)
    return pages_mod.grow_clusters(clusters, original_page_count)


async def _run_call(
    *,
    settings: Any,
    manifest_content: dict[str, Any],
    pdf_content: bytes,
    original_page_count: int,
    routing_text: dict[int, str],
    batch_metrics: tuple[dict[str, Any], ...],
    window_key: str,
    padded_ranges: dict[str, tuple[int, int]],
    page_text: Mapping[int, str] | None,
) -> _CallResult:
    """Decision 1 (narrow-first) plus the retry policy: a narrowed call that
    returns zero findings, or drops a citation the model aimed outside its
    window, gets ONE retry against a wider window before the engine accepts
    the loss. Dropping stays the last resort -- never accepted as a page
    number without `resolve_cited_page` verifying it against a window the
    model was actually shown, retried or not. Used only by the batched path
    (`app/cds/batch_run.py`), `window_key` always a `Batch.key`;
    `starved_retry.py` calls `_run_call_once` directly instead, with its own
    hand-grown clusters and no retry wrapper.

    The retry call is a pure upside attempt: if it raises, this function
    still returns the first attempt's `_CallResult` unchanged rather than
    letting the exception propagate -- see the inline comment at the retry
    site for why (an uncaught retry failure here would cost the caller the
    first attempt's real findings and usage too, not just the retry's)."""
    call_kwargs = dict(
        settings=settings,
        manifest_content=manifest_content,
        pdf_content=pdf_content,
        original_page_count=original_page_count,
        routing_text=routing_text,
        batch_metrics=batch_metrics,
        page_text=page_text,
    )
    clusters = page_clusters_for_group((window_key,), padded_ranges)
    attempt = await _run_call_once(clusters=clusters, **call_kwargs)
    usage, latency, retried = attempt.usage, attempt.latency_seconds, False

    needs_retry = attempt.narrowed and (not attempt.remapped_findings or attempt.dropped_pages)
    if needs_retry:
        retry_clusters = _retry_clusters(clusters, attempt.dropped_pages, original_page_count)
        if retry_clusters != clusters:
            try:
                retry_attempt = await _run_call_once(clusters=retry_clusters, **call_kwargs)
            except Exception as exc:  # noqa: BLE001 -- see docstring: keep attempt 1's win
                # The retry is a one-shot best-effort widen, never a reason to lose an
                # already-successful first attempt. `_run_one_batch` (batch_run.py) wraps
                # this whole call in its own broad `except Exception` and, on any escape,
                # discards the batch as `(batch, None, error)` -- so a raw transport error
                # here (observed live: httpx.WriteTimeout, same class `_run_one_batch`
                # documents escaping the SDK unwrapped) would silently drop `attempt`'s
                # real findings and usage, not just the retry's. Swallow it and keep
                # `attempt` unchanged; `retried` stays False since no usage was added.
                logger.warning(
                    "cds_engine_retry_call_failed_keeping_first_attempt",
                    error_type=type(exc).__name__,
                    error=str(exc),
                )
            else:
                usage = _add_usage(usage, retry_attempt.usage)
                latency += retry_attempt.latency_seconds
                retried = True
                if len(retry_attempt.remapped_findings) >= len(attempt.remapped_findings):
                    attempt = retry_attempt

    return _CallResult(
        findings=attempt.remapped_findings,
        usage=usage,
        model_id=attempt.model_id,
        latency_seconds=latency,
        narrowed=attempt.narrowed,
        pages_sent=attempt.pages_sent,
        retried=retried,
    )


def _build_packet(
    *,
    manifest: CompiledManifest,
    domain_id: str,
    findings: list[Finding],
    run_contract: dict[str, Any],
    doc: cds_store.DocumentForExtraction,
    extraction: cds_store.ExtractionRecord,
    model_id: str,
    original_page_count: int,
) -> dict[str, Any] | DomainOutcome:
    """`packet_build.build_packet`'s result, or the `DomainOutcome` to report
    directly when this domain verified zero metrics -- `build_packet` raises
    `ZeroVerifiedMetricsError` instead of returning a packet in that case
    (there is no packet shape for it the reader's frozen contract accepts)."""
    try:
        return packet_build.build_packet(
            manifest_content=manifest.content,
            domain_hashes=manifest.domain_hashes,
            domain_id=domain_id,
            findings=findings,
            provider_contract=run_contract,
            document_page_count=original_page_count,
            document_sha256=doc.pdf_sha256,
            academic_year=doc.academic_year,
            extraction_id=str(extraction.id),
            manifest_version=manifest.version,
            model_id=model_id,
            extractor_version=extraction.extractor_version,
        )
    except packet_build.ZeroVerifiedMetricsError as exc:
        return DomainOutcome(
            domain_id,
            None,
            exc.counts,
            0,
            f"domain {domain_id!r} verified zero metrics from this document; no packet stored",
        )


async def _store_packet(
    *,
    pool: asyncpg.Pool,
    settings: Any,
    manifest: CompiledManifest,
    domain_id: str,
    doc: cds_store.DocumentForExtraction,
    extraction: cds_store.ExtractionRecord,
    packet: dict[str, Any],
    flags: list[Any],
) -> DomainOutcome:
    """Persist an already-built, already-validated packet, mapping the
    reader's own round-trip self-validation failure (a genuine shape/identity
    defect in `insert_packet`) to a reported `DomainOutcome` instead of
    raising out of the run.

    Deliberately does NOT catch `cds_store.LeaseLostError` the same way:
    unlike a shape defect, which is specific to this one domain's packet, a
    lost lease means the whole run no longer holds its claim, so every
    remaining domain in `batch_run.store_domain_packets`'s loop is equally
    doomed -- letting it propagate stops that loop immediately instead of
    silently skipping just this domain and writing the rest. `engine.
    run_extraction` catches it once, at the top, and reports the run's
    outcome as lease-lost rather than a generic per-domain failure."""
    try:
        async with pool.acquire() as conn, conn.transaction():
            record = await cds_store.insert_packet(
                conn,
                settings=settings,
                document_id=doc.document_id,
                extraction_id=extraction.id,
                manifest_version=manifest.version,
                domain_id=domain_id,
                domain_schema_hash=bytes.fromhex(manifest.domain_hashes[domain_id]),
                academic_year=doc.academic_year,
                pdf_sha256=doc.pdf_sha256,
                status=packet["status"],
                packet=packet,
                validation={"flags": [flag.model_dump() for flag in flags]},
            )
    except cds_store.PacketValidationError as exc:
        return DomainOutcome(domain_id, None, None, len(flags), str(exc))
    return DomainOutcome(domain_id, record.status, packet["counts"], len(flags), None)


async def _build_and_store_domain_packet(
    *,
    pool: asyncpg.Pool,
    settings: Any,
    manifest: CompiledManifest,
    domain_id: str,
    findings: list[Finding],
    run_contract: dict[str, Any],
    doc: cds_store.DocumentForExtraction,
    extraction: cds_store.ExtractionRecord,
    model_id: str,
    original_page_count: int,
    doc_facts: validators.DocFacts,
) -> DomainOutcome:
    """Build one domain's packet from this run's claims and store it. A call
    that verifies zero metrics for this domain is expected, not an error --
    reported here as this domain's outcome without ever attempting a doomed
    store."""
    built = _build_packet(
        manifest=manifest,
        domain_id=domain_id,
        findings=findings,
        run_contract=run_contract,
        doc=doc,
        extraction=extraction,
        model_id=model_id,
        original_page_count=original_page_count,
    )
    if isinstance(built, DomainOutcome):
        return built
    packet = built
    flags = validators.run_validators(packet, doc_facts)
    return await _store_packet(
        pool=pool,
        settings=settings,
        manifest=manifest,
        domain_id=domain_id,
        doc=doc,
        extraction=extraction,
        packet=packet,
        flags=flags,
    )


__all__ = [
    "DomainOutcome",
    "_CallResult",
    "_build_and_store_domain_packet",
    "_deliberation_config",
    "_retry_clusters",
    "_run_call",
    "_run_call_once",
]
