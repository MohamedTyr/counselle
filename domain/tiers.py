"""Coverage tiers (ARCHITECTURE §11, ADR 0002 revised; DATABASE_GUIDE §12, §14.6).

The tier is computed from **actual data presence** — the extracted-value COUNT
decides, never ``extract_status`` (the Stanford trap: status 'done' with zero
extracted values is still PDF-only).
"""

from typing import Literal

CoverageTier = Literal["base", "cds_pdf_only", "cds_extracted"]

_EXPLANATIONS: dict[CoverageTier, str] = {
    "cds_extracted": (
        "This school has the deepest coverage: its Common Data Set has been "
        "extracted, so CDS-only detail (deadlines, factor weights, GPA bands) is "
        "available alongside IPEDS and Scorecard data."
    ),
    "cds_pdf_only": (
        "This school's Common Data Set PDF is on file but not yet extracted, so "
        "answers come from IPEDS and College Scorecard data — which still covers "
        "most admissions, cost, aid, and outcomes questions."
    ),
    "base": (
        "This school is covered by national IPEDS and College Scorecard data, "
        "which answers most admissions, cost, aid, and outcomes questions; "
        "CDS-only detail is not available for it."
    ),
}


def compute_tier(cds_extracted_count: int, has_cds_pdf: bool) -> CoverageTier:
    """Tier from data presence: extracted values > PDF on file > base."""
    if cds_extracted_count > 0:
        return "cds_extracted"
    if has_cds_pdf:
        return "cds_pdf_only"
    return "base"


def tier_explanation(tier: CoverageTier) -> str:
    """One student-readable sentence describing what the tier means."""
    return _EXPLANATIONS[tier]
