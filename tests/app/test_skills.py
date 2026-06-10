"""Tests for app.skills and app.prompt (Slice E, Phase 4).

All tests are unit-level (no DB, no LLM, no network). The skills loader reads
from the actual ``skills/*/SKILL.md`` tree; the prompt builder reads from
``config/assets/prompts/counselor.md`` and the YAML assets.

Covered behaviors:
1. All 4 SKILL.md files parse: name + description non-empty, body non-empty.
2. Each skill body is ≤ 120 lines.
3. load_skill("dossier-assembly") returns body without frontmatter markers.
4. load_skill with an unknown name returns an error string listing all 4 names.
5. build_system_prompt fills every slot (no un-filled template residue; the five
   slot names do not appear as bare {slot} tokens in the output).
6. build_system_prompt output contains the fake temporal string passed in.
7. build_system_prompt output contains at least one subreddit line ("r/").
8. Calling load_all_skill_meta twice returns the same list (caching works).
"""

from __future__ import annotations

import importlib
import types

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EXPECTED_SKILLS = {
    "dossier-assembly",
    "school-comparison",
    "decode-coded-value",
    "citation-and-recency",
}

_FAKE_TEMPORAL = "Today is 2026-06-10. TEST. Season: list-building."


def _fresh_skills() -> types.ModuleType:
    """Re-import app.skills with cleared module cache for isolation."""
    import app.skills as mod

    mod._meta_cache = None
    mod._body_cache = {}
    return mod


# ---------------------------------------------------------------------------
# 1–2. All 4 skills parse; name + description non-empty; body ≤ 120 lines
# ---------------------------------------------------------------------------


class TestAllSkillsParse:
    def setup_method(self) -> None:
        self.skills_mod = _fresh_skills()
        self.meta = self.skills_mod.load_all_skill_meta()

    def test_all_four_skills_present(self) -> None:
        names = {m["name"] for m in self.meta}
        assert names == _EXPECTED_SKILLS, f"Expected skills {_EXPECTED_SKILLS}, got {names}"

    def test_all_names_non_empty(self) -> None:
        for m in self.meta:
            assert m["name"], f"skill entry has empty name: {m}"

    def test_all_descriptions_non_empty(self) -> None:
        for m in self.meta:
            assert m["description"], f"skill '{m['name']}' has empty description"

    def test_all_bodies_non_empty(self) -> None:
        for m in self.meta:
            body = self.skills_mod.load_skill(m["name"])
            assert body and not body.startswith("Skill"), (
                f"skill '{m['name']}' body is empty or an error: {body[:80]}"
            )

    def test_all_bodies_under_120_lines(self) -> None:
        for m in self.meta:
            body = self.skills_mod.load_skill(m["name"])
            line_count = len(body.splitlines())
            assert line_count <= 120, f"skill '{m['name']}' has {line_count} lines (limit 120)"


# ---------------------------------------------------------------------------
# 3. load_skill("dossier-assembly") returns body without frontmatter
# ---------------------------------------------------------------------------


def test_load_skill_returns_body_without_frontmatter() -> None:
    mod = _fresh_skills()
    body = mod.load_skill("dossier-assembly")
    # Frontmatter block should not appear
    assert "---" not in body[:10], "frontmatter delimiter found in returned body"
    # name: and description: from frontmatter should not be in the body header
    # (they might appear in prose, but the YAML keys themselves shouldn't be raw)
    assert not body.startswith("name:"), "body starts with YAML frontmatter key"
    # Body should contain meaningful content
    assert "resolve_school" in body or "Dossier" in body or "Step" in body


# ---------------------------------------------------------------------------
# 4. Unknown skill returns helpful error string listing all 4 names
# ---------------------------------------------------------------------------


def test_unknown_skill_returns_error_listing_names() -> None:
    mod = _fresh_skills()
    result = mod.load_skill("nonexistent-skill-xyz")
    assert "nonexistent-skill-xyz" in result
    for name in _EXPECTED_SKILLS:
        assert name in result, f"error string missing skill name '{name}': {result}"


def test_unknown_skill_does_not_raise() -> None:
    mod = _fresh_skills()
    # Should never raise
    result = mod.load_skill("definitely-not-a-skill")
    assert isinstance(result, str)


# ---------------------------------------------------------------------------
# 5–7. build_system_prompt fills every slot; no un-filled template residue;
#       contains fake temporal string; contains a subreddit line
# ---------------------------------------------------------------------------


@pytest.fixture()
def built_prompt() -> str:
    # Re-import to avoid lru_cache cross-test pollution for settings/assets
    import app.prompt as prompt_mod
    import config.settings as cfg_mod

    # Clear caches that are keyed on the prompt name / asset name
    cfg_mod.load_prompt.cache_clear()
    cfg_mod.load_yaml_asset.cache_clear()

    # Also clear static_map cache
    import counselle_db.static_map as sm_mod

    sm_mod.load_static_map.cache_clear()

    importlib.reload(prompt_mod)
    return prompt_mod.build_system_prompt(_FAKE_TEMPORAL)


def test_no_unfilled_template_slots(built_prompt: str) -> None:
    """The five slot names must not appear as bare {name} tokens."""
    _slots = [
        "static_field_map",
        "dossier_shortlist_summary",
        "subreddit_menu",
        "temporal_context",
        "tier_note",
    ]
    for slot in _slots:
        token = "{" + slot + "}"
        assert token not in built_prompt, f"Un-filled template slot '{token}' found in built prompt"


def test_prompt_contains_fake_temporal(built_prompt: str) -> None:
    assert _FAKE_TEMPORAL in built_prompt, "Temporal context string not found in built prompt"


def test_prompt_contains_subreddit_line(built_prompt: str) -> None:
    assert "r/" in built_prompt, "No subreddit line (r/<sub>) found in built prompt"


def test_prompt_is_non_trivially_long(built_prompt: str) -> None:
    # A fully-assembled prompt should be well over 1000 characters
    assert len(built_prompt) > 1000, f"Built prompt suspiciously short: {len(built_prompt)} chars"


# ---------------------------------------------------------------------------
# 8. Caching: load_all_skill_meta twice returns the same list object
# ---------------------------------------------------------------------------


def test_load_all_skill_meta_cached() -> None:
    mod = _fresh_skills()
    first = mod.load_all_skill_meta()
    second = mod.load_all_skill_meta()
    assert first is second, "load_all_skill_meta should return the same cached list"


# ---------------------------------------------------------------------------
# Bonus: make_load_skill_tool returns a callable with a meaningful docstring
# ---------------------------------------------------------------------------


def test_make_load_skill_tool_has_docstring() -> None:
    mod = _fresh_skills()
    tool_fn = mod.make_load_skill_tool()
    assert callable(tool_fn)
    doc = tool_fn.__doc__ or ""
    assert "dossier-assembly" in doc, (
        "Tool docstring should list skill names; 'dossier-assembly' not found"
    )
