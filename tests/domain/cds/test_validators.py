"""Table-driven unit tests for every validator (honesty-critical, tested hard).

Each test constructs a minimal packet dict (the ``cds_domain_packets.packet``
shape) and checks the validator fires — or deliberately doesn't — for a real,
named failure mode from the corpus recon (`plans/cds-pipeline/recon-old-pipeline.md`
§4 risk register).
"""

from __future__ import annotations

from typing import Any

from domain.cds.validators import (
    DocFacts,
    corrupt_text_layer,
    denominator_sanity,
    excerpt_on_cited_page,
    run_validators,
    year_consistency,
)


def _verified_metric(
    *, value: Any, raw_value: str | None = None, page: int = 3, excerpt: str = "some excerpt"
) -> dict[str, Any]:
    return {
        "availability_status": "reported",
        "extraction_status": "verified",
        "value": value,
        "raw_value": raw_value,
        "evidence": {
            "page_number": page, "excerpt": excerpt, "section": None,
            "row_label": None, "column_label": None,
        },
    }


def _packet(
    metrics: dict[str, dict[str, Any]],
    definitions: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    definitions = definitions or {}
    return {
        "metrics": metrics,
        "provider_contract": {
            "metric_definitions": [
                {"id": "d", "metrics": [{"id": ref, **defn} for ref, defn in definitions.items()]}
            ]
        },
    }


class TestExcerptOnCitedPage:
    def test_no_flag_when_excerpt_is_on_the_cited_page(self) -> None:
        packet = _packet({"admissions.applicants_total": _verified_metric(
            value=7932, page=6, excerpt="Total applicants 7,932"
        )})
        doc_facts = DocFacts(page_text={6: "C1 TOTAL Total applicants 7,932 men women"})
        assert excerpt_on_cited_page(packet, doc_facts) == []

    def test_flags_when_excerpt_is_not_on_the_cited_page(self) -> None:
        packet = _packet({"admissions.applicants_total": _verified_metric(
            value=7932, page=6, excerpt="Total applicants 7,932"
        )})
        doc_facts = DocFacts(page_text={6: "an unrelated page about financial aid policy"})
        flags = excerpt_on_cited_page(packet, doc_facts)
        assert len(flags) == 1
        assert flags[0].code == "excerpt_not_on_cited_page"
        assert "admissions.applicants_total" in flags[0].message

    def test_no_flag_when_page_text_unavailable(self) -> None:
        """Absence of local text is not proof of a bad citation."""
        packet = _packet({"admissions.applicants_total": _verified_metric(value=7932, page=6)})
        assert excerpt_on_cited_page(packet, DocFacts(page_text={})) == []

    def test_no_flag_for_two_word_excerpt_split_across_a_decoupled_table(self) -> None:
        """Cornell-class failure (flag-precision.md): a CDS grid's label and
        value routinely extract on separate lines, not adjacent -- "Total"
        far from "798" even though both are genuinely on the page."""
        packet = _packet({"transfer.admitted_total": _verified_metric(
            value=798, page=13, excerpt="Total 798"
        )})
        doc_facts = DocFacts(page_text={13: "Men\n3,126\n346\n279\nTotal\n5,761\n798\n633"})
        assert excerpt_on_cited_page(packet, doc_facts) == []

    def test_flags_two_word_excerpt_when_only_one_word_is_present(self) -> None:
        """A partial 2-word match still isn't real evidence -- both words
        must be found, not just one."""
        packet = _packet({"transfer.admitted_total": _verified_metric(
            value=798, page=13, excerpt="Total 798"
        )})
        doc_facts = DocFacts(page_text={13: "Total applicants only, no admitted figure here"})
        assert len(excerpt_on_cited_page(packet, doc_facts)) == 1

    def test_no_flag_for_unverified_metrics(self) -> None:
        packet = _packet({"admissions.applicants_total": {
            "availability_status": None, "extraction_status": "not_extracted",
            "value": None, "raw_value": None, "evidence": None,
        }})
        assert excerpt_on_cited_page(packet, DocFacts(page_text={6: "anything"})) == []


class TestCorruptTextLayer:
    def test_no_flags_when_document_is_not_flagged_corrupt(self) -> None:
        packet = _packet({"outcomes.corrupted_value": _verified_metric(value=170)})
        assert corrupt_text_layer(packet, DocFacts(corrupt_text_layer=False)) == []

    def test_flags_every_digit_bearing_verified_metric_when_corrupt(self) -> None:
        packet = _packet({
            "outcomes.a": _verified_metric(value=170),
            "identity.school_name": _verified_metric(value="Caltech"),
        })
        flags = corrupt_text_layer(packet, DocFacts(corrupt_text_layer=True))
        assert [f.metric_ref for f in flags] == ["outcomes.a"]
        assert flags[0].code == "corrupt_text_layer"


class TestYearConsistency:
    def test_no_flag_when_years_match(self) -> None:
        packet = _packet({"identity.academic_year": _verified_metric(value="2024-25")})
        assert year_consistency(packet, DocFacts(expected_academic_year=2024)) == []

    def test_flags_stale_edition_header(self) -> None:
        """Cornell-class failure: 78% of pages carry a stale prior-year header."""
        packet = _packet({"identity.academic_year": _verified_metric(value="2021-2022")})
        flags = year_consistency(packet, DocFacts(expected_academic_year=2024))
        assert len(flags) == 1
        assert flags[0].code == "year_consistency"
        assert flags[0].severity == "error"

    def test_no_flag_when_expected_year_unknown(self) -> None:
        packet = _packet({"identity.academic_year": _verified_metric(value="2021-2022")})
        assert year_consistency(packet, DocFacts(expected_academic_year=None)) == []


class TestDenominatorSanity:
    def test_no_flags_on_consistent_admissions_funnel(self) -> None:
        packet = _packet({
            "admissions.applicants_total": _verified_metric(value=7932),
            "admissions.admitted_total": _verified_metric(value=2500),
            "admissions.enrolled_total": _verified_metric(value=1600),
        })
        assert denominator_sanity(packet, DocFacts()) == []

    def test_flags_admits_greater_than_applicants(self) -> None:
        packet = _packet({
            "admissions.applicants_total": _verified_metric(value=7932),
            "admissions.admitted_total": _verified_metric(value=8412),
        })
        flags = denominator_sanity(packet, DocFacts())
        assert any(f.code == "denominator_sanity" and "admits" in f.message for f in flags)
        assert "8,412" in flags[0].message and "7,932" in flags[0].message

    def test_flags_enrolled_greater_than_admitted(self) -> None:
        packet = _packet({
            "admissions.admitted_total": _verified_metric(value=2500),
            "admissions.enrolled_total": _verified_metric(value=2600),
        })
        flags = denominator_sanity(packet, DocFacts())
        assert any("enrolled" in f.message for f in flags)

    def test_flags_out_of_range_percent(self) -> None:
        percent_def = {
            "class_profile.sat_submitters_percent": {"type": "string", "unit": "percent"}
        }
        packet = _packet(
            {"class_profile.sat_submitters_percent": _verified_metric(value="142")},
            definitions=percent_def,
        )
        flags = denominator_sanity(packet, DocFacts())
        assert any(f.code == "denominator_sanity" and "range" in f.message for f in flags)

    def test_no_flag_for_valid_percent_string_with_qualifier(self) -> None:
        percent_def = {
            "class_profile.sat_submitters_percent": {"type": "string", "unit": "percent"}
        }
        packet = _packet(
            {"class_profile.sat_submitters_percent": _verified_metric(value="<1%")},
            definitions=percent_def,
        )
        assert denominator_sanity(packet, DocFacts()) == []

    def test_missing_siblings_produce_no_flag(self) -> None:
        """Can't sanity-check what wasn't extracted — silence is not an accusation."""
        packet = _packet({"admissions.admitted_total": _verified_metric(value=2500)})
        assert denominator_sanity(packet, DocFacts()) == []


def test_run_validators_concatenates_all_flags_in_order() -> None:
    packet = _packet({
        "admissions.applicants_total": _verified_metric(
            value=100, page=1, excerpt="not on page"
        ),
        "admissions.admitted_total": _verified_metric(
            value=200, page=1, excerpt="also not on page"
        ),
    })
    doc_facts = DocFacts(page_text={1: "unrelated content entirely"})
    flags = run_validators(packet, doc_facts)
    codes = {flag.code for flag in flags}
    assert "excerpt_not_on_cited_page" in codes
    assert "denominator_sanity" in codes
