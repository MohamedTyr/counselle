"""Compile ``config/cds/`` into the canonical, hashed manifest snapshot.

Reimplements ``counselle-data-pipeline/src/counselle_data_pipeline/library/manifest.py``
(see ``plans/cds-pipeline/recon-old-pipeline.md`` §2) using the Pydantic models in
``manifest_types.py`` as the validation gate, while keeping the actual
canonicalization/hashing algorithm a close, deliberate port of the original —
this module's entire reason to exist is producing **byte-identical** output to
the live manifest (``content_sha256 == c821b2e6...``, plan §B2, Risk 1). Do not
"clean up" the compile algorithm without re-running ``scripts/cds_manifest_check.py``.

Canonical JSON = ``json.dumps(value, sort_keys=True, separators=(",", ":"),
ensure_ascii=False)`` — key order therefore never affects a hash; only the set
of keys and values (recursively) matters. That is what makes the Pydantic
validation layer safe to swap in: it does not alter the raw dicts that flow
into ``content``.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from .manifest_types import (
    EXTRACTION_CONTRACT_VERSION,
    NON_SEMANTIC_METRIC_KEYS,
    Domain,
    ManifestError,
    PeriodKind,
    RootManifest,
)

_ROOT_ALLOWED = {"version", "description", "extraction_groups", "page_routing_enabled"}
_PERIOD_KINDS: frozenset[str] = frozenset(PeriodKind.__args__)  # type: ignore[attr-defined]
_FULL_METRIC_ID_SEP = "."


class _StrictLoader(yaml.SafeLoader):
    """Rejects duplicate mapping keys -- a silent last-key-wins authoring bug."""


def _mapping(loader: _StrictLoader, node: yaml.MappingNode, deep: bool = False) -> dict[str, Any]:
    mapping: dict[str, Any] = {}
    for key_node, value_node in node.value:
        if not isinstance(key_node, yaml.ScalarNode) or key_node.tag != "tag:yaml.org,2002:str":
            raise ManifestError("YAML mapping keys must be text")
        key = key_node.value
        if key in mapping:
            raise ManifestError(f"duplicate YAML key: {key}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping)


def _load(path: Path) -> dict[str, Any]:
    try:
        value = yaml.load(path.read_text(encoding="utf-8"), Loader=_StrictLoader)
    except yaml.YAMLError as error:
        raise ManifestError(f"{path}: invalid YAML: {error}") from error
    if not isinstance(value, dict):
        raise ManifestError(f"{path}: expected a mapping")
    return value


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_bytes(value)).hexdigest()


@dataclass(frozen=True)
class CompiledManifest:
    content: dict[str, Any]
    content_sha256: str
    domain_hashes: dict[str, str]
    provider_schema: dict[str, Any]

    @property
    def version(self) -> str:
        return str(self.content["root"]["version"])


def _validate(model: type[Any], raw: dict[str, Any], path: Path, subject: str) -> None:
    try:
        model.model_validate(raw)
    except ValidationError as error:
        raise ManifestError(f"{path}: invalid {subject}: {error}") from error


def _validate_extraction_groups(root: dict[str, Any], domain_ids: set[str], path: Path) -> None:
    """Groups must partition the configured domains: whole domains, each exactly once."""
    seen: set[str] = set()
    for group in root["extraction_groups"]:
        for domain_id in group:
            if domain_id not in domain_ids:
                raise ManifestError(
                    f"{path}: extraction group references unknown domain {domain_id!r}"
                )
            if domain_id in seen:
                raise ManifestError(f"{path}: extraction groups repeat domain {domain_id!r}")
            seen.add(domain_id)
    missing = sorted(domain_ids - seen)
    if missing:
        raise ManifestError(f"{path}: extraction groups omit domains: {', '.join(missing)}")


def _canonicalize_domains(domains: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expand local authoring IDs to ``<domain_id>.<id>``, once, before hashes and the
    provider schema are built. This is the only place bare local ids get qualified."""
    canonical: list[dict[str, Any]] = []
    for domain in domains:
        domain_id = domain["id"]
        metrics: list[dict[str, Any]] = []
        for authored_metric in domain["metrics"]:
            metric = dict(authored_metric)
            metric["id"] = f"{domain_id}.{authored_metric['id']}"
            formula = metric.get("formula")
            if formula is not None:
                metric["formula"] = {
                    "operation": formula["operation"],
                    "inputs": [
                        reference
                        if _FULL_METRIC_ID_SEP in reference
                        else f"{domain_id}.{reference}"
                        for reference in formula["inputs"]
                    ],
                }
            metrics.append(metric)
        canonical.append({"id": domain_id, "title": domain["title"], "metrics": metrics})
    return canonical


