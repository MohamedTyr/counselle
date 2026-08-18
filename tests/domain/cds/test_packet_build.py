"""Unit tests for the packet builder — honesty-critical, tested hard (AGENTS.md).

Covers the outcome-resolution matrix (verified/not_extracted/conflict/invalid),
typed-value coercion discipline, membership/page fencing, and the human-review
``base_metrics`` inheritance path (plan §B5).
"""

from __future__ import annotations

from typing import Any

import pytest

from domain.cds.claims import Finding
from domain.cds.packet_build import build_packet, metric_outcome, provider_contract, typed_value

DOCUMENT_SHA = bytes.fromhex("ab" * 32)


def _manifest(metrics: list[dict[str, Any]], domain_id: str = "identity") -> dict[str, Any]:
    return {"domains": [{"id": domain_id, "title": "Identity", "metrics": metrics}]}


def _int_metric(metric_id: str) -> dict[str, Any]:
    return {"id": metric_id, "type": "integer", "unit": "count"}


def _finding(**overrides: Any) -> Finding:
    defaults = dict(
        metric_id="identity.applicants",
        availability_status="reported",
        value=1247,
        raw_value="1,247",
        page_number=6,
        excerpt="Total applicants 1,247",
    )
    defaults.update(overrides)
    return Finding.model_validate(defaults)


