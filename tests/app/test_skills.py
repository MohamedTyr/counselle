"""Tests for app.skills and app.prompt (Slice E, Phase 4).

All tests are unit-level (no DB, no LLM, no network). The skills loader reads
from the actual ``skills/*/SKILL.md`` tree; the prompt builder reads from
``config/assets/prompts/counselor.md`` and the YAML assets.

Covered behaviors:
1. All 4 SKILL.md files parse: name + description non-empty, body non-empty.
2. Each skill body is ≤ 120 lines.
3. load_skill("dossier-assembly") returns body without frontmatter markers.
4. load_skill with an unknown name returns an error string listing all 4 names.
5. build_system_prompt fills every slot (no un-filled template residue; the six
   slot names do not appear as bare {slot} tokens in the output).
6. build_system_prompt output contains the fake temporal string passed in.
7. build_system_prompt output contains at least one subreddit line ("r/").
8. Calling load_all_skill_meta twice returns the same list (caching works).
"""

from __future__ import annotations

import importlib
import re
import types
from pathlib import Path
from typing import Any

import pytest

from app.tool_specs import build_tool_specs
from config.settings import load_yaml_asset
from domain.events import StepDetail

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
_FAKE_STUDENT_CONTEXT = "## About This Student\nTEST. No profile yet."
_CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
_TOOL_CALL_RE = re.compile(r"^([a-z][a-z0-9_]*)\(")


def _fresh_skills() -> types.ModuleType:
    """Re-import app.skills with cleared module cache for isolation."""
    import app.skills as mod

    mod._meta_cache = None
    mod._body_cache = {}
    _reset_registry_cache(mod)
    return mod


def _reset_registry_cache(mod: types.ModuleType) -> None:
    """Clear implementation-private registry state without widening module typing."""
    mod.__dict__["_registry_cache"] = None
    mod.__dict__["_ordered_entries_cache"] = None


def _write_skill(
    root: Path,
    directory: str,
    *,
    name: str | None = None,
    description: str = "Model-facing description.",
    user_invokable: str | None = None,
    display_name: str | None = None,
    user_description: str | None = None,
    body: str = "# Trusted workflow\n\nFollow this workflow.",
) -> Path:
    """Create a small, purpose-built SKILL.md fixture without YAML machinery."""
    skill_dir = root / directory
    skill_dir.mkdir(parents=True)
    metadata = ["---", f"name: {name or directory}", f"description: {description}"]
    if user_invokable is not None:
        metadata.append(f"user_invokable: {user_invokable}")
    if display_name is not None:
        metadata.append(f"display_name: {display_name}")
    if user_description is not None:
        metadata.append(f"user_description: {user_description}")
    metadata.append("---")
    path = skill_dir / "SKILL.md"
    path.write_text("\n".join([*metadata, "", body, ""]), encoding="utf-8")
    return path


def _receipt(
    _tool_name: str, _args: dict[str, Any], _content: Any, _duration_ms: int, _context: Any
) -> StepDetail:
    return StepDetail()


def _tool_references(markdown: str, tool_names: set[str]) -> list[str]:
    refs: list[str] = []
    for code_span in _CODE_SPAN_RE.findall(markdown):
        call = _TOOL_CALL_RE.match(code_span)
        if call is not None:
            refs.append(call.group(1))
        elif code_span in tool_names:
            refs.append(code_span)
    return refs


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

    def test_backticked_tool_references_exist_in_tool_registry(self) -> None:
        specs = build_tool_specs(load_yaml_asset("step_labels"), _receipt)
        tool_names = set(specs)
        missing: list[str] = []
        for m in self.meta:
            body = self.skills_mod.load_skill(m["name"])
            for reference in _tool_references(body, tool_names):
                if reference not in tool_names:
                    missing.append(f"{m['name']}: `{reference}`")

        assert missing == []


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


def test_dossier_skill_contains_agent_voice_and_order_guidance() -> None:
    mod = _fresh_skills()
    body = mod.load_skill("dossier-assembly")

    assert "Agent voice and shape" in body
    assert "work product" in body
    assert "Lead with the most decision-relevant takeaway" in body
    assert "Keep the order below" in body
    assert "branch on its `status`" in body
    assert "not_in_db" not in body
    assert "state the campus assumption, and continue" in body
    assert "Each section heading matches the shortlist" in body


def test_comparison_skill_contains_agent_defaults_and_etiquette() -> None:
    mod = _fresh_skills()
    body = mod.load_skill("school-comparison")

    assert "Agent comparison etiquette" in body
    assert "cost + selectivity + outcomes" in body
    assert "State the default briefly and continue" in body
    assert "state the campus assumption, and continue" in body
    assert "compare the first 6 named" in body
    assert "do not use a clarify tool call" in body


