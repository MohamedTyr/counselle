"""Page-range math for optional narrowing, and the narrowed -> original page-number
remapping that every citation must be translated through before it touches a packet.

Ported from the old pipeline's ``library/extractor.py`` (recon §4.2). Page routing is
strictly an optimization: a missing or bad routing result only costs the narrowing
benefit, never correctness (``page_clusters_for_group`` falls back to "call the whole
document" by returning ``()``; the caller must honor that fallback — see plan §B4).

Pure page-number arithmetic — no PDF I/O, no network, no model calls. The actual PDF
slicing (`narrow_document`) lives in ``adapters/cds_pdf.py``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from domain.cds import validators

DEFAULT_ROUTING_PAGE_PAD = 2

# How far the trailing edge may grow *beyond* the default pad when the next
# routed section leaves room (routing-tuning.md §3) -- bounded so a sparse
# document (e.g. ohio-state_2023-2024's 187 pages) can't balloon one domain's
# window into a near-whole-document call just because the next hit is far
# away. A judgment call, not empirically derived: the 3-document diagnosis
# corpus never needed more than the existing ±2 pad, so this only matters as
# a guard for documents outside that sample.
MAX_TRAILING_PAD_EXTRA = 6

# Widen pad for the engine's one-shot retry when a narrowed call returns zero
# findings or drops an out-of-range citation (routing-tuning.md §4 retry
# policy). Deliberately wider than DEFAULT_ROUTING_PAGE_PAD -- the retry only
# fires when the cheap first attempt already came up short, so paying for a
# bigger window once is the point.
RETRY_WIDEN_PAGE_PAD = 6


def _clip_page(page: int, page_count: int) -> int:
    return max(1, min(page_count, page))


def _trailing_edge(
    *,
    last: int,
    other_starts: list[int],
    document_page_count: int,
    pad: int,
    max_extra: int,
) -> int:
    """The end page for one domain's padded window: at least ``last + pad``
    (never regresses below the old fixed-pad behavior), extended further --
    up to ``max_extra`` additional pages -- when the next routed section
    (across every OTHER domain, not just this call's group) leaves room
    before its own start, instead of always stopping at a fixed ``+pad``.
    Never crosses past that next section's own start page."""
    later_starts = [start for start in other_starts if start > last]
    next_start = min(later_starts) if later_starts else None
    cap = document_page_count if next_start is None else next_start - 1
    grown = min(last + pad + max_extra, cap)
    return _clip_page(max(last + pad, grown), document_page_count)


def padded_domain_ranges(
    routing: dict[str, tuple[int, int]],
    document_page_count: int,
    *,
    pad: int = DEFAULT_ROUTING_PAGE_PAD,
    max_trailing_extra: int = MAX_TRAILING_PAD_EXTRA,
) -> dict[str, tuple[int, int]]:
    """Widen each routed range by ``pad`` pages on the front edge; boundary
    content is routinely shared between adjacent CDS items, never assume the
    router's edge is exact. The trailing edge additionally grows toward
    (never past) the next routed section's start when the gap is larger than
    ``pad`` -- see ``_trailing_edge`` (routing-tuning.md §3: "size the window
    by where the next section begins")."""
    all_starts = [first for first, _ in routing.values()]
    return {
        domain: (
            _clip_page(first - pad, document_page_count),
            _trailing_edge(
                last=last,
                other_starts=all_starts,
                document_page_count=document_page_count,
                pad=pad,
                max_extra=max_trailing_extra,
            ),
        )
        for domain, (first, last) in routing.items()
    }


@dataclass(frozen=True)
class CitationResolution:
    """``resolve_cited_page``'s result: the original physical page (``None``
    when neither interpretation could be trusted), and whether this was a
    genuine collision between two real in-window pages that content
    verification could not confidently break. ``ambiguous`` is a signal for
    the caller to log for human review -- it never changes which page was
    stored; a citation is only ever resolved to a page the model was
    demonstrably shown, position or literal, never invented."""

    original_page: int | None
    ambiguous: bool = False


def _excerpt_confirms_page(excerpt: str, page_text: Mapping[int, str] | None, page: int) -> bool:
    """Content verification for the rare case a raw citation number is valid
    under BOTH interpretations and they disagree. Reuses the same fuzzy
    substring match the honesty-gate validator (``validators.fuzzy_contains``)
    already applies post-hoc to every stored citation, so this tie-break and
    that later flag can never quietly disagree about what "the excerpt is on
    this page" means. Missing or unavailable page text -- most notably a
    corrupt text layer, where ``app/cds/engine.py`` withholds page text
    entirely because garbled OCR-adjacent text makes matching unreliable
    (routing-tuning.md fix write-up's text-layer caveat) -- is INCONCLUSIVE,
    never a disproof: callers must treat a ``False`` return here as "did not
    confirm", not "ruled out", and fall back to the documented majority-case
    default rather than dropping."""
    if not page_text:
        return False
    text = page_text.get(page)
    if not text:
        return False
    return validators.fuzzy_contains(
        validators.normalize_text(excerpt), validators.normalize_text(text)
    )


def resolve_cited_page(
    raw_page_number: int,
    page_map: dict[int, int],
    *,
    excerpt: str = "",
    page_text: Mapping[int, str] | None = None,
) -> CitationResolution:
    """Translate one narrowed-call citation to an original physical page, or
    ``None`` if it cannot be trusted as a page this document's narrowed
    sub-PDF actually contained.

    The model is expected to cite the sub-PDF *position*, not the original
    page, in the large majority of narrowed calls even when told to cite the
    original (spike-part-b.md: >=79% "position" rate on every file tested) --
    ``page_map`` (position -> original page) resolves that dominant case.
    But a minority of calls correctly follow the in-prompt instruction and
    cite the ORIGINAL page directly; when ``raw_page_number`` is not a valid
    position but does equal one of the original pages actually included in
    this narrowed window (a value already in ``page_map``), that is a
    real, in-window page the model was actually shown, not a guess -- accept
    it, unambiguously (only one interpretation was structurally valid at
    all).

    The genuinely rare case is when ``raw_page_number`` is valid under BOTH
    readings -- a legal position AND, coincidentally, itself an original page
    already in this window -- and the two disagree on which page that is.
    Content verification (``excerpt``/``page_text``, when supplied) breaks
    that tie when it can: if the excerpt is found on the literal page but not
    the position page, the literal reading wins outright, not flagged. In
    every other outcome of that tie (content confirms position, confirms
    both, or is unavailable/inconclusive) the position interpretation wins as
    the documented majority default, and the result is marked ``ambiguous``
    so the caller can log it for review -- it is still a page the model was
    actually shown, never a guess. Returns ``original_page=None`` only when
    neither interpretation lands inside the window actually sent to the
    model."""
    position_page = page_map.get(raw_page_number)
    literal_page = raw_page_number if raw_page_number in page_map.values() else None

    if position_page is not None and literal_page is not None and position_page != literal_page:
        literal_confirmed = _excerpt_confirms_page(excerpt, page_text, literal_page)
        position_confirmed = _excerpt_confirms_page(excerpt, page_text, position_page)
        if literal_confirmed and not position_confirmed:
            return CitationResolution(literal_page)
        return CitationResolution(position_page, ambiguous=True)

    if position_page is not None:
        return CitationResolution(position_page)
    if literal_page is not None:
        return CitationResolution(literal_page)
    return CitationResolution(None)


def widen_clusters(
    clusters: tuple[tuple[int, int], ...],
    extra_pages: Sequence[int],
    document_page_count: int,
    *,
    pad: int = RETRY_WIDEN_PAGE_PAD,
) -> tuple[tuple[int, int], ...]:
    """Union ``clusters`` with a ``pad``-page window around each of
    ``extra_pages`` (out-of-range citation candidates from a dropped
    finding), clipped to document bounds, and re-merge. Used for the
    engine's one-shot retry when a narrowed call drops a citation that
    ``resolve_cited_page`` could not place inside the window it was given --
    the retry sends the model a window that actually contains the page it
    tried to cite (routing-tuning.md §4)."""
    extra_ranges = [
        (_clip_page(page - pad, document_page_count), _clip_page(page + pad, document_page_count))
        for page in extra_pages
    ]
    return merge_page_ranges([*clusters, *extra_ranges])


def grow_clusters(
    clusters: tuple[tuple[int, int], ...],
    document_page_count: int,
    *,
    pad: int = RETRY_WIDEN_PAGE_PAD,
) -> tuple[tuple[int, int], ...]:
    """Widen every existing cluster by ``pad`` pages on each side, clipped to
    document bounds, and re-merge. Used for the engine's one-shot retry when
    a narrowed call returns zero findings at all (no citation to target, so
    there is nothing more specific than "look wider around what routing
    already found") -- routing-tuning.md §3."""
    grown = [
        (_clip_page(start - pad, document_page_count), _clip_page(end + pad, document_page_count))
        for start, end in clusters
    ]
    return merge_page_ranges(grown)


def merge_page_ranges(ranges: list[tuple[int, int]]) -> tuple[tuple[int, int], ...]:
    """Collapse overlapping or adjacent (gap<=1 page) ranges into disjoint clusters,
    ascending. Gap = start - previous_end - 1, so a gap <= 1 merges at
    ``start <= previous_end + 2`` -- not ``+ 1``, which would only merge touching ranges."""
    ordered = sorted(ranges)
    merged: list[list[int]] = []
    for start, end in ordered:
        if merged and start <= merged[-1][1] + 2:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return tuple((start, end) for start, end in merged)


def page_clusters_for_group(
    domain_ids: tuple[str, ...], domain_ranges: dict[str, tuple[int, int]]
) -> tuple[tuple[int, int], ...]:
    """This call's mini-PDF page clusters, or empty if any of its domains was not
    routed -- the caller must then fall back to sending the whole document."""
    ranges = [domain_ranges[domain_id] for domain_id in domain_ids if domain_id in domain_ranges]
    if len(ranges) != len(domain_ids):
        return ()
    return merge_page_ranges(ranges)


__all__ = [
    "DEFAULT_ROUTING_PAGE_PAD",
    "MAX_TRAILING_PAD_EXTRA",
    "RETRY_WIDEN_PAGE_PAD",
    "CitationResolution",
    "grow_clusters",
    "merge_page_ranges",
    "padded_domain_ranges",
    "page_clusters_for_group",
    "resolve_cited_page",
    "widen_clusters",
]
