from __future__ import annotations

from copy import deepcopy
from typing import Any, cast

import pytest

from counselle_db.models import ServiceError
from counselle_db.packets import ManifestSnapshot, compile_manifest, parse_packet_row, read_metric


def _manifest(version: str = "5.0.1") -> ManifestSnapshot:
    return compile_manifest(
        version,
        {
            "domains": [
                {
                    "id": "admissions",
                    "title": "Admissions",
                    "metrics": [
                        {
                            "id": "admissions.rate",
                            "description": "Admission rate",
                            "type": "number",
                            "unit": "percent",
                        }
                    ],
                }
            ]
        },
    )


def _row(extractor: str = "gemini-routed-extraction-v8") -> dict[str, object]:
    packet = {
        "document_sha256": "aa",
        "academic_year": 2025,
        "extraction_id": "00000000-0000-0000-0000-000000000001",
        "manifest_version": "5.0.1",
        "domain_id": "admissions",
        "domain_schema_hash": "bb",
        "extractor_version": extractor,
        "model_id": "model",
        "status": "validated",
        "counts": {"verified": 1, "not_extracted": 0, "conflict": 0, "invalid": 0},
        "provider_contract": {"secretish": "must disappear"},
        "metrics": {
            "admissions.rate": {
                "extraction_status": "verified",
                "availability_status": "reported",
                "value": 0.1,
                "raw_value": "10%",
                "evidence": {"page_number": 2, "excerpt": "Rate 10%"},
            }
        },
    }
    return {
        "school_id": 1,
        "academic_year": 2025,
        "document_id": 2,
        "pdf_sha256": b"\xaa",
        "domain_id": "admissions",
        "accepted_packet_status": "validated",
        "packet": packet,
        "extraction_id": packet["extraction_id"],
        "manifest_version": "5.0.1",
        "domain_schema_hash": memoryview(b"\xbb"),
        "current_definition_match": True,
        "currentness": "current",
    }


@pytest.mark.parametrize(
    "extractor",
    [
        "gemini-native-pdf-v2",
        "gemini-native-pdf-v5",
        "gemini-routed-extraction-v7",
        "gemini-routed-extraction-v8",
    ],
)
def test_supported_contracts_are_strict_and_provider_contract_is_discarded(extractor: str) -> None:
    row = _row(extractor)
    original_packet = deepcopy(row["packet"])
    parsed = parse_packet_row(row, {"5.0.1": _manifest()}, frozenset({extractor}))
    assert row["packet"] == original_packet
    assert bytes(cast(memoryview, row["domain_schema_hash"])) == b"\xbb"
    assert "provider_contract" not in repr(parsed)
    assert "provider_contract" not in parsed.model_dump_json()


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("domain_id",), "cost"),
        (("academic_year",), 2024),
        (("metrics", "admissions.rate", "evidence", "page_number"), 0),
        (("metrics", "admissions.rate", "value"), None),
        (("counts", "verified"), 0),
    ],
)
def test_inconsistent_packet_rejects_the_whole_domain(path: tuple[str, ...], value: object) -> None:
    row = _row()
    target = row["packet"]
    for part in path[:-1]:
        target = target[part]  # type: ignore[index]
    target[path[-1]] = value  # type: ignore[index]
    with pytest.raises(ServiceError, match="unsupported/inconsistent"):
        parse_packet_row(row, {"5.0.1": _manifest()}, frozenset({"gemini-routed-extraction-v8"}))


@pytest.mark.parametrize(
    ("status", "availability", "value", "raw", "evidence"),
    [
        ("verified", "reported", 1, "1", None),
        ("verified", "not_reported", None, "blank", {"page_number": 1, "excerpt": "blank"}),
        ("verified", None, None, None, None),
        ("not_extracted", "reported", None, None, None),
        ("conflict", None, 1, None, None),
        ("invalid", None, None, None, {"page_number": 1, "excerpt": "bad"}),
    ],
)
def test_every_impossible_metric_state_rejects_the_whole_packet(
    status: str,
    availability: str | None,
    value: object,
    raw: str | None,
    evidence: object,
) -> None:
    row = _row()
    packet = cast(dict[str, Any], row["packet"])
    metric = cast(dict[str, Any], packet["metrics"]["admissions.rate"])
    metric.update(
        extraction_status=status,
        availability_status=availability,
        value=value,
        raw_value=raw,
        evidence=evidence,
    )
    counts = {key: 0 for key in ("verified", "not_extracted", "conflict", "invalid")}
    counts[status] = 1
    packet["counts"] = counts
    with pytest.raises(ServiceError, match="unsupported/inconsistent"):
        parse_packet_row(row, {"5.0.1": _manifest()}, frozenset({"gemini-routed-extraction-v8"}))