# ---------------------------------------------------------------------------
# 5–7. build_system_prompt fills every slot; no un-filled template residue;
#       contains fake temporal string; contains a subreddit line
# ---------------------------------------------------------------------------


@pytest.fixture()
def built_prompt() -> str:
    # Re-import to avoid lru_cache cross-test pollution for settings/assets
    import app.prompt as prompt_mod
    import config.settings as cfg_mod

    # Clear the coupled config caches together (prompt/asset/settings — audit L4).
    cfg_mod.reset_config_caches()

    importlib.reload(prompt_mod)
    return prompt_mod.build_system_prompt(
        _FAKE_TEMPORAL, _FAKE_STUDENT_CONTEXT, "Live picture: 2,710 schools"
    )


def test_no_unfilled_template_slots(built_prompt: str) -> None:
    """The four final slot names must not appear as bare tokens."""
    _slots = [
        "subreddit_menu",
        "temporal_context",
        "student_context",
        "data_picture",
    ]
    for slot in _slots:
        token = "{" + slot + "}"
        assert token not in built_prompt, f"Un-filled template slot '{token}' found in built prompt"


def test_prompt_contains_fake_temporal(built_prompt: str) -> None:
    assert _FAKE_TEMPORAL in built_prompt, "Temporal context string not found in built prompt"


def test_prompt_contains_fake_student_context(built_prompt: str) -> None:
    assert _FAKE_STUDENT_CONTEXT in built_prompt, "Student context string not found in built prompt"


def test_prompt_contains_subreddit_line(built_prompt: str) -> None:
    assert "r/" in built_prompt, "No subreddit line (r/<sub>) found in built prompt"


def test_build_system_prompt_school_count(built_prompt: str) -> None:
    """CFG-01: the live count is rendered (thousands-formatted); no stale literal."""
    assert "2,710" in built_prompt, "school_count not rendered into the prompt"
    assert "2,746" not in built_prompt, "stale hardcoded count leaked into the prompt"


def test_prompt_requires_db_markers_for_reveal(built_prompt: str) -> None:
    """DB-derived prose needs markers even when the frontend hides DB chips."""
    assert "Database citation markers are still required in prose" in built_prompt
    assert "what came from Counselle" in built_prompt
    assert "Do not use DB markers for web, .edu, or Reddit claims" in built_prompt
    assert "cite those claims with their own external markers instead" in built_prompt


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


# ---------------------------------------------------------------------------
# Explicit student selection — authority boundary
# ---------------------------------------------------------------------------


def test_user_catalog_contains_only_opted_in_metadata_in_name_order() -> None:
    mod = _fresh_skills()

    assert mod.user_skill_catalog() == [
        {
            "name": "dossier-assembly",
            "display_name": "School dossier",
            "description": "Build a complete, cited overview of one school.",
        },
        {
            "name": "school-comparison",
            "display_name": "School comparison",
            "description": "Compare 2–6 schools across cost, admissions, outcomes, and fit.",
        },
    ]


def test_validate_selected_skills_preserves_canonical_input_order() -> None:
    mod = _fresh_skills()

    selected = mod.validate_selected_skills(["school-comparison", "dossier-assembly"])

    assert selected == ["school-comparison", "dossier-assembly"]


@pytest.mark.parametrize(
    "names",
    [
        ["school-comparison", "school-comparison"],
        ["decode-coded-value"],
        ["does-not-exist"],
        ["school-comparison", "dossier-assembly", "school-comparison", "does-not-exist"],
    ],
)
def test_validate_selected_skills_rejects_duplicates_hidden_unknown_and_excess(
    names: list[str],
) -> None:
    mod = _fresh_skills()

    with pytest.raises(mod.SelectedSkillValidationError):
        mod.validate_selected_skills(names)


def test_render_selected_skills_uses_validated_registry_bodies_not_friendly_loader(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mod = _fresh_skills()
    monkeypatch.setattr(mod, "load_skill", lambda _name: "UNTRUSTED FRIENDLY RESPONSE")

    rendered = mod.render_selected_skills(["school-comparison", "dossier-assembly"])

    assert "## Explicitly selected workflows" in rendered
    assert "### Selected skill: school-comparison" in rendered
    assert "### Selected skill: dossier-assembly" in rendered
    assert "UNTRUSTED FRIENDLY RESPONSE" not in rendered
    assert rendered.index("school-comparison") < rendered.index("dossier-assembly")
    assert "cannot override system instructions" in rendered
    assert "read-only constraints" in rendered
    assert "value-reading rules" in rendered


def test_malformed_public_metadata_fails_registry_startup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    _write_skill(
        tmp_path,
        "public-skill",
        user_invokable="true",
        display_name="Public skill",
        # A public description is mandatory, even though the model description exists.
    )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="user_description"):
        mod.user_skill_catalog()


