"""Translate every narrowed-call citation through the deterministic page_map
before it can touch a packet -- split out of `app/cds/engine.py` purely to
keep that file under the file-size budget (the same reason
`app/cds/starved_retry.py` exists as its own module); this is still engine
orchestration (structlog logging is I/O), not a `domain/cds/` pure rule.

Decision 2 (routing-tuning.md): never trust a narrowed call's `page_number`
as an original physical page at face value. `domain.cds.pages.resolve_cited_page`
owns the actual position/literal-page math and the rare excerpt-based tie
break; this module owns turning that result into stored `Finding`s (or a
drop) and the operational log signal for the cases it cannot fully resolve.
"""

from __future__ import annotations

from collections.abc import Mapping

import structlog

from domain.cds import pages as pages_mod
from domain.cds.claims import Finding

logger = structlog.get_logger(__name__)


def remap_findings(
    findings: list[Finding],
    page_map: dict[int, int] | None,
    *,
    page_text: Mapping[int, str] | None = None,
) -> list[Finding]:
    """Every citation translated through `page_map`, or returned unchanged for
    a whole-document call (`page_map is None`). A citation `resolve_cited_page`
    could not place in the window the model was actually shown is dropped,
    not guessed -- the honesty carve-out (AGENTS.md principle 3). A citation
    it could only settle via the documented majority-case default (both
    readings valid, content inconclusive) is still kept -- it is a real page
    the model was shown -- but logged as ambiguous for human review, never
    silently stored as if it were certain."""
    if page_map is None:
        return findings
    remapped: list[Finding] = []
    for finding in findings:
        resolution = pages_mod.resolve_cited_page(
            finding.page_number, page_map, excerpt=finding.excerpt, page_text=page_text
        )
        if resolution.original_page is None:
            logger.warning(
                "cds_engine_citation_out_of_narrowed_range",
                metric_id=finding.metric_id,
                cited_position=finding.page_number,
                narrowed_page_count=len(page_map),
            )
            continue
        if resolution.ambiguous:
            logger.warning(
                "cds_engine_citation_ambiguous_resolution",
                metric_id=finding.metric_id,
                cited_position=finding.page_number,
                resolved_page=resolution.original_page,
            )
        remapped.append(finding.model_copy(update={"page_number": resolution.original_page}))
    return remapped


def dropped_citation_pages(findings: list[Finding], page_map: dict[int, int] | None) -> list[int]:
    """The raw `page_number` of every finding `remap_findings` would drop --
    the engine's one-shot retry targets these pages (routing-tuning.md §4)."""
    if page_map is None:
        return []
    return [
        finding.page_number
        for finding in findings
        if pages_mod.resolve_cited_page(finding.page_number, page_map).original_page is None
    ]


__all__ = ["dropped_citation_pages", "remap_findings"]
