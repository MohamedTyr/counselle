"""Page routing and prompt construction for the extraction run -- split out of
`app/cds/engine.py` purely to keep it under the file-size budget; the design
decisions these functions implement (narrow-first routing, densest-run
clustering, the C7/column-position image supplement, the AcroForm text-layer
trap) are documented in full in `engine.py`'s own module docstring, decisions
1-3 and the routing/prompting spike findings it cites.
"""

from __future__ import annotations

import json
import re
from typing import Any

from adapters import cds_pdf
from app.cds import batching

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
_COLUMN_POSITION_HINTS = frozenset({"C9", "C15", "C16", "D5", "H12", "H13", "H14"})
_CHECKBOX_GRID_MAX_PAGES = 2
_CHECKBOX_GRID_IMAGE_DPI = 150


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
    # Cluster each hint SEPARATELY, then union the survivors' spans -- pooling every
    # hint's hits before clustering (the previous approach here) is exactly what
    # `_route_batches` above was changed away from: a batch that legitimately carries
    # two hints sitting far apart (gap > `_HIT_CLUSTER_GAP`) gets ONE tie-broken span,
    # silently dropping the other hint's section entirely. It is worse here than in
    # `_route_batches`, because this result is what makes `_call_evidence` withhold the
    # PDF (module docstring) -- a page dropped here has no fallback text evidence left.
    per_hint = (_hit_pages_for_hints(routing_text, frozenset({hint})) for hint in hints)
    spans = [_densest_hit_span(hits) for hits in per_hint if hits]
    if not spans:
        return []
    pages = sorted({page for first, last in spans for page in range(first, last + 1)})
    return pages[:_FORM_MARK_MAX_PAGES]


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
    `class_rank` column-position miscall).

    UNIONS with `form_mark_pages` rather than choosing one or the other. When
    `_call_evidence` withholds the PDF because `_form_mark_pages` found
    pages, those pages are this batch's ONLY truthful evidence (see that
    docstring) and must be sent regardless of whether the batch also carries
    a C7/column-position hint. Treating the two as mutually exclusive (the
    previous shape here) meant a boolean batch that was both form-mark-hinted
    and grid-hinted got only the raw, unclustered grid hits capped at 2 --
    `_form_mark_pages`'s own clustered, up-to-4-page result was silently
    discarded, and the PDF was gone too. Grid hits are clustered with
    `_densest_hit_span` before capping, same as every other routing path,
    instead of taken as raw hits."""
    grid_hints = frozenset(
        hint
        for metric in metrics
        for hint in metric["source_hints"]
        if hint == _CHECKBOX_GRID_HINT or hint in _COLUMN_POSITION_HINTS
    )
    grid_pages: list[int] = []
    if grid_hints:
        hits = _hit_pages_for_hints(routing_text, grid_hints)
        if hits:
            first, last = _densest_hit_span(hits)
            grid_pages = list(range(first, last + 1))[:_CHECKBOX_GRID_MAX_PAGES]
    hit_pages = sorted(set(grid_pages) | set(form_mark_pages or []))
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
    "layer renders EVERY checkbox as an empty ballot box (☐) regardless of whether "
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


__all__ = [
    "_build_prompt",
    "_c7_supplementary_images",
    "_form_mark_pages",
    "_hit_pages_for_hints",
    "_page_note",
    "_route_batches",
    "_route_domains",
]