def _select_target_metrics(
    local_metrics: list[dict[str, Any]], targets: dict[str, Any], path: Path
) -> list[dict[str, Any]]:
    """Apply one context binding's target selectors against its own domain's metrics."""
    selected = list(local_metrics)
    for selector, values in targets.items():
        if selector == "all" or values is None:
            continue
        if selector == "source_hints":
            known = {hint for metric in local_metrics for hint in metric["source_hints"]}
            if any(value not in known for value in values):
                raise ManifestError(f"{path}: unknown source_hints selector")
            selected = [m for m in selected if set(m["source_hints"]) & set(values)]
        elif selector == "metric_ids":
            known = {metric["id"].split(".", 1)[1] for metric in local_metrics}
            if any(value not in known for value in values):
                raise ManifestError(f"{path}: unknown metric_ids selector")
            selected = [m for m in selected if m["id"].split(".", 1)[1] in values]
        elif selector == "metric_id_prefixes":
            local_ids = [metric["id"].split(".", 1)[1] for metric in local_metrics]
            if any(
                not any(metric_id.startswith(value) for metric_id in local_ids)
                for value in values
            ):
                raise ManifestError(f"{path}: unknown metric_id_prefixes selector")
            selected = [
                m for m in selected if any(m["id"].split(".", 1)[1].startswith(v) for v in values)
            ]
        elif selector == "period_kinds":
            if any(v not in _PERIOD_KINDS for v in values):
                raise ManifestError(f"{path}: unknown period_kind selector")
            known = {metric["period_kind"] for metric in local_metrics}
            if any(value not in known for value in values):
                raise ManifestError(f"{path}: unmatched period_kind selector")
            selected = [m for m in selected if m["period_kind"] in values]
    return selected


def _resolve_refs(
    binders: list[str], domain_id: str, metric_index: dict[str, Any],
    metric_order: dict[str, int], path: Path,
) -> list[str]:
    refs: list[str] = []
    for binder in binders:
        ref = binder if _FULL_METRIC_ID_SEP in binder else f"{domain_id}.{binder}"
        if ref not in metric_index:
            raise ManifestError(f"{path}: unknown binder reference {ref}")
        refs.append(ref)
    refs.sort(key=metric_order.__getitem__)
    return refs


def _compile_contexts(authored: list[dict[str, Any]], canonical: list[dict[str, Any]]) -> None:
    """Resolve/validate every ``context_bindings`` entry against the fully-qualified
    metric index and attach the compiled ``contexts`` onto each targeted metric
    (mutates ``canonical`` in place). Ported from the old ``manifest.py`` verbatim —
    this selector algebra and the refs-sorted-by-manifest-order rule are hash-critical."""
    all_metrics = (metric for domain in canonical for metric in domain["metrics"])
    metric_order = {metric["id"]: position for position, metric in enumerate(all_metrics)}
    metric_index = {metric["id"]: metric for domain in canonical for metric in domain["metrics"]}
    domain_index = {domain["id"]: domain for domain in canonical}
    dependencies: dict[str, set[str]] = {}
    seen_context_ids: set[str] = set()

    for source in authored:
        domain_id = source["id"]
        path = Path(f"domains/{domain_id}.yaml")
        for binding in source.get("context_bindings", []):
            context_id = f"{domain_id}.{binding['id']}"
            if context_id in seen_context_ids:
                raise ManifestError(f"{path}: duplicate context ID: {context_id}")
            seen_context_ids.add(context_id)
            refs = _resolve_refs(binding["binders"], domain_id, metric_index, metric_order, path)
            local_metrics = domain_index[domain_id]["metrics"]
            selected = _select_target_metrics(local_metrics, binding["targets"], path)
            self_targets = sorted(metric["id"] for metric in selected if metric["id"] in refs)
            if self_targets:
                raise ManifestError(
                    f"{path}: context {context_id} targets its own binder(s): "
                    f"{', '.join(self_targets)}"
                )
            if not selected:
                raise ManifestError(f"{path}: context selectors match no metrics")
            context = {"id": context_id, "label": binding["label"], "refs": refs}
            for metric in selected:
                metric.setdefault("contexts", []).append(context)
                dependencies.setdefault(metric["id"], set()).update(refs)

    _check_cycles(dependencies, "context dependency cycle includes")


def _check_cycles(
    dependencies: dict[str, set[str]] | dict[str, tuple[str, ...]], message: str
) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> None:
        if node in visited:
            return
        if node in visiting:
            raise ManifestError(f"{message} {node}")
        visiting.add(node)
        for dependency in dependencies.get(node, ()):
            visit(dependency)
        visiting.remove(node)
        visited.add(node)

    for node in dependencies:
        visit(node)