@pytest.mark.parametrize(
    ("status", "diagnostic", "valid"),
    [
        ("verified", None, True),
        ("verified", "type_mismatch", False),
        ("not_extracted", None, True),
        ("not_extracted", "type_mismatch", False),
        ("conflict", None, True),
        ("conflict", "type_mismatch", False),
        ("invalid", "type_mismatch", True),
        ("invalid", None, False),
        ("invalid", "", False),
        ("invalid", "bad code!", False),
        ("invalid", "UPPER_CASE", False),
    ],
)
def test_diagnostic_code_is_required_only_for_invalid(
    status: str, diagnostic: str | None, valid: bool
) -> None:
    row = _row()
    packet = cast(dict[str, Any], row["packet"])
    metric = cast(dict[str, Any], packet["metrics"]["admissions.rate"])
    if status != "verified":
        metric.update(
            extraction_status=status,
            availability_status=None,
            value=None,
            raw_value=None,
            evidence=None,
        )
    metric["diagnostic_code"] = diagnostic
    packet["counts"] = {
        key: int(key == status) for key in ("verified", "not_extracted", "conflict", "invalid")
    }
    def operation() -> object:
        return parse_packet_row(
            row, {"5.0.1": _manifest()}, frozenset({"gemini-routed-extraction-v8"})
        )
    if valid:
        operation()
    else:
        with pytest.raises(ServiceError, match="unsupported/inconsistent"):
            operation()


def test_raw_display_does_not_bypass_manifest_type_validation() -> None:
    row = _row()
    packet = cast(dict[str, Any], row["packet"])
    metric = cast(dict[str, Any], packet["metrics"]["admissions.rate"])
    metric["value"] = "not a number"
    with pytest.raises(ServiceError, match="unsupported/inconsistent"):
        parse_packet_row(row, {"5.0.1": _manifest()}, frozenset({"gemini-routed-extraction-v8"}))


def test_packet_metric_must_exist_in_pinned_historical_manifest() -> None:
    row = _row()
    metric = row["packet"]["metrics"].pop("admissions.rate")  # type: ignore[index]
    row["packet"]["metrics"]["admissions.unknown"] = metric  # type: ignore[index]
    with pytest.raises(ServiceError, match="unsupported/inconsistent"):
        parse_packet_row(row, {"5.0.1": _manifest()}, frozenset({"gemini-routed-extraction-v8"}))


def test_domain_row_carries_internal_evidence_for_phase3_middleware() -> None:
    parsed = parse_packet_row(
        _row(), {"5.0.1": _manifest()}, frozenset({"gemini-routed-extraction-v8"})
    )
    definition = parsed.manifest.domains[0].metrics[0]
    row = read_metric(
        parsed.packet.metrics[definition.ref],
        definition,
        academic_year=2025,
        packet_status="validated",
        definition_match=True,
        currentness="current",
    )
    assert row.evidence is not None
    assert row.evidence["excerpt"] == "Rate 10%"


def _manifest_with_context(version: str = "5.0.1") -> ManifestSnapshot:
    return compile_manifest(
        version,
        {
            "domains": [
                {
                    "id": "admissions",
                    "title": "Admissions",
                    "metrics": [
                        {
                            "id": "admissions.entering_term",
                            "description": "Entering term",
                            "type": "string",
                        },
                        {
                            "id": "admissions.rate",
                            "description": "Admission rate",
                            "type": "number",
                            "unit": "percent",
                            "contexts": [
                                {
                                    "id": "admissions.ctx",
                                    "label": "entering class",
                                    "refs": ["admissions.entering_term"],
                                }
                            ],
                        },
                    ],
                }
            ]
        },
    )


