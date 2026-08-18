"""Claims + local verification -> packet v8 dict.

**Every packet in the system — model-produced and human-correction — goes
through :func:`build_packet`.** ``extraction_status`` is always computed
locally from claims here; it is never taken from the model or from an admin's
input directly (plan §B5, Risk 3). This mirrors ``counselle_db/packets.py``'s
role on the read side: this is the honesty core of the write side.

Reimplements ``counselle-data-pipeline/library/extractor.py``'s packet-building
functions (recon §3/§4.2) as a single-domain builder — the old code built every
domain of a run in one pass; here the caller (the engine, or the human-review
service) calls :func:`build_packet` once per domain and passes the *same*
``provider_contract`` dict to every call in a run, exactly as the old system
embedded one whole-run contract into every domain's packet (verified against a
live packet in the golden test).
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from decimal import Decimal
from typing import Any

from .claims import Finding, WindowExtraction

EXTRACTION_STATUSES = ("verified", "not_extracted", "conflict", "invalid")


def domain_metric_definitions(
    manifest_content: dict[str, Any], domain_id: str
) -> dict[str, dict[str, Any]]:
    """The qualified-id -> compiled metric definition map for one domain."""
    domain = next((d for d in manifest_content["domains"] if d["id"] == domain_id), None)
    if domain is None:
        raise ValueError(f"unknown domain in manifest: {domain_id!r}")
    return {metric["id"]: metric for metric in domain["metrics"]}


def metric_index(
    manifest_content: dict[str, Any], requested_domains: Iterable[str]
) -> dict[str, tuple[str, dict[str, Any]]]:
    """Qualified metric id -> (domain_id, definition) across a set of domains."""
    wanted = set(requested_domains)
    result: dict[str, tuple[str, dict[str, Any]]] = {}
    for domain in manifest_content["domains"]:
        if domain["id"] in wanted:
            for metric in domain["metrics"]:
                result[metric["id"]] = (domain["id"], metric)
    return result


def provider_contract(
    manifest_content: dict[str, Any], requested_domains: Iterable[str]
) -> dict[str, Any]:
    """The exact pinned contract for a whole run's requested domains, embedded verbatim
    into every packet produced by that run (self-describing evidence, recon §3.2)."""
    requested = tuple(sorted(set(requested_domains)))
    selected = [domain for domain in manifest_content["domains"] if domain["id"] in requested]
    if {domain["id"] for domain in selected} != set(requested):
        raise ValueError("requested domain is missing from the compiled manifest")
    metric_ids = tuple(sorted(metric["id"] for domain in selected for metric in domain["metrics"]))
    return {
        "requested_domains": requested,
        "allowed_metric_ids": metric_ids,
        "metric_definitions": selected,
        "response_schema": WindowExtraction.model_json_schema(),
    }


def typed_value(finding: Finding, metric: dict[str, Any]) -> tuple[object | None, str | None]:
    """Enforce the declared value contract; only lossless normalization is allowed."""
    value = finding.value
    if finding.availability_status != "reported":
        return None, None
    metric_type = metric["type"]
    if metric_type == "integer":
        if type(value) is int:
            return value, None
        # JSON does not distinguish 170 from 170.0; converting an integral float is
        # lossless, so it can never reject a correct extraction.
        if type(value) is float and value.is_integer():
            return int(value), None
        return None, "type_mismatch"
    if metric_type == "number" and type(value) in {int, float}:
        return value, None
    if metric_type == "string" and isinstance(value, str) and value.strip():
        return value, None
    if metric_type == "boolean" and type(value) is bool:
        return value, None
    if (
        metric_type == "enum"
        and isinstance(value, str)
        and value.strip() in metric.get("enums", [])
    ):
        return value.strip(), None
    return None, "type_mismatch"


def semantic_value_key(value: Any) -> tuple[str, Any]:
    """Normalize only representation differences between duplicate claims."""
    if value is None:
        return "none", None
    if type(value) is bool:
        return "boolean", value
    if type(value) in {int, float}:
        number = Decimal(value) if type(value) is int else Decimal(str(value))
        return "number", number
    if isinstance(value, str):
        return "string", " ".join(value.split())
    if isinstance(value, (dict, list)):
        return "json", json.dumps(value, sort_keys=True, separators=(",", ":"))
    return type(value).__name__, repr(value)


def metric_outcome(claims: list[dict[str, Any]], errors: list[str]) -> tuple[dict[str, Any], str]:
    """Resolve one metric's outcome from its accumulated claims/errors this run.

    ``verified``: exactly one distinct (availability_status, semantic value) outcome
    -> pick the claim with lowest (page_number, evidence json, claim json) for
    determinism. ``conflict``: more than one distinct outcome. ``invalid``: zero valid
    claims but >=1 rejected claim. ``not_extracted``: nothing was ever claimed.
    """
    outcomes = {
        (claim["availability_status"], semantic_value_key(claim["value"])) for claim in claims
    }
    if len(outcomes) == 1:
        selected = min(
            claims,
            key=lambda claim: (
                claim["evidence"]["page_number"],
                json.dumps(claim["evidence"], sort_keys=True, separators=(",", ":")),
                json.dumps(claim, sort_keys=True, separators=(",", ":")),
            ),
        )
        return selected, "verified"
    if len(outcomes) > 1:
        return {
            "availability_status": None, "extraction_status": "conflict",
            "value": None, "raw_value": None, "evidence": None,
        }, "conflict"
    if errors:
        return {
            "availability_status": None, "extraction_status": "invalid", "value": None,
            "raw_value": None, "evidence": None, "diagnostic_code": errors[0],
        }, "invalid"
    return {
        "availability_status": None, "extraction_status": "not_extracted",
        "value": None, "raw_value": None, "evidence": None,
    }, "not_extracted"


def _claim_from_finding(finding: Finding, value: object | None) -> dict[str, Any]:
    return {
        "availability_status": finding.availability_status,
        "extraction_status": "verified",
        "value": value if finding.availability_status == "reported" else None,
        "raw_value": finding.raw_value,
        "evidence": {
            "page_number": finding.page_number,
            "excerpt": finding.excerpt,
            "section": finding.section,
            "row_label": finding.row_label,
            "column_label": finding.column_label,
        },
    }


def _collect_claims(
    findings: Iterable[Finding],
    domain_metrics: dict[str, dict[str, Any]],
    allowed_metric_ids: frozenset[str],
    document_page_count: int,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[str]]]:
    by_metric: dict[str, list[dict[str, Any]]] = {metric_id: [] for metric_id in domain_metrics}
    invalid: dict[str, list[str]] = {metric_id: [] for metric_id in domain_metrics}
    for finding in findings:
        if finding.metric_id not in domain_metrics or finding.metric_id not in allowed_metric_ids:
            continue
        if finding.availability_status == "not_reported":
            # The prompt forbids this status: a blank cell is an omission, not a claim.
            continue
        if finding.availability_status == "not_in_template_version" and (
            finding.value is not None or finding.raw_value is not None
        ):
            invalid[finding.metric_id].append("template_absence_has_value")
            continue
        if finding.page_number > document_page_count:
            invalid[finding.metric_id].append("page_not_in_document")
            continue
        value, error = typed_value(finding, domain_metrics[finding.metric_id])
        if error:
            invalid[finding.metric_id].append(error)
            continue
        by_metric[finding.metric_id].append(_claim_from_finding(finding, value))
    return by_metric, invalid


def _resolve_domain_metrics(
    domain_metrics: dict[str, dict[str, Any]],
    by_metric: dict[str, list[dict[str, Any]]],
    invalid: dict[str, list[str]],
    base_metrics: dict[str, dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
    """One outcome per domain metric: freshly resolved, or inherited from
    ``base_metrics`` when nothing this call touched it (the human-review path)."""
    result: dict[str, dict[str, Any]] = {}
    for metric_id in domain_metrics:
        touched = bool(by_metric[metric_id]) or bool(invalid[metric_id])
        if not touched and base_metrics is not None and metric_id in base_metrics:
            result[metric_id] = base_metrics[metric_id]
            continue
        outcome, _status = metric_outcome(by_metric[metric_id], invalid[metric_id])
        result[metric_id] = outcome
    return result


def _packet_status(result_metrics: dict[str, dict[str, Any]]) -> str:
    statuses = [value["extraction_status"] for value in result_metrics.values()]
    if statuses and all(value == "verified" for value in statuses):
        return "validated"
    if "verified" in statuses:
        return "partial"
    return "parse_failed"


def build_packet(
    *,
    manifest_content: dict[str, Any],
    domain_hashes: dict[str, str],
    domain_id: str,
    findings: Iterable[Finding],
    provider_contract: dict[str, Any],
    document_page_count: int,
    document_sha256: bytes,
    academic_year: int,
    extraction_id: str,
    manifest_version: str,
    model_id: str,
    extractor_version: str,
    allowed_metric_ids: frozenset[str] | None = None,
    base_metrics: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build one ``(document, domain)`` packet dict (the ``cds_domain_packets.packet``
    shape, recon §3.1) from a set of claims.

    ``base_metrics`` is the currently-active packet's metric map for this domain
    (plan §B5): a metric with no claim/error contributed by ``findings`` this call
    inherits its prior resolved outcome from there instead of becoming
    ``not_extracted`` — this is how a human correction that only touches a few refs
    stays a full, self-consistent packet. Omit it for a fresh model extraction.
    """
    domain_metrics = domain_metric_definitions(manifest_content, domain_id)
    allowed = allowed_metric_ids if allowed_metric_ids is not None else frozenset(domain_metrics)
    by_metric, invalid = _collect_claims(findings, domain_metrics, allowed, document_page_count)
    result_metrics = _resolve_domain_metrics(domain_metrics, by_metric, invalid, base_metrics)
    counts = {
        key: sum(1 for value in result_metrics.values() if value["extraction_status"] == key)
        for key in EXTRACTION_STATUSES
    }

    return {
        "document_sha256": document_sha256.hex(),
        "academic_year": academic_year,
        "extraction_id": extraction_id,
        "manifest_version": manifest_version,
        "domain_id": domain_id,
        "domain_schema_hash": domain_hashes[domain_id],
        "extractor_version": extractor_version,
        "model_id": model_id,
        "metrics": result_metrics,
        "provider_contract": provider_contract,
        "counts": counts,
        "status": _packet_status(result_metrics),
    }


__all__ = [
    "EXTRACTION_STATUSES",
    "build_packet",
    "domain_metric_definitions",
    "metric_index",
    "metric_outcome",
    "provider_contract",
    "semantic_value_key",
    "typed_value",
]
