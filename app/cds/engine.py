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
`plans/cds-pipeline/spike-part-a.md` / `spike-part-b.md`):

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
   batch, chunked further only when a section alone exceeds that ceiling --
   each with its OWN narrowed page window routed from just that batch's own
   `source_hints`. One call per batch, bounded-concurrency
   (`app/cds/batch_run.py`) so call count multiplying ~6-10x does not also
   multiply wall-clock the same amount. Findings from every batch belonging
   to one domain accumulate before that domain's packet is built once, at
   the end of the run -- never one packet per batch.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

import asyncpg
import structlog

from adapters import cds_gemini, cds_pdf, cds_store
from app.cds import batch_run, batching, citation_remap, starved_retry
from app.cds import manifest as manifest_mod
from domain.cds import packet_build, validators
from domain.cds import pages as pages_mod
from domain.cds.claims import Finding, WindowExtraction
from domain.cds.manifest_compile import CompiledManifest
from domain.cds.pages import padded_domain_ranges, page_clusters_for_group

logger = structlog.get_logger(__name__)

# The write path's identity for every model-produced packet (plan §A3): a
# distinct string from the ported pipeline's `gemini-routed-extraction-v8`,
# because reusing that identity for a different engine would make the
# provenance label a lie (AGENTS.md principle 3). `human-review-v1` is a
# separate identity used only by the (not-yet-built) correction service.
EXTRACTOR_VERSION = "counselle-cds-v1"

# CDS section code for the admissions selection-factors checkbox grid --
# a fixed CDS-template identifier (like "C1"/"C21"), not a manifest domain
# or metric id; ADR 0032 forbids hardcoding the *metric catalog*, not this.
_CHECKBOX_GRID_HINT = "C7"
# Other CDS grids whose meaning is carried by WHICH COLUMN a mark or number
# sits in, not by the mark itself. Reading order cannot recover them, and the
# corpus shows the engine silently transposing columns: on UCF's C9 it returned
# a 50th percentile of 27 and a 75th of 25 -- the 75th BELOW the 50th, which is
# arithmetically impossible and therefore a transposition, not a misread digit.
# Same supplement as C7, same reason.
_COLUMN_POSITION_HINTS = frozenset({"C9", "C15", "C16", "D5", "H9", "H10", "H12", "H13", "H14"})
_CHECKBOX_GRID_MAX_PAGES = 2
_CHECKBOX_GRID_IMAGE_DPI = 150

# Vertex AI PayGo pricing for gemini-3.1-flash-lite, USD/1M tokens
# (recon-vertex.md §4e) -- an informational cost estimate for
# validation_summary, not a billing-accurate figure. Mirrors the constant in
# scripts/verify_cds_adapters.py.
_INPUT_PRICE_PER_1M = 0.25
_OUTPUT_PRICE_PER_1M = 1.50


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


def _metric_hints(domain: dict[str, Any]) -> frozenset[str]:
    return frozenset(hint for metric in domain["metrics"] for hint in metric["source_hints"])


# Dash characters real CDS PDFs render between a letter prefix and its digit
# in a hint like "I-1" -- ASCII hyphen-minus plus the common Unicode dash
# family. Michigan's 2024-2025 PDF prints "I1"/"I2"/"I3" with NO separator at
# all (recon-cds-corpus.md documents NBSP-vs-space and bare-code-vs-titled
# heading variance but not this one -- found empirically while diagnosing why
# `class_size`/`faculty` never routed on the corpus's 4.8MB file, the exact
# size class the whole-document fallback cannot survive per spike-part-b.md).
# The separator must be OPTIONAL, not just tolerant of more dash variants.
_HINT_DASH_CHARS = "‐‑‒–—−"


