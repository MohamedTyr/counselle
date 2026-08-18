"""Page-range math + narrow/remap tests.

``narrow_document``'s position -> original-physical-page map is the mechanism
that keeps a citation from a narrowed sub-PDF honest (plan §B4) — this is
exercised against a real in-memory PDF, not a mock.
"""

from __future__ import annotations

import pymupdf

from domain.cds.pages import (
    grow_clusters,
    merge_page_ranges,
    narrow_document,
    padded_domain_ranges,
    page_clusters_for_group,
    page_framing,
    read_pdf_document,
    resolve_cited_page,
    widen_clusters,
)


def _make_pdf(page_count: int) -> bytes:
    document = pymupdf.open()
    try:
        for index in range(page_count):
            page = document.new_page()
            page.insert_text((72, 72), f"page {index + 1} content")
        return document.tobytes()
    finally:
        document.close()


def test_read_pdf_document_reports_identity_page_map() -> None:
    pdf = read_pdf_document(_make_pdf(5))
    assert pdf.page_count == 5
    assert pdf.page_map == (1, 2, 3, 4, 5)


def test_merge_page_ranges_collapses_adjacent_and_overlapping() -> None:
    # (1,3)->(5,6) has a one-page gap (page 4) and merges; (5,6)->(10,12) has a
    # four-page gap and stays separate.
    assert merge_page_ranges([(1, 3), (5, 6), (10, 12)]) == ((1, 6), (10, 12))


def test_merge_page_ranges_keeps_distant_ranges_separate() -> None:
    assert merge_page_ranges([(1, 3), (10, 12)]) == ((1, 3), (10, 12))


def test_padded_domain_ranges_widens_and_clips_to_document_bounds() -> None:
    routing = {"identity": (5, 5)}
    padded = padded_domain_ranges(routing, document_page_count=6, pad=2)
    assert padded == {"identity": (3, 6)}  # 5+2=7 clipped to 6


def test_page_clusters_for_group_falls_back_to_empty_when_a_domain_is_unrouted() -> None:
    """A missing routing result must never narrow the document — whole-doc fallback."""
    ranges = {"identity": (1, 2)}
    assert page_clusters_for_group(("identity", "admissions"), ranges) == ()


def test_page_clusters_for_group_merges_routed_domains() -> None:
    ranges = {"identity": (1, 2), "admissions": (6, 7)}
    assert page_clusters_for_group(("identity", "admissions"), ranges) == ((1, 2), (6, 7))


def test_narrow_document_maps_positions_back_to_original_physical_pages() -> None:
    original = read_pdf_document(_make_pdf(10))
    narrowed = narrow_document(original, ((2, 3), (7, 8)))
    assert narrowed.page_count == 4
    assert narrowed.page_map == (2, 3, 7, 8)
    # The narrowed bytes are a real, independently openable PDF.
    reopened = pymupdf.open(stream=narrowed.pdf_bytes, filetype="pdf")
    try:
        assert reopened.page_count == 4
        assert "page 2 content" in reopened[0].get_text()
        assert "page 7 content" in reopened[2].get_text()
    finally:
        reopened.close()


def test_page_framing_identity_map_cites_physical_pages() -> None:
    pdf = read_pdf_document(_make_pdf(3))
    text = page_framing(pdf)
    assert "physical pages 1-3" in text


def test_page_framing_narrowed_document_states_the_position_mapping() -> None:
    original = read_pdf_document(_make_pdf(10))
    narrowed = narrow_document(original, ((5, 6),))
    text = page_framing(narrowed)
    assert "position 1 = original page 5" in text
    assert "position 2 = original page 6" in text


def test_resolve_cited_page_maps_the_dominant_position_case() -> None:
    """The documented dominant behavior (spike-part-b.md): the model cites the
    sub-PDF position, and `page_map` (position -> original) resolves it."""
    page_map = {1: 22, 2: 23, 3: 24}
    resolution = resolve_cited_page(3, page_map)
    assert resolution.original_page == 24
    assert resolution.ambiguous is False


def test_resolve_cited_page_accepts_a_correctly_cited_original_page() -> None:
    """A minority of calls follow the in-prompt instruction and cite the
    ORIGINAL page directly. When that number is not a valid position but IS
    one of the original pages actually in this window, it is a page the
    model was actually shown -- not a guess -- so it must not be dropped.
    Only one interpretation is structurally valid here, so no excerpt is
    needed to accept it, unambiguously."""
    page_map = {1: 5, 2: 6, 3: 7, 4: 8, 5: 9, 6: 10, 7: 11, 8: 12, 9: 13, 10: 14, 11: 22, 12: 23}
    resolution = resolve_cited_page(23, page_map)
    assert resolution.original_page == 23
    assert resolution.ambiguous is False


