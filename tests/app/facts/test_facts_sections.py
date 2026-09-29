"""`config/assets/facts_sections.yaml` structural exit tests (plan §4.4/§7
Phase 1) — the layout/generator invariants, distinct from the mapper's own
fixture-driven tests in `test_mapper_fixtures.py`.
"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import yaml

import domain.facts.state as state_module
from app.facts.mapper import load_facts_keys
from scripts.build_facts_sections_tabs import owning_tab_for

REPO_ROOT = Path(__file__).resolve().parents[3]
FACTS_SECTIONS_PATH = REPO_ROOT / "config" / "assets" / "facts_sections.yaml"
GENERATOR_PATH = REPO_ROOT / "scripts" / "build_facts_sections_tabs.py"


def _load_sections() -> dict[str, Any]:
    with FACTS_SECTIONS_PATH.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    assert isinstance(data, dict)
    return data


def _iter_groups(data: dict[str, Any]) -> Iterator[tuple[dict[str, Any], dict[str, Any]]]:
    for section in data["sections"]:
        for group in section["groups"]:
            yield section, group


def test_every_facts_entry_declares_a_non_empty_label() -> None:
    data = _load_sections()
    for _section, group in _iter_groups(data):
        for fact in group["facts"]:
            assert isinstance(fact.get("label"), str) and fact["label"].strip(), (
                f"group {group['id']!r} fact {fact.get('key')!r} has no label"
            )


def test_every_group_declares_at_most_one_of_foot_or_foot_ref() -> None:
    data = _load_sections()
    for _section, group in _iter_groups(data):
        assert not ("foot" in group and "foot_ref" in group), group["id"]


def test_every_foot_ref_names_an_existing_non_empty_state_constant() -> None:
    data = _load_sections()
    seen_refs = set()
    for _section, group in _iter_groups(data):
        ref = group.get("foot_ref")
        if ref is None:
            continue
        seen_refs.add(ref)
        assert hasattr(state_module, ref), f"domain.facts.state has no {ref!r}"
        value = getattr(state_module, ref)
        assert isinstance(value, str) and value.strip(), ref
    assert "ENTRANCE_DIFFICULTY_NOTE" in seen_refs


def test_every_facts_entry_tab_equals_facts_keys_yamls_owning_tab() -> None:
    data = _load_sections()
    rules = load_facts_keys()
    for _section, group in _iter_groups(data):
        for fact in group["facts"]:
            expected = owning_tab_for(fact["key"], rules)
            assert fact["tab"] == expected, (
                f"{fact['key']!r}: facts_sections.yaml says tab={fact['tab']!r}, "
                f"facts_keys.yaml says {expected!r}"
            )


def test_every_sections_tabs_is_exactly_the_union_of_its_facts_tabs() -> None:
    data = _load_sections()
    for section in data["sections"]:
        actual_tabs = {fact["tab"] for group in section["groups"] for fact in group["facts"]}
        assert set(section["tabs"]) == actual_tabs, section["id"]
        assert section["tabs"] == sorted(section["tabs"]), "tabs must be sorted"


def test_every_fact_key_listed_in_a_group_is_listed_exactly_once() -> None:
    data = _load_sections()
    seen: dict[str, str] = {}
    for section, group in _iter_groups(data):
        for fact in group["facts"]:
            key = fact["key"]
            location = f"{section['id']}/{group['id']}"
            assert key not in seen, f"{key!r} listed in both {seen.get(key)!r} and {location!r}"
            seen[key] = location


def test_generator_rerun_output_is_byte_identical_to_the_committed_file(tmp_path: Path) -> None:
    """Plan §7 Phase 1's own exit test: re-run the generator (into a scratch
    path, never touching the committed file in place) and diff."""
    committed = FACTS_SECTIONS_PATH.read_bytes()
    scratch = tmp_path / "facts_sections.yaml"
    result = subprocess.run(
        [sys.executable, str(GENERATOR_PATH), str(scratch)],
        cwd=REPO_ROOT,
        capture_output=True,
        timeout=30,
        check=True,
    )
    assert result.returncode == 0, result.stderr.decode()
    regenerated = scratch.read_bytes()
    assert regenerated == committed, (
        "scripts/build_facts_sections_tabs.py's output no longer matches the "
        "committed config/assets/facts_sections.yaml — re-run it and commit "
        "the diff, or the source data changed out from under it"
    )