def _hint_pattern(hint: str) -> re.Pattern[str]:
    """Anchor `hint` (a CDS code like "C1" or "I-1") to line-start, tolerant
    of the dash being absent, a Unicode variant, or surrounded by spaces,
    never matching a longer code with the same prefix ("C1" must not match
    "C10"/"C13").

    The surrounding-whitespace tolerance is why UCF routes at all: it prints
    "B4 ‐ B21. Graduation Rates" -- a U+2010 dash AND a space on each
    side. The dash family alone matched the other four corpus documents and
    missed that one.

    The line-start anchor is load-bearing and must not be relaxed to make a
    hint "more tolerant". PennState is the only corpus document that prints
    the string "B4-B11" at all, in a mid-line parenthetical ("(formerly CDS
    B4-B11)"); the anchor is the only reason that prose mention does not
    route the whole `outcomes` domain onto a glossary page.
    """
    escaped = re.escape(hint).replace("\\-", rf"\s*[-{_HINT_DASH_CHARS}]?\s*")
    return re.compile(rf"^{escaped}(?![0-9A-Za-z])")


def _hit_pages_for_hints(routing_text: dict[int, str], hints: frozenset[str]) -> list[int]:
    """Physical pages whose text starts a line with one of `hints` (a CDS
    section code like "C1"), anchored so "C1" never matches "C10"/"C13"."""
    if not hints:
        return []
    patterns = [_hint_pattern(hint) for hint in hints]
    hits: list[int] = []
    for page_number in sorted(routing_text):
        lines = routing_text[page_number].replace("\xa0", " ").splitlines()
        if any(pattern.match(line.strip()) for line in lines for pattern in patterns):
            hits.append(page_number)
    return hits


def _route_domains(
    manifest_content: dict[str, Any], routing_text: dict[int, str]
) -> dict[str, tuple[int, int]]:
    """Unpadded (first, last) page span per domain with >=1 section-code hit.
    A domain with zero hits is absent from the result -- any call touching
    it then falls back to whole-document (decision 1)."""
    routing: dict[str, tuple[int, int]] = {}
    for domain in manifest_content["domains"]:
        hits = _hit_pages_for_hints(routing_text, _metric_hints(domain))
        if hits:
            routing[domain["id"]] = (min(hits), max(hits))
    return routing


_HIT_CLUSTER_GAP = 3


def _densest_hit_span(hits: list[int]) -> tuple[int, int]:
    """The span of the LARGEST run of hit pages, rather than the convex hull
    of every hit.

    A bare single-letter hint matches far more than its own section. `J`
    compiles to `^J(?![0-9A-Za-z])`, which matches the table-of-contents line
    "J. DEGREES CONFERRED", the lettered sub-item "J." inside sections H and I,
    stray one-letter table cells, AND the real "J. Disciplinary areas of
    DEGREES CONFERRED". Taking `(min, max)` of those then spans most of the
    document to read one table -- UGA's two `degrees` batches sent 19 pages
    each for a table on page 41.

    Keeping the densest run instead is right because a CDS section's pages are
    contiguous while its spurious mentions are isolated. Verified on all five
    corpus documents: the true section-J page survives every time (ucf
    1,29,35,37 -> 35,37 with the real heading on 37; cornell 20,25,27 ->
    25,27 on 27; uga and caltech 33,39,41 -> 39,41 on 41; dartmouth
    20,25,26 -> 25,26 on 26), and clustering drops zero pages that ground
    truth actually needs. Gap sweep over the corpus: 2 -> 716 page-sends,
    3 -> 719, 5 -> 766, 8 -> 802; 3 keeps the tail without reopening the hull.

    Ties go to the LATER cluster: front-of-document matches are
    table-of-contents lines, the real section is further in.
    """
    clusters: list[list[int]] = [[hits[0]]]
    for page in hits[1:]:
        if page - clusters[-1][-1] > _HIT_CLUSTER_GAP:
            clusters.append([page])
        else:
            clusters[-1].append(page)
    best = max(clusters, key=lambda cluster: (len(cluster), cluster[-1]))
    return (best[0], best[-1])


