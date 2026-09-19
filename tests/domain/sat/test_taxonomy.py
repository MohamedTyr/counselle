"""Taxonomy honesty test (plan.md §3.6 G6; config/assets/sat/taxonomy.yaml).

`Taxonomy` is PURE — the test loads the real YAML asset and validates it,
then cross-checks the ported taxonomy against every (module, domain_cd,
skill_cd) triple College Board's own question-bank stub lists carry
(artifacts/sat-practice/research/list/*.json), the same evidence plan.md §3.1
measured 29 skills / 8 domains from.
"""

import json
from pathlib import Path

import yaml

from domain.sat.taxonomy import Taxonomy

REPO_ROOT = Path(__file__).resolve().parents[3]
TAXONOMY_PATH = REPO_ROOT / "config" / "assets" / "sat" / "taxonomy.yaml"
RESEARCH_LIST_DIR = REPO_ROOT / "artifacts" / "sat-practice" / "research" / "list"

# assessment-99 stub lists: test 1 = Reading & Writing, test 2 = Math (§3.1).
_STUB_FILES = {
    "reading": ["asmt99_test1.json"],
    "math": ["asmt99_test2.json"],
}


def _taxonomy() -> Taxonomy:
    data = yaml.safe_load(TAXONOMY_PATH.read_text())
    return Taxonomy.model_validate(data)


def _research_triples() -> set[tuple[str, str, str]]:
    triples: set[tuple[str, str, str]] = set()
    for module, filenames in _STUB_FILES.items():
        for filename in filenames:
            stubs = json.loads((RESEARCH_LIST_DIR / filename).read_text())
            for stub in stubs:
                triples.add((module, stub["primary_class_cd"], stub["skill_cd"]))
    return triples


def test_taxonomy_has_29_skills_across_8_domains() -> None:
    # Arrange / Act
    taxonomy = _taxonomy()

    # Assert
    skill_codes = taxonomy.skill_codes()
    domain_codes = {domain.code for module in taxonomy.modules for domain in module.domains}
    assert len(skill_codes) == 29
    assert len(domain_codes) == 8


def test_taxonomy_has_no_duplicate_skill_codes() -> None:
    # Arrange / Act
    taxonomy = _taxonomy()

    # Assert — no skill code repeats, i.e. no skill lives in two domains
    skill_codes = taxonomy.skill_codes()
    assert len(skill_codes) == len(set(skill_codes))


def test_taxonomy_has_two_modules_in_display_order() -> None:
    # Arrange / Act
    taxonomy = _taxonomy()

    # Assert
    assert [module.code for module in taxonomy.modules] == ["reading", "math"]


def test_taxonomy_matches_every_stub_triple_from_college_board() -> None:
    # Arrange
    taxonomy = _taxonomy()
    research_triples = _research_triples()

    # Act
    taxonomy_triples = taxonomy.skill_triples()

    # Assert — every (module, domain_cd, skill_cd) College Board's own stub
    # lists carry is present in the ported taxonomy, and nothing extra.
    assert research_triples == taxonomy_triples


def test_find_skill_resolves_module_and_domain() -> None:
    # Arrange
    taxonomy = _taxonomy()

    # Act
    found = taxonomy.find_skill("INF")

    # Assert
    assert found is not None
    module, domain, skill = found
    assert module.code == "reading"
    assert domain.code == "INI"
    assert skill.name == "Inferences"


def test_find_skill_returns_none_outside_taxonomy() -> None:
    # Arrange
    taxonomy = _taxonomy()

    # Act / Assert
    assert taxonomy.find_skill("NOPE") is None


def test_tier_for_band_matches_f7_grouping() -> None:
    # Arrange
    taxonomy = _taxonomy()

    # Act / Assert — Easy 1-3, Medium 4-5, Hard 6-7 (F7)
    assert taxonomy.tier_for_band(1) == "Easy"
    assert taxonomy.tier_for_band(3) == "Easy"
    assert taxonomy.tier_for_band(4) == "Medium"
    assert taxonomy.tier_for_band(5) == "Medium"
    assert taxonomy.tier_for_band(6) == "Hard"
    assert taxonomy.tier_for_band(7) == "Hard"