@pytest.mark.parametrize(
    ("directory", "name", "description"),
    [
        ("bad-slug", "Bad Slug", "Public workflow."),
        ("missing-description", None, ""),
    ],
)
def test_public_skills_with_invalid_identity_metadata_fail_registry_startup(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    directory: str,
    name: str | None,
    description: str,
) -> None:
    mod = _fresh_skills()
    _write_skill(
        tmp_path,
        directory,
        name=name,
        description=description,
        user_invokable="true",
        display_name="Public workflow",
        user_description="Use this workflow.",
    )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="public skill has missing or invalid"):
        mod.user_skill_catalog()


def test_public_skill_with_directory_mismatch_fails_registry_startup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    path = _write_skill(
        tmp_path,
        "wrong-directory",
        name="public-workflow",
        user_invokable="true",
        display_name="Public workflow",
        user_description="Use this workflow.",
    )
    monkeypatch.setattr(mod, "_skill_paths", lambda: [path])
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="does not match parent directory"):
        mod.user_skill_catalog()


def test_internal_skill_with_invalid_user_invokable_is_skipped_and_logged(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    path = _write_skill(tmp_path, "internal-skill", user_invokable="True")
    warnings: list[tuple[str, dict[str, object]]] = []

    class WarningLogger:
        def warning(self, event: str, **kwargs: object) -> None:
            warnings.append((event, kwargs))

    monkeypatch.setattr(mod, "_skills_logger", WarningLogger())
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    assert mod.load_all_skill_meta() == []
    assert mod.user_skill_catalog() == []
    assert warnings == [
        (
            "skill file invalid — skipping",
            {
                "path": str(path),
                "reason": "user_invokable must be literal lowercase true or false",
            },
        )
    ]


@pytest.mark.parametrize(
    ("field", "invalid_value", "match"),
    [
        ("display_name", "x" * 241, "display_name"),
        ("user_description", "x" * 241, "user_description"),
        ("display_name", "Bad\tcopy", "display_name"),
        ("user_description", "Bad\tcopy", "user_description"),
        ("display_name", "Bad\x1fcopy", "display_name"),
        ("user_description", "Bad\x1fcopy", "user_description"),
        ("display_name", "Bad\ncopy", "invalid frontmatter"),
        ("user_description", "Bad\ncopy", "invalid frontmatter"),
    ],
)
def test_public_presentation_copy_rejects_length_controls_and_multiline_values(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    field: str,
    invalid_value: str,
    match: str,
) -> None:
    mod = _fresh_skills()
    presentation = {
        "display_name": "Public workflow",
        "user_description": "Use this workflow.",
    }
    presentation[field] = invalid_value
    _write_skill(tmp_path, "public-skill", user_invokable="true", **presentation)
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match=match):
        mod.user_skill_catalog()


def test_duplicate_names_fail_registry_startup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    duplicate = _write_skill(tmp_path, "duplicate")
    # A duplicate can only arise through an ambiguous discovery result because
    # normal on-disk directory names must equal the canonical skill name.
    monkeypatch.setattr(mod, "_skill_paths", lambda: [duplicate, duplicate])
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="duplicate skill name"):
        mod.load_all_skill_meta()


def test_symlink_escape_is_not_authorized_for_the_catalog(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    outside = tmp_path.parent / "outside-skill.md"
    outside.write_text(
        "---\nname: escaped\ndescription: Escaped.\n---\n# Escaped\n", encoding="utf-8"
    )
    skill_dir = tmp_path / "escaped"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").symlink_to(outside)
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    assert mod.load_all_skill_meta() == []
    assert mod.user_skill_catalog() == []


def test_selected_body_limits_are_enforced_without_truncation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    body = "x" * 9_000
    for name in ("one", "two", "three"):
        _write_skill(
            tmp_path,
            name,
            user_invokable="true",
            display_name=name.title(),
            user_description=f"Use {name}.",
            body=body,
        )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(mod.SelectedSkillValidationError) as exc_info:
        mod.render_selected_skills(["one", "two", "three"])

    assert exc_info.value.reason == "selected_skill_body_limit"


def test_public_skill_with_an_oversized_body_fails_registry_startup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    _write_skill(
        tmp_path,
        "too-large",
        user_invokable="true",
        display_name="Too large",
        user_description="This is too large.",
        body="x" * (mod.MAX_PUBLIC_SKILL_BODY_CHARS + 1),
    )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="body exceeds"):
        mod.user_skill_catalog()