def _route_batches(
    routing_text: dict[int, str], batches: list[batching.Batch]
) -> dict[str, tuple[int, int]]:
    """Unpadded (first, last) page span per BATCH (decision 7) -- routes off
    only a batch's own `source_hints`, not its whole domain's span. A batch
    with zero hits is absent -- its call falls back to whole-document, same
    fallback semantics as `_route_domains`."""
    routing: dict[str, tuple[int, int]] = {}
    for batch in batches:
        # Cluster each hint SEPARATELY, then span the survivors. Clustering the
        # batch's hits as one pool silently drops a whole section when a batch
        # carries two hints that legitimately sit far apart: UGA's `outcomes`
        # batch hints B4-B21 (page 8) and B22 (page 12), which cluster as two
        # singletons, and the tie-break kept only B22 -- so the graduation-rate
        # grid was never sent and the model read a DIFFERENT, older cohort
        # table that happened to fall inside the padded window. Six metrics
        # wrong, every one citing that other table.
        #
        # Per-hint clustering still discards the spurious matches
        # `_densest_hit_span` exists to kill, because those are extra hits of
        # ONE hint; it just never discards a hint's evidence entirely.
        per_hint = (
            _hit_pages_for_hints(routing_text, frozenset({hint})) for hint in batch.hints
        )
        spans = [_densest_hit_span(hits) for hits in per_hint if hits]
        if spans:
            routing[batch.key] = (min(s for s, _ in spans), max(e for _, e in spans))
    return routing


_FORM_MARK_MAX_PAGES = 4


async def _form_mark_pages(
    *,
    pdf_content: bytes,
    metrics: tuple[dict[str, Any], ...],
    routing_text: dict[int, str],
) -> list[int]:
    """Pages this batch must SEE rather than read, on a form-built PDF.

    An AcroForm checkbox's tick is drawn in the widget's appearance stream. It
    renders perfectly and appears nowhere in the text layer -- UGA's E1 page
    shows 15 ticked boxes and yields zero checkbox glyphs to text extraction.
    A model reading the text therefore has no evidence of a mark and answers
    `false`, confidently and wrongly, for every option on the page. Measured on
    UGA `academics`: 24 of 24 metrics wrong, none correct, in every run.

    This is the same failure the C7 image fallback already exists to solve; it
    is simply not unique to C7. So when the source is a form PDF and this batch
    asks for booleans, send the routed pages as images too.

    Scoped deliberately: form PDFs only (of the six corpus documents only UGA
    is one), boolean-bearing batches only, and capped -- images are the most
    expensive thing a call can carry.
    """
    if not all(metric.get("type") == "boolean" for metric in metrics):
        return []
    if not await cds_pdf.has_form_fields(pdf_content):
        return []
    hints = frozenset(hint for metric in metrics for hint in metric["source_hints"])
    hits = _hit_pages_for_hints(routing_text, hints)
    if not hits:
        return []
    first, last = _densest_hit_span(hits)
    return list(range(first, last + 1))[:_FORM_MARK_MAX_PAGES]


async def _c7_supplementary_images(
    *,
    pdf_content: bytes,
    metrics: tuple[dict[str, Any], ...],
    routing_text: dict[int, str],
    form_mark_pages: list[int] | None = None,
) -> tuple[bytes, ...]:
    """Decision 3: a 150 DPI PNG of the routed C7 page(s), sent alongside the
    narrowed native PDF only when this call's own `metrics` (a batch, or a
    starved-retry domain's full catalog) carry the C7 source hint -- the one
    targeted case spike part B found a real accuracy gain (Harvard's
    `class_rank` column-position miscall)."""
    grid_hints = frozenset(
        hint
        for metric in metrics
        for hint in metric["source_hints"]
        if hint == _CHECKBOX_GRID_HINT or hint in _COLUMN_POSITION_HINTS
    )
    if grid_hints:
        hit_pages = _hit_pages_for_hints(routing_text, grid_hints)
        hit_pages = hit_pages[:_CHECKBOX_GRID_MAX_PAGES]
    else:
        hit_pages = form_mark_pages or []
    if not hit_pages:
        return ()
    images = [
        await cds_pdf.render_page_png(pdf_content, page, dpi=_CHECKBOX_GRID_IMAGE_DPI)
        for page in hit_pages
    ]
    return tuple(images)