def _row_with_context(extractor: str = "gemini-routed-extraction-v8") -> dict[str, object]:
    packet = {
        "document_sha256": "aa",
        "academic_year": 2025,
        "extraction_id": "00000000-0000-0000-0000-000000000002",
        "manifest_version": "5.0.1",
        "domain_id": "admissions",
        "domain_schema_hash": "bb",
        "extractor_version": extractor,
        "model_id": "model",
        "status": "validated",
        "counts": {"verified": 2, "not_extracted": 0, "conflict": 0, "invalid": 0},
        "provider_contract": {},
        "metrics": {
            "admissions.entering_term": {
                "extraction_status": "verified",
                "availability_status": "reported",
                "value": "Fall 2024",
                "raw_value": None,
                "evidence": {"page_number": 1, "excerpt": "Entering term: Fall 2024"},
            },
            "admissions.rate": {
                "extraction_status": "verified",
                "availability_status": "reported",
                "value": 0.1,
                "raw_value": "10%",
                "evidence": {"page_number": 2, "excerpt": "Rate 10%"},
            },
        },
    }
    return {
        "school_id": 1,
        "academic_year": 2025,
        "document_id": 2,
        "pdf_sha256": b"\xaa",
        "domain_id": "admissions",
        "accepted_packet_status": "validated",
        "packet": packet,
        "extraction_id": packet["extraction_id"],
        "manifest_version": "5.0.1",
        "domain_schema_hash": memoryview(b"\xbb"),
        "current_definition_match": True,
        "currentness": "current",
    }


def test_vintage_carries_period_qualifier_and_no_disclosure_when_domain_has_contexts() -> None:
    """§0.9 mitigation: a domain whose manifest defines contexts still resolves the
    full period-qualified vintage, and does not receive the vintage-loss disclosure."""
    parsed = parse_packet_row(
        _row_with_context(),
        {"5.0.1": _manifest_with_context()},
        frozenset({"gemini-routed-extraction-v8"}),
    )
    definitions = {metric.ref: metric for d in parsed.manifest.domains for metric in d.metrics}
    context_values = {
        ref: (metric, definitions[ref]) for ref, metric in parsed.packet.metrics.items()
    }
    rate_definition = definitions["admissions.rate"]
    row = read_metric(
        parsed.packet.metrics[rate_definition.ref],
        rate_definition,
        academic_year=2025,
        packet_status="validated",
        definition_match=True,
        currentness="current",
        context_values=context_values,
    )
    assert row.vintage == "CDS 2025-26; entering class: Fall 2024"
    assert "vintage_period_unavailable" not in row.caveat_kinds


def test_vintage_is_year_only_and_carries_disclosure_when_context_binder_unresolved() -> None:
    """Second silent-loss path found in review: the manifest declares a context, but
    the binder metric it references wasn't verified/available at read time (e.g. no
    context_values supplied). The for...else correctly omits the half-formed suffix,
    and the caveat must still fire even though `definition.contexts` is non-empty."""
    parsed = parse_packet_row(
        _row_with_context(),
        {"5.0.1": _manifest_with_context()},
        frozenset({"gemini-routed-extraction-v8"}),
    )
    definitions = {metric.ref: metric for d in parsed.manifest.domains for metric in d.metrics}
    rate_definition = definitions["admissions.rate"]
    row = read_metric(
        parsed.packet.metrics[rate_definition.ref],
        rate_definition,
        academic_year=2025,
        packet_status="validated",
        definition_match=True,
        currentness="current",
        # No context_values supplied: the binder never resolves.
    )
    assert row.vintage == "CDS 2025-26"
    assert "vintage_period_unavailable" in row.caveat_kinds


def _manifest_with_two_contexts(version: str = "5.0.1") -> ManifestSnapshot:
    return compile_manifest(
        version,
        {
            "domains": [
                {
                    "id": "admissions",
                    "title": "Admissions",
                    "metrics": [
                        {
                            "id": "admissions.entering_term",
                            "description": "Entering term",
                            "type": "string",
                        },
                        {
                            "id": "admissions.as_of_date",
                            "description": "As-of date",
                            "type": "string",
                        },
                        {
                            "id": "admissions.rate",
                            "description": "Admission rate",
                            "type": "number",
                            "unit": "percent",
                            "contexts": [
                                {
                                    "id": "admissions.ctx_term",
                                    "label": "entering class",
                                    "refs": ["admissions.entering_term"],
                                },
                                {
                                    "id": "admissions.ctx_as_of",
                                    "label": "as of",
                                    "refs": ["admissions.as_of_date"],
                                },
                            ],
                        },
                    ],
                }
            ]
        },
    )