def test_resolve_cited_page_single_valid_reading_needs_no_excerpt() -> None:
    """When only the position interpretation is structurally valid (1 is not
    itself an original page in this window), it wins outright -- there is no
    real ambiguity to break, so no excerpt/page_text is required at all."""
    page_map = {1: 5, 2: 6}
    resolution = resolve_cited_page(1, page_map)
    assert resolution.original_page == 5  # not 1, even though 1 isn't in the window
    assert resolution.ambiguous is False


def test_resolve_cited_page_drops_a_citation_outside_the_window_either_way() -> None:
    page_map = {1: 5, 2: 6}
    resolution = resolve_cited_page(99, page_map)
    assert resolution.original_page is None
    assert resolution.ambiguous is False


def test_resolve_cited_page_genuine_collision_defaults_to_position_when_content_inconclusive() -> (
    None
):
    """Raw citation 5 is valid under BOTH readings here: as a sub-PDF
    *position* (page_map[5] == 9) and, coincidentally, as a literal original
    page already in this window (page_map[1] == 5). The two disagree (9 vs
    5). With no excerpt/page_text supplied to break the tie, the documented
    majority behavior (position) wins, but the result is flagged ambiguous
    for human review -- never silently certain."""
    page_map = {1: 5, 2: 6, 3: 7, 4: 8, 5: 9}
    resolution = resolve_cited_page(5, page_map)
    assert resolution.original_page == 9
    assert resolution.ambiguous is True


def test_resolve_cited_page_genuine_collision_resolved_by_excerpt_favors_literal_reading() -> None:
    """Same collision as above, but this time the finding's excerpt is only
    found on the LITERAL candidate page's text -- content verification
    overrides the position default and resolves cleanly, not flagged."""
    page_map = {1: 5, 2: 6, 3: 7, 4: 8, 5: 9}
    page_text = {5: "Undergraduate profile, page five content.", 9: "Unrelated section header."}
    resolution = resolve_cited_page(
        5, page_map, excerpt="Undergraduate profile", page_text=page_text
    )
    assert resolution.original_page == 5
    assert resolution.ambiguous is False


def test_resolve_cited_page_genuine_collision_falls_back_to_position_when_neither_excerpt_matches() -> (  # noqa: E501
    None
):
    page_map = {1: 5, 2: 6, 3: 7, 4: 8, 5: 9}
    page_text = {5: "Something else entirely.", 9: "Also unrelated."}
    resolution = resolve_cited_page(
        5, page_map, excerpt="Undergraduate profile", page_text=page_text
    )
    assert resolution.original_page == 9
    assert resolution.ambiguous is True


def test_resolve_cited_page_corrupt_text_layer_skips_excerpt_check_and_flags_ambiguous() -> None:
    """The text-layer caveat: on a document `detect_corrupt_text_layer`
    flagged, `app/cds/engine.py` withholds page text entirely (passes
    `page_text=None`) rather than matching against unreliable garbled OCR
    text. A genuine collision on such a document must fall back to the
    position default and flag for review -- never drop, never trust a
    corrupt-text-layer excerpt match either way."""
    page_map = {1: 5, 2: 6, 3: 7, 4: 8, 5: 9}
    resolution = resolve_cited_page(
        5, page_map, excerpt="Undergraduate profile", page_text=None
    )
    assert resolution.original_page == 9
    assert resolution.ambiguous is True


def test_widen_clusters_adds_a_padded_window_around_each_extra_page() -> None:
    widened = widen_clusters(((5, 14),), [24], document_page_count=30, pad=2)
    assert widened == ((5, 14), (22, 26))


def test_widen_clusters_merges_into_existing_clusters_when_overlapping() -> None:
    widened = widen_clusters(((5, 14),), [15], document_page_count=30, pad=2)
    assert widened == ((5, 17),)


def test_widen_clusters_clips_to_document_bounds() -> None:
    widened = widen_clusters(((5, 14),), [30], document_page_count=30, pad=5)
    assert widened == ((5, 14), (25, 30))


def test_grow_clusters_widens_every_cluster_and_reclips() -> None:
    grown = grow_clusters(((10, 12), (40, 41)), document_page_count=50, pad=3)
    assert grown == ((7, 15), (37, 44))


def test_grow_clusters_merges_clusters_that_now_overlap() -> None:
    grown = grow_clusters(((10, 12), (16, 18)), document_page_count=50, pad=3)
    assert grown == ((7, 21),)