def _page_note(*, page_map: dict[int, int] | None, original_page_count: int) -> str:
    if page_map is None:
        return (
            f"The document contains physical pages 1-{original_page_count} in order; "
            "cite one-indexed physical page numbers."
        )
    mapping = ", ".join(
        f"position {position} = original page {physical}"
        for position, physical in sorted(page_map.items())
    )
    return (
        f"This document is a NARROWED SUBSET of the original CDS PDF -- only "
        f"{len(page_map)} of {original_page_count} original pages, assembled in original "
        f"order. Position-to-original-page mapping: {mapping}. Cite the ORIGINAL physical "
        "page number from this mapping, never the position within this file."
    )


# On an AcroForm CDS the static page content draws an EMPTY ballot box for
# every option and the tick is a separate widget mark. The tick renders, but
# it never becomes text -- UGA's E1 page yields 32 U+2610 (empty) glyphs and
# zero checked ones whether or not a box is ticked. A model reading the text
# therefore sees positive evidence that every box is empty and answers
# `false` for all of them: 24 of 24 wrong on UGA `academics`, in every run.
# The attached page image is the only truthful witness, so say so explicitly
# -- without this the model trusts the text layer over the image.
_FORM_MARK_PROMPT_NOTE = (
    "IMPORTANT -- this document's checkboxes are interactive form fields. Its text "
    "layer renders EVERY checkbox as an empty ballot box (\u2610) regardless of whether "
    "it is actually ticked, so the text is positively misleading here. Determine each "
    "checkbox's state ONLY from the attached page image, never from the text. A ticked "
    "box appears in the image as a mark inside the box."
)


