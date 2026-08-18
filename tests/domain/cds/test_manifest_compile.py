"""Manifest compile tests.

The single most important assertion in this file is
``test_ported_config_matches_the_live_manifest_hash`` — the P1 hard gate (plan
§B2, Risk 1). If the ported YAML ever recompiles to a different
``content_sha256``, every active packet in the live database becomes
``current_definition_match = false`` and students see spurious caveats. This
is committed as a regression test per the plan's own instruction.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

from domain.cds.manifest_compile import ManifestError, compile_manifest

LIVE_CONTENT_SHA256 = "c821b2e61cf71f99c1f8503f8940bbce48354b978e091bb81223718784ad6f0a"
CONFIG_DIR = Path(__file__).resolve().parents[3] / "config" / "cds"

_ROOT = {
    "version": "1.0.0",
    "description": "test manifest",
    "page_routing_enabled": False,
    "extraction_groups": [["identity"]],
}
_PROMPT = "Extract only visible values."
_METRIC = {
    "id": "academic_year",
    "description": "The CDS edition academic year.",
    "type": "string",
    "unit": "academic_year",
    "population": "institution",
    "denominator": "none",
    "definition_variant": "reported",
    "period_kind": "academic_year",
    "source_hints": ["A0"],
    "instructions": "Extract the printed academic year.",
}
_IDENTITY_DOMAIN = {"id": "identity", "title": "Identity", "metrics": [_METRIC]}


def _write_manifest(
    config_dir: Path,
    *,
    root: dict[str, Any] | None = None,
    domains: dict[str, dict[str, Any]] | None = None,
) -> None:
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "manifest.yaml").write_text(yaml.safe_dump(root or _ROOT))
    (config_dir / "extraction-prompt.md").write_text(_PROMPT)
    domains_dir = config_dir / "domains"
    domains_dir.mkdir(exist_ok=True)
    for domain_id, domain in (domains or {"identity": _IDENTITY_DOMAIN}).items():
        (domains_dir / f"{domain_id}.yaml").write_text(yaml.safe_dump(domain))


def test_ported_config_matches_the_live_manifest_hash() -> None:
    """The P1 hard gate: byte-identical content_sha256 to the live manifest 5.0.2."""
    compiled = compile_manifest(CONFIG_DIR)
    assert compiled.content_sha256 == LIVE_CONTENT_SHA256
    assert compiled.version == "5.0.2"
    assert set(compiled.content.keys()) == {
        "root", "domains", "prompt", "extraction_contract_version",
    }
    assert len(compiled.content["domains"]) == 13
    assert set(compiled.domain_hashes) == {
        domain["id"] for domain in compiled.content["domains"]
    }


def test_compile_is_deterministic(tmp_path: Path) -> None:
    _write_manifest(tmp_path)
    first = compile_manifest(tmp_path)
    second = compile_manifest(tmp_path)
    assert first.content_sha256 == second.content_sha256
    assert first.domain_hashes == second.domain_hashes


def test_local_metric_ids_are_qualified_to_domain_dot_id(tmp_path: Path) -> None:
    _write_manifest(tmp_path)
    compiled = compile_manifest(tmp_path)
    metric_ids = [m["id"] for d in compiled.content["domains"] for m in d["metrics"]]
    assert metric_ids == ["identity.academic_year"]


def test_provider_schema_omits_formula_metrics_and_lists_all_ids(tmp_path: Path) -> None:
    domain = dict(_IDENTITY_DOMAIN)
    domain["metrics"] = [
        _METRIC,
        {**_METRIC, "id": "computed", "type": "number", "unit": "count", "formula": {
            "operation": "sum", "inputs": ["academic_year", "academic_year"],
        }},
    ]
    _write_manifest(tmp_path, domains={"identity": domain})
    compiled = compile_manifest(tmp_path)
    finding_props = compiled.provider_schema["properties"]["findings"]["items"]["properties"]
    ids = finding_props["metric_id"]["enum"]
    assert ids == ["identity.academic_year"]


def test_context_binding_is_compiled_onto_targeted_metrics(tmp_path: Path) -> None:
    domain = {
        "id": "identity",
        "title": "Identity",
        "metrics": [
            _METRIC,
            {**_METRIC, "id": "reported_value", "source_hints": ["A1"]},
        ],
        "context_bindings": [{
            "id": "year_binding",
            "label": "reporting year",
            "binders": ["academic_year"],
            "targets": {"metric_ids": ["reported_value"]},
        }],
    }
    _write_manifest(tmp_path, domains={"identity": domain})
    compiled = compile_manifest(tmp_path)
    metrics = {m["id"]: m for d in compiled.content["domains"] for m in d["metrics"]}
    assert "contexts" not in metrics["identity.academic_year"]
    assert metrics["identity.reported_value"]["contexts"] == [{
        "id": "identity.year_binding",
        "label": "reporting year",
        "refs": ["identity.academic_year"],
    }]


def test_context_binding_cannot_target_its_own_binder(tmp_path: Path) -> None:
    domain = {
        "id": "identity",
        "title": "Identity",
        "metrics": [_METRIC],
        "context_bindings": [{
            "id": "self_ref",
            "label": "self",
            "binders": ["academic_year"],
            "targets": {"metric_ids": ["academic_year"]},
        }],
    }
    _write_manifest(tmp_path, domains={"identity": domain})
    with pytest.raises(ManifestError, match="targets its own binder"):
        compile_manifest(tmp_path)


def test_extraction_groups_must_partition_every_domain(tmp_path: Path) -> None:
    root = {**_ROOT, "extraction_groups": [["identity"], ["identity"]]}
    _write_manifest(tmp_path, root=root)
    with pytest.raises(ManifestError, match="repeat domain"):
        compile_manifest(tmp_path)


def test_extraction_groups_omitting_a_domain_is_rejected(tmp_path: Path) -> None:
    domain_two = {**_IDENTITY_DOMAIN, "id": "second", "title": "Second"}
    root = {**_ROOT, "extraction_groups": [["identity"]]}
    domains = {"identity": _IDENTITY_DOMAIN, "second": domain_two}
    _write_manifest(tmp_path, root=root, domains=domains)
    with pytest.raises(ManifestError, match="omit domains"):
        compile_manifest(tmp_path)


def test_domain_id_must_match_filename(tmp_path: Path) -> None:
    mismatched = {**_IDENTITY_DOMAIN, "id": "not_identity"}
    _write_manifest(tmp_path, domains={"identity": mismatched})
    with pytest.raises(ManifestError, match="must match filename"):
        compile_manifest(tmp_path)


def test_duplicate_metric_id_within_domain_is_rejected(tmp_path: Path) -> None:
    domain = {**_IDENTITY_DOMAIN, "metrics": [_METRIC, dict(_METRIC)]}
    _write_manifest(tmp_path, domains={"identity": domain})
    with pytest.raises(ManifestError, match="invalid domain"):
        compile_manifest(tmp_path)


def test_unknown_unit_is_rejected(tmp_path: Path) -> None:
    bad_metric = {**_METRIC, "unit": "not_a_real_unit"}
    _write_manifest(tmp_path, domains={"identity": {**_IDENTITY_DOMAIN, "metrics": [bad_metric]}})
    with pytest.raises(ManifestError, match="invalid domain"):
        compile_manifest(tmp_path)


def test_duplicate_yaml_key_is_rejected(tmp_path: Path) -> None:
    _write_manifest(tmp_path)
    (tmp_path / "manifest.yaml").write_text(
        "version: '1.0.0'\ndescription: dup\ndescription: dup again\n"
        "page_routing_enabled: false\nextraction_groups: [[identity]]\n"
    )
    with pytest.raises(ManifestError, match="duplicate YAML key"):
        compile_manifest(tmp_path)


def test_formula_dependency_cycle_is_rejected(tmp_path: Path) -> None:
    a = {**_METRIC, "id": "a", "type": "number", "unit": "count",
         "formula": {"operation": "sum", "inputs": ["b", "b"]}}
    b = {**_METRIC, "id": "b", "type": "number", "unit": "count",
         "formula": {"operation": "sum", "inputs": ["a", "a"]}}
    domain = {**_IDENTITY_DOMAIN, "metrics": [a, b]}
    _write_manifest(tmp_path, domains={"identity": domain})
    with pytest.raises(ManifestError, match="cycle"):
        compile_manifest(tmp_path)