def _validate_formula_references(domains: Iterable[dict[str, Any]]) -> None:
    metrics = {metric["id"] for domain in domains for metric in domain["metrics"]}
    dependencies: dict[str, tuple[str, ...]] = {}
    for domain in domains:
        for metric in domain["metrics"]:
            full_id = metric["id"]
            formula = metric.get("formula")
            if formula is None:
                continue
            inputs = tuple(formula["inputs"])
            unknown = sorted(set(inputs) - metrics)
            if unknown:
                raise ManifestError(
                    f"{full_id}: formula references unknown metrics: {', '.join(unknown)}"
                )
            if full_id in inputs:
                raise ManifestError(f"{full_id}: formula cannot reference itself")
            dependencies[full_id] = inputs
    _check_cycles(dependencies, "formula dependency cycle includes")


def _provider_schema(domains: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """One static schema for the model's window findings, never one property per metric."""
    metric_ids = sorted(
        metric["id"]
        for domain in domains
        for metric in domain["metrics"]
        if metric.get("formula") is None
    )
    finding = {
        "type": "object",
        "additionalProperties": False,
        "required": ["metric_id", "availability_status", "raw_value", "page_number", "excerpt"],
        "properties": {
            "metric_id": {"type": "string", "enum": metric_ids},
            "availability_status": {
                "type": "string",
                "enum": [
                    "reported", "not_reported", "not_applicable",
                    "suppressed", "not_in_template_version",
                ],
            },
            "value": {"type": ["integer", "number", "string", "boolean", "null"]},
            "raw_value": {"type": ["string", "null"]},
            "page_number": {"type": "integer", "minimum": 1},
            "section": {"type": ["string", "null"]},
            "row_label": {"type": ["string", "null"]},
            "column_label": {"type": ["string", "null"]},
            "excerpt": {"type": "string", "minLength": 1},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["findings"],
        "properties": {"findings": {"type": "array", "items": finding}},
    }


def _semantic_domain(domain: dict[str, Any], prompt: str) -> dict[str, Any]:
    return {
        "id": domain["id"],
        "metrics": [
            {key: value for key, value in metric.items() if key not in NON_SEMANTIC_METRIC_KEYS}
            for metric in domain["metrics"]
        ],
        "prompt": prompt,
        "contract": EXTRACTION_CONTRACT_VERSION,
    }


def compile_manifest(config_dir: Path) -> CompiledManifest:
    """Load ``config_dir`` (the ``config/cds/`` layout) and produce the immutable,
    content-addressed manifest snapshot. Raises ``ManifestError`` on any authoring
    problem."""
    root_path = config_dir / "manifest.yaml"
    root = _load(root_path)
    if set(root) != _ROOT_ALLOWED:
        raise ManifestError(
            "manifest.yaml must contain exactly version, description, extraction_groups, "
            "and page_routing_enabled"
        )
    _validate(RootManifest, root, root_path, "root")

    prompt_path = config_dir / "extraction-prompt.md"
    try:
        prompt = prompt_path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ManifestError(f"{prompt_path}: missing extraction prompt") from error
    if not prompt.strip():
        raise ManifestError(f"{prompt_path}: prompt must not be empty")

    domains_dir = config_dir / "domains"
    if not domains_dir.is_dir():
        raise ManifestError(f"{domains_dir}: missing domain directory")

    domains: list[dict[str, Any]] = []
    domain_ids: set[str] = set()
    for path in sorted(domains_dir.glob("*.yaml")):
        domain = _load(path)
        domain_id = domain.get("id")
        if domain_id != path.stem:
            raise ManifestError(f"{path}: domain id must match filename")
        if domain_id in domain_ids:
            raise ManifestError(f"duplicate domain ID: {domain_id}")
        domain_ids.add(domain_id)
        _validate(Domain, domain, path, "domain")  # validates nested metrics + context_bindings too
        domains.append(domain)
    if not domains:
        raise ManifestError("no domain files")

    _validate_extraction_groups(root, domain_ids, root_path)
    authored_domains = domains
    domains = _canonicalize_domains(authored_domains)
    _compile_contexts(authored_domains, domains)
    _validate_formula_references(domains)

    domain_hashes = {domain["id"]: _sha256(_semantic_domain(domain, prompt)) for domain in domains}
    provider_schema = _provider_schema(domains)
    content = {
        "root": root,
        "domains": domains,
        "prompt": prompt,
        "extraction_contract_version": EXTRACTION_CONTRACT_VERSION,
    }
    return CompiledManifest(content, _sha256(content), domain_hashes, provider_schema)


__all__ = ["CompiledManifest", "ManifestError", "compile_manifest"]