def _build_prompt(
    *,
    manifest_content: dict[str, Any],
    metrics: tuple[dict[str, Any], ...],
    page_map: dict[int, int] | None,
    original_page_count: int,
    form_marks_note: bool = False,
) -> str:
    """Decision 7: `metrics` is one call's own catalog slice -- a batch's
    metrics normally, or one domain's full metric list for
    `starved_retry`'s isolated retry."""
    catalog = json.dumps(list(metrics), sort_keys=True, ensure_ascii=False)
    page_note = _page_note(page_map=page_map, original_page_count=original_page_count)
    form_note = f"\n\n{_FORM_MARK_PROMPT_NOTE}" if form_marks_note else ""
    return (
        f"{manifest_content['prompt']}\n\n"
        f"Extract ONLY these {len(metrics)} metrics. Use each metric's `id` verbatim as "
        f"`metric_id`; never invent a metric_id outside this list:\n{catalog}\n\n{page_note}"
        f"{form_note}"
    )


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

    form_mark_pages = await _form_mark_pages(
        pdf_content=pdf_content, metrics=batch_metrics, routing_text=routing_text
    )
    image_pngs = await _c7_supplementary_images(
        pdf_content=pdf_content,
        metrics=batch_metrics,
        routing_text=routing_text,
        form_mark_pages=form_mark_pages,
    )
    prompt = _build_prompt(
        manifest_content=manifest_content,
        metrics=batch_metrics,
        page_map=page_map,
        original_page_count=original_page_count,
        form_marks_note=bool(form_mark_pages),
    )
    if form_mark_pages:
        # Images ONLY, no PDF. Telling the model the text layer lies is not
        # enough -- with both in hand it keeps quoting the empty ballot box
        # (24/24 wrong on UGA `academics` with the warning AND the image
        # attached). The misleading evidence has to be absent, not merely
        # contradicted. Safe because this path is gated on every metric in the
        # batch being a boolean, whose only truthful witness is the rendering.
        call_bytes = None
    result = await cds_gemini.generate_structured(
        settings=settings,
        prompt=prompt,
        response_schema=WindowExtraction,
        pdf_bytes=call_bytes,
        image_pngs=image_pngs,
        model_setting=settings.model_cds_extract,
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
    hand-grown clusters and no retry wrapper."""
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
            retry_attempt = await _run_call_once(clusters=retry_clusters, **call_kwargs)
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
    `build_packet` raises `ZeroVerifiedMetricsError` instead of returning a
    packet in that case (there is no packet shape for it the reader's frozen
    contract accepts), reported here as this domain's outcome without ever
    attempting a doomed store."""
    try:
        packet = packet_build.build_packet(
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
    flags = validators.run_validators(packet, doc_facts)
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


def _zero_usage() -> cds_gemini.Usage:
    return cds_gemini.Usage(0, 0, 0, 0, 0)


def _add_usage(a: cds_gemini.Usage, b: cds_gemini.Usage) -> cds_gemini.Usage:
    return cds_gemini.Usage(
        prompt_tokens=a.prompt_tokens + b.prompt_tokens,
        output_tokens=a.output_tokens + b.output_tokens,
        thoughts_tokens=a.thoughts_tokens + b.thoughts_tokens,
        cached_tokens=a.cached_tokens + b.cached_tokens,
        total_tokens=a.total_tokens + b.total_tokens,
    )


def _usage_dict(usage: cds_gemini.Usage) -> dict[str, int]:
    return {
        "prompt_tokens": usage.prompt_tokens,
        "output_tokens": usage.output_tokens,
        "thoughts_tokens": usage.thoughts_tokens,
        "cached_tokens": usage.cached_tokens,
        "total_tokens": usage.total_tokens,
    }


def _estimate_cost_usd(usage: cds_gemini.Usage) -> float:
    return round(
        usage.prompt_tokens / 1_000_000 * _INPUT_PRICE_PER_1M
        + usage.output_tokens / 1_000_000 * _OUTPUT_PRICE_PER_1M,
        6,
    )


@dataclass
class _RunState:
    domain_outcomes: dict[str, DomainOutcome]
    call_records: list[dict[str, Any]]
    usage_total: cds_gemini.Usage


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
    empty afterward."""
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

    # One model id for the whole run: every batch call uses the same fixed
    # `settings.model_cds_extract` (decision 4 -- no per-call model choice),
    # so the actually-observed id from any successful call is equivalent to
    # deriving it from settings directly; prefer the observed one when at
    # least one batch succeeded, falling back to the settings string only
    # when every batch in the entire run failed (nothing observed at all).
    observed_model_id = next(
        (
            call_result.model_id
            for _, call_result, error in results
            if error is None and call_result
        ),
        None,
    )
    model_id = observed_model_id or settings.model_cds_extract.split(":", 1)[-1]

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
    """
    started = time.monotonic()
    manifest = manifest_mod.load_compiled_manifest()
    if extraction.manifest_version != manifest.version:
        await _finish_failed(
            pool,
            extraction.id,
            "manifest_version_mismatch",
            f"extraction requests manifest {extraction.manifest_version!r} but the compiled "
            f"config/cds/ is {manifest.version!r}",
        )
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
    except Exception as exc:  # noqa: BLE001 -- last-resort finalizer, never leave the row `running`
        logger.exception("cds_engine_run_failed", extraction_id=str(extraction.id))
        await _finish_failed(pool, extraction.id, "engine_error", str(exc))
        return

    await _finalize_run(
        pool,
        extraction,
        state,
        corrupt_text_layer=inputs.corrupt_text_layer,
        duration_seconds=time.monotonic() - started,
    )


__all__ = ["EXTRACTOR_VERSION", "DomainOutcome", "run_extraction"]
