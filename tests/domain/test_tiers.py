"""Coverage tiers (ARCHITECTURE §11; DATABASE_GUIDE §12, §14.6 — the Stanford trap).

The extracted-field COUNT decides the tier — never `extract_status`.
"""

from domain.tiers import CoverageTier, compute_tier, tier_explanation

ALL_TIERS: tuple[CoverageTier, ...] = ("base", "cds_pdf_only", "cds_extracted")


def test_positive_extracted_count_means_cds_extracted() -> None:
    # U Penn: 249 extracted CDS values.
    # Arrange / Act
    tier = compute_tier(249, True)

    # Assert
    assert tier == "cds_extracted"


def test_zero_count_with_pdf_means_cds_pdf_only_the_stanford_trap() -> None:
    # Stanford: PDF downloaded, extract_status='done', but 0 extracted values.
    # Arrange / Act
    tier = compute_tier(0, True)

    # Assert
    assert tier == "cds_pdf_only"


def test_no_count_and_no_pdf_means_base() -> None:
    # Arrange / Act
    tier = compute_tier(0, False)

    # Assert
    assert tier == "base"


def test_tier_explanation_is_a_student_readable_sentence_for_every_tier() -> None:
    # Arrange / Act / Assert
    for tier in ALL_TIERS:
        explanation = tier_explanation(tier)
        assert isinstance(explanation, str)
        assert len(explanation.strip()) > 10
