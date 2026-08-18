"""Unit tests for `app/cds/citation_remap.py`.

Split out of `test_engine.py` alongside the module itself (routing-tuning.md
fix write-up): honesty-critical, since a citation resolved to the wrong page
is worse than no data at all (AGENTS.md principle 3). Covers every branch
`resolve_cited_page` can return through `remap_findings`'s integration with
it: both-readings-match, only-one-matches, neither-matches, and the
corrupt-text-layer fallback (`page_text=None`).
"""

from __future__ import annotations

from app.cds import citation_remap
from domain.cds.claims import Finding


def _finding(metric_id: str, page_number: int, excerpt: str = "some excerpt text") -> Finding:
    return Finding(
        metric_id=metric_id,
        availability_status="reported",
        value="x",
        raw_value="x",
        page_number=page_number,
        excerpt=excerpt,
    )


def test_remap_findings_translates_narrowed_positions_to_original_pages() -> None:
    """The exact shape spike-part-b.md observed: a narrowed sub-PDF built
    from original pages [5, 6, 11], where the model cites POSITIONS (1, 2, 3)
    -- never the original page numbers -- and every one must come back as the
    real physical page before it can touch a packet."""
    page_map = {1: 5, 2: 6, 3: 11}
    findings = [_finding("admissions.c1_total", 1), _finding("admissions.c21_ed", 3)]

    remapped = citation_remap.remap_findings(findings, page_map)

    assert [f.page_number for f in remapped] == [5, 11]
    assert 1 not in [f.page_number for f in remapped]
    assert 3 not in [f.page_number for f in remapped]


def test_remap_findings_is_a_noop_for_whole_document_calls() -> None:
    findings = [_finding("admissions.c1_total", 7)]
    assert citation_remap.remap_findings(findings, None) == findings


def test_remap_findings_drops_citations_outside_the_narrowed_range() -> None:
    """A model citing a position beyond the bytes it was actually given is not
    a physical page this system can trust -- drop it rather than guess."""
    page_map = {1: 5, 2: 6}
    findings = [_finding("admissions.c1_total", 1), _finding("admissions.c21_ed", 99)]

    remapped = citation_remap.remap_findings(findings, page_map)

    assert len(remapped) == 1
    assert remapped[0].page_number == 5


def test_remap_findings_accepts_a_correctly_cited_original_page() -> None:
    """The minority-but-real case (spike-part-b.md): the model follows the
    in-prompt instruction and cites the ORIGINAL page directly instead of
    the sub-PDF position -- exactly Harvard's faculty/I-1 loss this plan
    fixes. Only one interpretation is structurally valid, so no excerpt is
    needed."""
    page_map = {i: p for i, p in enumerate([*range(5, 15), *range(22, 27)], start=1)}
    findings = [_finding("faculty.instructional_faculty_full_time", 24)]

    remapped = citation_remap.remap_findings(findings, page_map)

    assert [f.page_number for f in remapped] == [24]


def test_remap_findings_keeps_a_genuinely_ambiguous_citation_at_the_position_default() -> None:
    """Raw page 5 is valid both as position (-> 9) and as a literal in-window
    page (5 itself). With no page_text supplied, the position default wins --
    the citation is still KEPT (it is a real page the model was shown, never
    dropped for being ambiguous), just resolved to the majority-case page."""
    page_map = {1: 5, 2: 6, 3: 7, 4: 8, 5: 9}
    findings = [_finding("outcomes.retention_rate", 5)]

    remapped = citation_remap.remap_findings(findings, page_map)

    assert [f.page_number for f in remapped] == [9]


def test_remap_findings_resolves_ambiguity_by_excerpt_when_page_text_is_available() -> None:
    """Same collision, but this time the excerpt is only found on the LITERAL
    candidate's page text -- content verification overrides the position
    default."""
    page_map = {1: 5, 2: 6, 3: 7, 4: 8, 5: 9}
    page_text = {5: "Six-year graduation rate detail.", 9: "Unrelated section."}
    findings = [_finding("outcomes.retention_rate", 5, excerpt="graduation rate detail")]

    remapped = citation_remap.remap_findings(findings, page_map, page_text=page_text)

    assert [f.page_number for f in remapped] == [5]


def test_remap_findings_corrupt_text_layer_falls_back_to_position_default() -> None:
    """The text-layer caveat: `app/cds/engine.py` passes `page_text=None` on a
    corrupt-text-layer document (decision 5) rather than matching against
    unreliable garbled OCR text -- a collision still resolves (position
    default), never drops just because content verification is unavailable."""
    page_map = {1: 5, 2: 6, 3: 7, 4: 8, 5: 9}
    findings = [_finding("outcomes.retention_rate", 5)]

    remapped = citation_remap.remap_findings(findings, page_map, page_text=None)

    assert [f.page_number for f in remapped] == [9]


def test_dropped_citation_pages_reports_the_raw_uncited_page_numbers() -> None:
    page_map = {1: 5, 2: 6}
    findings = [_finding("admissions.c1_total", 1), _finding("admissions.c21_ed", 99)]
    assert citation_remap.dropped_citation_pages(findings, page_map) == [99]


def test_dropped_citation_pages_empty_for_whole_document_calls() -> None:
    assert citation_remap.dropped_citation_pages([_finding("admissions.c1_total", 7)], None) == []