def _row_with_two_contexts(extractor: str = "gemini-routed-extraction-v8") -> dict[str, object]:
    packet = {
        "document_sha256": "aa",
        "academic_year": 2025,
        "extraction_id": "00000000-0000-0000-0000-000000000003",
        "manifest_version": "5.0.1",
        "domain_id": "admissions",
        "domain_schema_hash": "bb",
        "extractor_version": extractor,
        "model_id": "model",
        "status": "validated",
        "counts": {"verified": 2, "not_extracted": 0, "conflict": 0, "invalid": 0},
        "provider_contract": {},
        "metrics": {
            "admissions.entering_term": {
                "extraction_status": "verified",
                "availability_status": "reported",
                "value": "Fall 2024",
                "raw_value": None,
                "evidence": {"page_number": 1, "excerpt": "Entering term: Fall 2024"},
            },
            "admissions.rate": {
                "extraction_status": "verified",
                "availability_status": "reported",
                "value": 0.1,
                "raw_value": "10%",
                "evidence": {"page_number": 2, "excerpt": "Rate 10%"},
            },
        },
    }
    return {
        "school_id": 1,
        "academic_year": 2025,
        "document_id": 2,
        "pdf_sha256": b"\xaa",
        "domain_id": "admissions",
        "accepted_packet_status": "validated",
        "packet": packet,
        "extraction_id": packet["extraction_id"],
        "manifest_version": "5.0.1",
        "domain_schema_hash": memoryview(b"\xbb"),
        "current_definition_match": True,
        "currentness": "current",
    }


def test_vintage_partially_qualified_still_carries_disclosure() -> None:
    """Decision: a metric that declares several contexts but only resolves some of
    them (here `admissions.as_of_date` was never extracted) renders the qualifiers
    it does have rather than dropping them, but still receives the disclosure
    caveat — a partially-qualified vintage is not what the definition promised, and
    the reader must not mistake a partial answer for a complete one."""
    parsed = parse_packet_row(
        _row_with_two_contexts(),
        {"5.0.1": _manifest_with_two_contexts()},
        frozenset({"gemini-routed-extraction-v8"}),
    )
    definitions = {metric.ref: metric for d in parsed.manifest.domains for metric in d.metrics}
    context_values = {
        ref: (metric, definitions[ref]) for ref, metric in parsed.packet.metrics.items()
    }
    rate_definition = definitions["admissions.rate"]
    row = read_metric(
        parsed.packet.metrics[rate_definition.ref],
        rate_definition,
        academic_year=2025,
        packet_status="validated",
        definition_match=True,
        currentness="current",
        context_values=context_values,
    )
    assert row.vintage == "CDS 2025-26; entering class: Fall 2024"
    assert "vintage_period_unavailable" in row.caveat_kinds


def test_vintage_is_year_only_and_carries_disclosure_when_domain_has_no_contexts() -> None:
    """§0.9 mitigation: a domain whose manifest has no context_bindings renders a
    year-only vintage AND an explicit disclosure that the period qualifier is
    unavailable, rather than silently losing the qualifier."""
    parsed = parse_packet_row(
        _row(), {"5.0.1": _manifest()}, frozenset({"gemini-routed-extraction-v8"})
    )
    definition = parsed.manifest.domains[0].metrics[0]
    row = read_metric(
        parsed.packet.metrics[definition.ref],
        definition,
        academic_year=2025,
        packet_status="validated",
        definition_match=True,
        currentness="current",
    )
    assert row.vintage == "CDS 2025-26"
    assert "vintage_period_unavailable" in row.caveat_kinds


def test_manifest_rejects_duplicate_domains_refs_bad_binders_and_hash_coverage() -> None:
    content = {
        "domains": [
            {
                "id": "admissions",
                "metrics": [
                    {
                        "id": "admissions.rate",
                        "description": "Rate",
                        "type": "number",
                        "contexts": [{"id": "ctx", "label": "term", "refs": ["missing.ref"]}],
                    }
                ],
            }
        ]
    }
    with pytest.raises(ServiceError):
        compile_manifest("1", content, {"admissions": "aa"})
    content["domains"][0]["metrics"][0]["contexts"] = []  # type: ignore[index]
    with pytest.raises(ServiceError, match="hashes"):
        compile_manifest("1", content, {})