def _build(findings: list[Finding], manifest: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    contract = provider_contract(manifest, ["identity"])
    kwargs: dict[str, Any] = dict(
        manifest_content=manifest,
        domain_hashes={"identity": "hash-identity"},
        domain_id="identity",
        findings=findings,
        provider_contract=contract,
        document_page_count=10,
        document_sha256=DOCUMENT_SHA,
        academic_year=2025,
        extraction_id="extraction-1",
        manifest_version="1.0.0",
        model_id="test-model",
        extractor_version="counselle-cds-v1",
    )
    kwargs.update(overrides)
    return build_packet(**kwargs)


class TestVerified:
    def test_single_reported_claim_is_verified(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build([_finding()], manifest)
        metric = packet["metrics"]["identity.applicants"]
        assert metric["extraction_status"] == "verified"
        assert metric["value"] == 1247
        assert metric["evidence"]["excerpt"] == "Total applicants 1,247"
        assert packet["counts"] == {"verified": 1, "not_extracted": 0, "conflict": 0, "invalid": 0}
        assert packet["status"] == "validated"

    def test_agreeing_duplicate_claims_stay_verified_not_conflict(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build([_finding(page_number=6), _finding(page_number=7)], manifest)
        assert packet["metrics"]["identity.applicants"]["extraction_status"] == "verified"

    def test_not_reported_claim_is_dropped_to_not_extracted(self) -> None:
        """A blank cell is an omission, not a claim — the prompt forbids this status
        server-side too (recon §3.2's two-layer safety net)."""
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build(
            [_finding(availability_status="not_reported", value=None, raw_value=None)], manifest
        )
        metric = packet["metrics"]["identity.applicants"]
        assert metric["extraction_status"] == "not_extracted"


class TestConflict:
    def test_disagreeing_claims_produce_conflict(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build([_finding(value=1247), _finding(value=1300)], manifest)
        metric = packet["metrics"]["identity.applicants"]
        assert metric["extraction_status"] == "conflict"
        assert metric["value"] is None
        assert packet["status"] == "parse_failed"


class TestInvalid:
    def test_type_mismatch_is_invalid(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build([_finding(value="not a number")], manifest)
        metric = packet["metrics"]["identity.applicants"]
        assert metric["extraction_status"] == "invalid"
        assert metric["diagnostic_code"] == "type_mismatch"

    def test_page_beyond_document_is_invalid(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build([_finding(page_number=999)], manifest)
        metric = packet["metrics"]["identity.applicants"]
        assert metric["extraction_status"] == "invalid"
        assert metric["diagnostic_code"] == "page_not_in_document"

    def test_template_absence_with_a_value_is_invalid(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build(
            [_finding(availability_status="not_in_template_version", value=5, raw_value="5")],
            manifest,
        )
        metric = packet["metrics"]["identity.applicants"]
        assert metric["extraction_status"] == "invalid"
        assert metric["diagnostic_code"] == "template_absence_has_value"

    def test_template_absence_without_a_value_is_verified(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build(
            [_finding(availability_status="not_in_template_version", value=None, raw_value=None)],
            manifest,
        )
        metric = packet["metrics"]["identity.applicants"]
        assert metric["extraction_status"] == "verified"
        assert metric["availability_status"] == "not_in_template_version"


class TestNotExtracted:
    def test_metric_with_no_claims_is_not_extracted(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build([], manifest)
        metric = packet["metrics"]["identity.applicants"]
        assert metric["extraction_status"] == "not_extracted"
        assert packet["status"] == "parse_failed"


class TestFencing:
    def test_claim_for_unknown_metric_id_is_dropped_silently(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build([_finding(metric_id="identity.not_a_real_metric")], manifest)
        assert set(packet["metrics"]) == {"identity.applicants"}

    def test_claim_outside_allowed_metric_ids_is_dropped(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants")])
        packet = _build(
            [_finding()], manifest, allowed_metric_ids=frozenset({"identity.other"})
        )
        assert packet["metrics"]["identity.applicants"]["extraction_status"] == "not_extracted"


class TestStatus:
    def test_partial_status_when_some_metrics_unverified(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants"), _int_metric("identity.admitted")])
        packet = _build([_finding()], manifest)
        assert packet["status"] == "partial"
        assert packet["counts"] == {"verified": 1, "not_extracted": 1, "conflict": 0, "invalid": 0}


class TestHumanReviewBaseMetrics:
    def test_untouched_refs_inherit_from_base_metrics(self) -> None:
        manifest = _manifest([_int_metric("identity.applicants"), _int_metric("identity.admitted")])
        base_metrics = {
            "identity.applicants": {
                "availability_status": "reported", "extraction_status": "verified",
                "value": 1000, "raw_value": "1,000",
                "evidence": {"page_number": 3, "excerpt": "prior", "section": None,
                              "row_label": None, "column_label": None},
            },
            "identity.admitted": {
                "availability_status": "reported", "extraction_status": "verified",
                "value": 500, "raw_value": "500",
                "evidence": {"page_number": 3, "excerpt": "prior", "section": None,
                              "row_label": None, "column_label": None},
            },
        }
        edit = _finding(metric_id="identity.admitted", value=550, raw_value="550")
        packet = _build([edit], manifest, base_metrics=base_metrics)
        assert packet["metrics"]["identity.applicants"] == base_metrics["identity.applicants"]
        assert packet["metrics"]["identity.admitted"]["value"] == 550
        assert packet["status"] == "validated"
        assert packet["counts"]["verified"] == 2


def test_typed_value_coerces_integral_float_losslessly() -> None:
    metric = {"type": "integer", "unit": "count"}
    finding = _finding(value=170.0)
    value, error = typed_value(finding, metric)
    assert value == 170
    assert error is None


def test_typed_value_rejects_non_integral_float_for_integer_metric() -> None:
    metric = {"type": "integer", "unit": "count"}
    finding = _finding(value=170.5)
    value, error = typed_value(finding, metric)
    assert value is None
    assert error == "type_mismatch"


def test_metric_outcome_deterministic_selection_on_lowest_page() -> None:
    def _claim(page: int, excerpt: str) -> dict[str, Any]:
        return {
            "availability_status": "reported", "value": 5, "raw_value": "5",
            "evidence": {
                "page_number": page, "excerpt": excerpt, "section": None,
                "row_label": None, "column_label": None,
            },
        }

    claims = [_claim(9, "b"), _claim(3, "a")]
    outcome, status = metric_outcome(claims, [])
    assert status == "verified"
    assert outcome["evidence"]["page_number"] == 3


def test_provider_contract_rejects_unknown_domain() -> None:
    manifest = _manifest([_int_metric("identity.applicants")])
    with pytest.raises(ValueError, match="missing from the compiled manifest"):
        provider_contract(manifest, ["not_a_domain"])
