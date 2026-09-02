"""Strict anti-corruption boundary for pipeline manifest and packet JSON."""

from __future__ import annotations

import math
from typing import Any, Literal

import structlog
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from counselle_db.formatting import format_decimal
from counselle_db.models import DomainRow, ServiceError

logger = structlog.get_logger(__name__)
_SAFE_PACKET_ERROR = (
    "Stored CDS data for this domain uses an unsupported/inconsistent contract; "
    "no values were returned."
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PacketEvidence(StrictModel):
    page_number: int = Field(ge=1)
    excerpt: str = Field(min_length=1)
    section: str | None = None
    row_label: str | None = None
    column_label: str | None = None

    def model_post_init(self, __context: Any) -> None:
        if not self.excerpt.strip():
            raise ValueError("evidence excerpt must not be blank")


class ParsedMetric(StrictModel):
    ref: str
    extraction_status: Literal["verified", "not_extracted", "conflict", "invalid"]
    availability_status: (
        Literal[
            "reported", "not_reported", "not_applicable", "suppressed", "not_in_template_version"
        ]
        | None
    )
    value: JsonValue | None
    raw_value: str | None
    evidence: PacketEvidence | None
    diagnostic_code: str | None = None


class PacketCounts(StrictModel):
    verified: int = Field(ge=0)
    not_extracted: int = Field(ge=0)
    conflict: int = Field(ge=0)
    invalid: int = Field(ge=0)


class Packet(StrictModel):
    document_sha256: str
    academic_year: int
    extraction_id: str
    manifest_version: str
    domain_id: str
    domain_schema_hash: str
    extractor_version: str
    model_id: str
    status: Literal["validated", "partial"]
    counts: PacketCounts
    metrics: dict[str, ParsedMetric]


class ManifestContext(StrictModel):
    id: str
    label: str
    refs: tuple[str, ...]


class ManifestMetric(StrictModel):
    ref: str
    description: str
    type: Literal["integer", "number", "string", "boolean", "enum"]
    unit: str | None = None
    population: str | None = None
    denominator: str | None = None
    definition_variant: str | None = None
    period_kind: str | None = None
    source_hints: tuple[str, ...] = ()
    contexts: tuple[ManifestContext, ...] = ()


class ManifestDomain(StrictModel):
    id: str
    title: str
    schema_hash: str
    metrics: tuple[ManifestMetric, ...]


class ManifestSnapshot(StrictModel):
    version: str
    domains: tuple[ManifestDomain, ...]


class ParsedPacket(StrictModel):
    packet: Packet
    manifest: ManifestSnapshot
    current_definition_match: bool
    currentness: str


def hex_digest(value: bytes | bytearray | memoryview) -> str:
    return bytes(value).hex()


def compile_manifest(
    version: str,
    content: dict[str, Any],
    domain_hashes: dict[str, Any] | None = None,
) -> ManifestSnapshot:
    if not isinstance(content, dict) or not isinstance(content.get("domains"), list):
        raise ServiceError("Manifest content is invalid.")
    hashes = domain_hashes or {}
    domains: list[ManifestDomain] = []
    seen_domains: set[str] = set()
    seen_refs: set[str] = set()
    for raw_domain in content.get("domains", []):
        domain_id = raw_domain.get("id")
        if (
            not isinstance(raw_domain, dict)
            or not isinstance(domain_id, str)
            or not domain_id.strip()
        ):
            raise ServiceError("Manifest contains an invalid domain identifier.")
        if domain_id in seen_domains:
            raise ServiceError("Manifest contains a duplicate domain identifier.")
        seen_domains.add(domain_id)
        title = raw_domain.get("title", domain_id)
        if not isinstance(title, str) or not title.strip():
            raise ServiceError("Manifest contains an invalid domain title.")
        raw_metrics = raw_domain.get("metrics")
        if not isinstance(raw_metrics, list):
            raise ServiceError("Manifest domain metrics are invalid.")
        metrics: list[ManifestMetric] = []
        for raw_metric in raw_metrics:
            if not isinstance(raw_metric, dict):
                raise ServiceError("Manifest contains an invalid metric definition.")
            raw_ref = raw_metric.get("id")
            if not isinstance(raw_ref, str) or not raw_ref.strip():
                raise ServiceError("Manifest contains an invalid metric identifier.")
            ref = raw_ref
            if ref in seen_refs or ref.count(".") != 1 or not ref.startswith(f"{domain_id}."):
                raise ServiceError("Manifest metric references are invalid or duplicated.")
            seen_refs.add(ref)
            try:
                contexts = tuple(
                    ManifestContext.model_validate(item) for item in raw_metric.get("contexts", [])
                )
            except ValidationError:
                raise ServiceError("Manifest contains an invalid compiled context.") from None
            if any(
                not context.id.startswith(f"{domain_id}.")
                or context.id.count(".") != 1
                or not context.label.strip()
                or not context.refs
                or len(set(context.refs)) != len(context.refs)
                for context in contexts
            ):
                raise ServiceError("Manifest contains an empty compiled context.")
            context_ids = {context.id for context in contexts}
            if len(context_ids) != len(contexts):
                raise ServiceError("Manifest contains a duplicate compiled context.")
            try:
                metric = ManifestMetric(
                    ref=ref,
                    description=raw_metric["description"],
                    type=raw_metric["type"],
                    unit=raw_metric.get("unit"),
                    population=raw_metric.get("population"),
                    denominator=raw_metric.get("denominator"),
                    definition_variant=raw_metric.get("definition_variant"),
                    period_kind=raw_metric.get("period_kind"),
                    source_hints=tuple(raw_metric.get("source_hints", [])),
                    contexts=contexts,
                )
            except (KeyError, ValidationError):
                raise ServiceError("Manifest contains an invalid metric definition.") from None
            if not metric.description.strip() or any(
                not hint.strip() for hint in metric.source_hints
            ):
                raise ServiceError("Manifest contains an invalid metric definition.")
            metrics.append(metric)
        domains.append(
            ManifestDomain(
                id=domain_id,
                title=title,
                schema_hash=_manifest_hash(hashes.get(domain_id)),
                metrics=tuple(metrics),
            )
        )
    if not domains or (domain_hashes is not None and set(hashes) != seen_domains):
        raise ServiceError("Manifest domain hashes are incomplete or inconsistent.")
    snapshot = ManifestSnapshot(version=version, domains=tuple(domains))
    valid_refs = seen_refs
    if any(
        ref not in valid_refs
        for domain in domains
        for metric in domain.metrics
        for ctx in metric.contexts
        for ref in ctx.refs
    ):
        raise ServiceError("Manifest context references an unknown metric.")
    return snapshot


def _manifest_hash(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (bytes, bytearray, memoryview)):
        return hex_digest(value)
    if (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdefABCDEF" for char in value)
    ):
        return value.casefold()
    raise ServiceError("Manifest contains an invalid domain hash.")


def _reject(code: str, row: dict[str, Any]) -> ServiceError:
    logger.warning(
        "cds_packet_rejected",
        code=code,
        school=row.get("school_id"),
        document=row.get("document_id"),
        domain=row.get("domain_id"),
        version=row.get("manifest_version"),
        extraction_id=str(row.get("extraction_id")),
    )
    return ServiceError(_SAFE_PACKET_ERROR)


def parse_packet_row(
    row: dict[str, Any],
    manifests: dict[str, ManifestSnapshot],
    supported_extractors: frozenset[str],
) -> ParsedPacket:
    raw = row.get("packet")
    if not isinstance(raw, dict):
        raise _reject("packet_missing", row)
    payload = dict(raw)
    provider = payload.pop("provider_contract", None)
    if provider is not None and not isinstance(provider, dict):
        raise _reject("provider_contract_invalid", row)
    raw_metrics = payload.get("metrics")
    if not isinstance(raw_metrics, dict):
        raise _reject("metrics_invalid", row)
    if any(
        not isinstance(key, str) or not isinstance(value, dict) or "ref" in value
        for key, value in raw_metrics.items()
    ):
        raise _reject("metrics_invalid", row)
    payload["metrics"] = {key: {"ref": key, **value} for key, value in raw_metrics.items()}
    try:
        packet = Packet.model_validate(payload)
        expected_doc_hash = hex_digest(row["pdf_sha256"])
        expected_domain_hash = hex_digest(row["domain_schema_hash"])
    except (ValidationError, KeyError, TypeError, ValueError):
        raise _reject("packet_shape_invalid", row) from None
    historical = manifests.get(packet.manifest_version)
    historical_domain = (
        next((domain for domain in historical.domains if domain.id == packet.domain_id), None)
        if historical
        else None
    )
    if historical_domain is None:
        raise _reject("packet_manifest_domain_missing", row)
    checks = (
        packet.extractor_version in supported_extractors,
        packet.domain_id == row["domain_id"],
        packet.academic_year == row["academic_year"],
        packet.extraction_id == str(row["extraction_id"]),
        packet.manifest_version == row["manifest_version"],
        packet.status == row["accepted_packet_status"],
        packet.document_sha256 == expected_doc_hash,
        packet.domain_schema_hash == expected_domain_hash,
        packet.manifest_version in manifests,
        not historical_domain.schema_hash
        or packet.domain_schema_hash == historical_domain.schema_hash,
    )
    if not all(checks):
        raise _reject("packet_identity_mismatch", row)
    definitions = {metric.ref: metric for metric in historical_domain.metrics}
    if set(packet.metrics) - set(definitions):
        raise _reject("metric_ref_unknown", row)
    for ref, metric in packet.metrics.items():
        if not ref or ref.count(".") != 1 or not ref.startswith(f"{packet.domain_id}."):
            raise _reject("metric_ref_invalid", row)
        if not _valid_metric_state(metric):
            raise _reject("metric_state_invalid", row)
        try:
            if metric.extraction_status == "verified" and metric.availability_status == "reported":
                _display(metric, definitions[ref])
                # DATABASE_GUIDE §9: never convert unavailable to zero.  A raw cell that
                # carries no digits (a CDS "-"/"N/A" dash) is not a reported number, no
                # matter what the extractor typed alongside it.
                if (
                    definitions[ref].type in {"integer", "number"}
                    and metric.raw_value is not None
                    and metric.raw_value.strip()
                    and not any(char.isdigit() for char in metric.raw_value)
                ):
                    raise ValueError("non-numeric raw for a reported numeric metric")
        except ValueError:
            raise _reject("metric_value_type_invalid", row) from None
    actual = {name: 0 for name in PacketCounts.model_fields}
    for metric in packet.metrics.values():
        actual[metric.extraction_status] += 1
    if actual != packet.counts.model_dump():
        raise _reject("packet_counts_invalid", row)
    return ParsedPacket(
        packet=packet,
        manifest=manifests[packet.manifest_version],
        current_definition_match=bool(row["current_definition_match"]),
        currentness=row.get("currentness") or "current",
    )


def _valid_metric_state(metric: ParsedMetric) -> bool:
    if metric.extraction_status != "verified":
        fields_are_empty = all(
            value is None
            for value in (
                metric.availability_status,
                metric.value,
                metric.raw_value,
                metric.evidence,
            )
        )
        if not fields_are_empty:
            return False
        if metric.extraction_status == "invalid":
            return (
                isinstance(metric.diagnostic_code, str)
                and bool(metric.diagnostic_code)
                and len(metric.diagnostic_code) <= 100
                and metric.diagnostic_code.replace("_", "a").isalnum()
                and metric.diagnostic_code == metric.diagnostic_code.casefold()
            )
        return metric.diagnostic_code is None
    if metric.availability_status == "reported":
        return (
            metric.value is not None
            and metric.evidence is not None
            and metric.diagnostic_code is None
        )
    if metric.availability_status in {
        "not_reported",
        "not_applicable",
        "suppressed",
        "not_in_template_version",
    }:
        return (
            metric.value is None
            and metric.raw_value is None
            and metric.evidence is not None
            and metric.diagnostic_code is None
        )
    return False


def _display(metric: ParsedMetric, definition: ManifestMetric) -> str:
    _validate_typed_value(metric.value, definition)
    if metric.raw_value is not None and metric.raw_value.strip():
        return metric.raw_value.strip()
    value = metric.value
    if definition.type == "boolean" and isinstance(value, bool):
        return "Yes" if value else "No"
    if definition.type == "integer" and isinstance(value, int) and not isinstance(value, bool):
        return f"{value:,}"
    if (
        definition.type == "number"
        and isinstance(value, (int, float))
        and not isinstance(value, bool)
    ):
        if not math.isfinite(float(value)):
            raise ValueError("non-finite")
        return format_decimal(value)
    if definition.type in {"string", "enum"} and isinstance(value, str):
        return value.strip()
    raise ValueError("type mismatch")


def _validate_typed_value(value: JsonValue | None, definition: ManifestMetric) -> None:
    if definition.type == "boolean":
        valid = isinstance(value, bool)
    elif definition.type == "integer":
        valid = isinstance(value, int) and not isinstance(value, bool)
    elif definition.type == "number":
        valid = (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(float(value))
        )
    elif definition.type in {"string", "enum"}:
        valid = isinstance(value, str) and bool(value.strip())
    else:
        valid = False
    if not valid:
        raise ValueError("type mismatch")


def read_metric(
    metric: ParsedMetric,
    definition: ManifestMetric,
    *,
    academic_year: int,
    packet_status: str,
    definition_match: bool,
    currentness: str,
    context_values: dict[str, tuple[ParsedMetric, ManifestMetric]] | None = None,
) -> DomainRow:
    available = (
        metric.extraction_status == "verified"
        and metric.availability_status == "reported"
        and metric.value is not None
        and metric.evidence is not None
    )
    caveats: list[str] = []
    if packet_status == "partial":
        caveats.append("partial_packet")
    if not definition_match:
        caveats.append("definition_drift")
    if currentness == "stale":
        caveats.append("stale_edition")
    if not available and metric.availability_status:
        caveats.append(metric.availability_status)
    vintage = f"CDS {academic_year}-{str(academic_year + 1)[-2:]}"
    qualifiers_resolved = 0
    for context in definition.contexts:
        displays: list[str] = []
        for ref in context.refs:
            pair = (context_values or {}).get(ref)
            if pair is None:
                break
            bound, bound_def = pair
            try:
                displays.append(_display(bound, bound_def))
            except ValueError:
                break
        else:
            vintage += f"; {context.label}: {', '.join(displays)}"
            qualifiers_resolved += 1
    # Invariant: the caveat fires whenever the rendered vintage does not carry every
    # period qualifier the manifest promised for this metric — whether because no
    # contexts are modeled at all, a binder failed to resolve, or only some of
    # several declared contexts resolved. Derived from the actual append count so
    # this can't drift from the loop above.
    if not definition.contexts or qualifiers_resolved < len(definition.contexts):
        caveats.append("vintage_period_unavailable")
    try:
        display = _display(metric, definition) if available else None
    except ValueError:
        raise ServiceError(_SAFE_PACKET_ERROR) from None
    return DomainRow(
        ref=metric.ref,
        label=definition.description,
        display=display,
        available=available,
        availability_status=metric.availability_status,
        value=metric.value if available else None,
        vintage=vintage,
        caveat_kinds=tuple(caveats),
        evidence=(
            {
                "eid": metric.ref,
                "value_display": display,
                "label": definition.description,
                "page": metric.evidence.page_number,
                "section": metric.evidence.section,
                "row_label": metric.evidence.row_label,
                "column_label": metric.evidence.column_label,
                "excerpt": metric.evidence.excerpt,
            }
            if available and metric.evidence is not None and display is not None
            else None
        ),
    )
