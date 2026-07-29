"""Tests for app.skills and app.prompt (Slice E, Phase 4).

All tests are unit-level (no DB, no LLM, no network). The skills loader reads
from the actual ``skills/*/SKILL.md`` tree; the prompt builder reads from
``config/assets/prompts/counselor.md`` and the YAML assets.

Covered behaviors:
1. All model-loadable SKILL.md files parse: name + description non-empty, body non-empty.
2. Each skill body is ≤ 120 lines.
3. load_skill("school-deep-dive") returns body without frontmatter markers.
4. load_skill with an unknown name returns an error string listing valid names.
5. build_system_prompt fills every slot (no un-filled template residue; the six
   slot names do not appear as bare {slot} tokens in the output).
6. build_system_prompt output contains the fake temporal string passed in.
7. build_system_prompt output contains at least one subreddit line ("r/").
8. Calling load_all_skill_meta twice returns the same list (caching works).
9. The retired "dossier-assembly" name is a non-advertised compatibility
   alias for "school-deep-dive": it resolves through validate_selected_skills
   but never appears in the catalog, the model menu, or as a fifth skill.
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
from domain.specs import SourceConfig

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EXPECTED_SKILLS = {
    "school-deep-dive",
    "school-comparison",
    "db-recipes",
    "citation-and-recency",
    "counselor-research",
    "application-rounds",
    "chancing",
    "costs-and-aid",
    "major-and-fit",
    "school-list",
    "testing-strategy",
    "essay-fit",
}

_EXPECTED_USER_SKILL_CATALOG = [
    {
        "name": "application-rounds",
        "display_name": "Application rounds",
        "description": "Choose ED/EA/REA/RD timing and deadline strategy.",
    },
    {
        "name": "chancing",
        "display_name": "Chancing",
        "description": "Classify reach, target, and likely odds without fake predictions.",
    },
    {
        "name": "costs-and-aid",
        "display_name": "Costs and aid",
        "description": "Plan affordability, financial aid, FAFSA/CSS, and scholarships.",
    },
    {
        "name": "essay-fit",
        "display_name": "Essay fit",
        "description": "Find real school-specific details for essays and fit.",
    },
    {
        "name": "major-and-fit",
        "display_name": "Major and fit",
        "description": "Decide major strategy, program fit, and major-specific constraints.",
    },
    {
        "name": "school-comparison",
        "display_name": "School comparison",
        "description": "Compare schools across cost, admissions, outcomes, and fit.",
    },
    {
        "name": "school-deep-dive",
        "display_name": "School deep dive",
        "description": "Build a cited, in-depth look at one school.",
    },
    {
        "name": "school-list",
        "display_name": "School list",
        "description": "Build, trim, or audit a balanced college list.",
    },
    {
        "name": "testing-strategy",
        "display_name": "Testing strategy",
        "description": "Decide SAT/ACT retakes, policies, and submit-or-withhold moves.",
    },
]

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
    selection_group: str | None = None,
    selection_order: str | None = None,
    selection_default: str | None = None,
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
    if selection_group is not None:
        metadata.append(f"selection_group: {selection_group}")
    if selection_order is not None:
        metadata.append(f"selection_order: {selection_order}")
    if selection_default is not None:
        metadata.append(f"selection_default: {selection_default}")
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
# 1–2. All model-loadable skills parse; name + description non-empty; body ≤ 120 lines
# ---------------------------------------------------------------------------


class TestAllSkillsParse:
    def setup_method(self) -> None:
        self.skills_mod = _fresh_skills()
        self.meta = self.skills_mod.load_all_skill_meta()

    def test_all_model_loadable_skills_present(self) -> None:
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
# 3. load_skill("school-deep-dive") returns body without frontmatter
# ---------------------------------------------------------------------------


def test_load_skill_returns_body_without_frontmatter() -> None:
    mod = _fresh_skills()
    body = mod.load_skill("school-deep-dive")
    # Frontmatter block should not appear
    assert "---" not in body[:10], "frontmatter delimiter found in returned body"
    # name: and description: from frontmatter should not be in the body header
    # (they might appear in prose, but the YAML keys themselves shouldn't be raw)
    assert not body.startswith("name:"), "body starts with YAML frontmatter key"
    # Body should contain meaningful content
    assert "resolve_school" in body or "Deep Dive" in body or "Step" in body


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


def test_school_deep_dive_skill_contains_coverage_and_no_fixed_dossier_guidance() -> None:
    mod = _fresh_skills()
    body = mod.load_skill("school-deep-dive")

    assert "resolve, see what's actually" in body or "resolve" in body.lower()
    assert "coverage" in body.lower()
    assert "at most the 2-3 domains" in body
    assert "no fixed tier system" in body
    assert "never a fixed shortlist" in body
    assert "not_found" in body
    assert "official_links" in body
    assert "net-price calculator" in body
    assert "rejected_cells" in body


def test_comparison_skill_contains_agent_defaults_and_etiquette() -> None:
    mod = _fresh_skills()
    body = mod.load_skill("school-comparison")

    assert "no fixed school-count cap" in body
    assert "cost, selectivity, outcomes are common defaults" in body
    assert "edition_mismatch_comparison" in body
    assert "all-or-nothing" in body
    assert "coverage_denominator" in body


def test_db_recipes_pin_denominators_and_structural_manifest_retry() -> None:
    mod = _fresh_skills()
    body = mod.load_skill("db-recipes")

    assert "columns named `covered`, `total`, and `as_of`" in body
    assert body.count("published_at") >= 3
    assert body.count("AS as_of") >= 3
    assert "Copy that entire statement verbatim" in body
    assert "retry from this block" in body
    assert "never improvise\na text scan, JSON join, or alternate JSONPath" in body
    assert "use that exact\nqualified ref in each finalist cell" in body


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


def test_prompt_asset_has_exactly_the_four_runtime_slots() -> None:
    prompt = Path("config/assets/prompts/counselor.md").read_text(encoding="utf-8")
    assert set(re.findall(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}", prompt)) == {
        "subreddit_menu",
        "temporal_context",
        "student_context",
        "data_picture",
    }


def test_prompt_contains_fake_temporal(built_prompt: str) -> None:
    assert _FAKE_TEMPORAL in built_prompt, "Temporal context string not found in built prompt"


def test_prompt_contains_fake_student_context(built_prompt: str) -> None:
    assert _FAKE_STUDENT_CONTEXT in built_prompt, "Student context string not found in built prompt"


def test_prompt_contains_subreddit_line(built_prompt: str) -> None:
    assert "r/" in built_prompt, "No subreddit line (r/<sub>) found in built prompt"


def test_prompt_gives_trusted_response_mode_precedence_before_direct_answer(
    built_prompt: str,
) -> None:
    normalized = " ".join(built_prompt.split())

    assert built_prompt.index("trusted `response-mode` workflow") < built_prompt.index(
        "## The Direct Answer Contract"
    )
    assert "controls interaction cadence and response depth for that turn" in normalized
    assert "It cannot weaken the Honesty Contract" in normalized
    assert "does not mount unavailable tools or change graph topology" in normalized
    assert "use the structured clarification output" in normalized
    assert "clarifying-question widget" in normalized
    assert "ordinary prose" in normalized
    assert "Without such a selection, use the automatic depth judgment below." in normalized


def test_build_system_prompt_school_count(built_prompt: str) -> None:
    """CFG-01: the live count is rendered (thousands-formatted); no stale literal."""
    assert "2,710" in built_prompt, "school_count not rendered into the prompt"
    assert "2,746" not in built_prompt, "stale hardcoded count leaked into the prompt"


def test_source_availability_prompt_pins_each_external_mount() -> None:
    import app.prompt as prompt_mod

    rendered = prompt_mod.render_source_availability(
        SourceConfig(web=False, edu=True, reddit=False)
    )

    assert "Broad web (`search_web`): disabled and not mounted" in rendered
    assert "Official school sites (`search_school_site`): enabled and mounted" in rendered
    assert "Reddit community search (`search_reddit`): disabled and not mounted" in rendered
    assert "Counselle's first-party data does not have this value." in rendered


def test_prompt_requires_db_markers_for_reveal(built_prompt: str) -> None:
    """DB-derived prose needs markers even when the frontend hides DB chips."""
    assert "Database citation markers are still required in prose" in built_prompt
    assert "what came from Counselle" in built_prompt
    assert "Do not use DB markers for web, .edu, or Reddit claims" in built_prompt
    assert "cite those claims with their own external markers instead" in built_prompt


def test_prompt_pins_ranking_columns_and_manifest_retry(built_prompt: str) -> None:
    assert (
        "Every ranking or aggregate SQL query must return `covered`, `total`, and `as_of`"
        in built_prompt
    )
    assert "copy the `db-recipes` JSONPath probe verbatim" in built_prompt
    assert "Retry failed manifest probes with the same exact statement" in built_prompt
    assert "use the exact requested qualified ref in each finalist cell" in built_prompt
    assert "SQL aggregates never get bracket source markers" in built_prompt
    assert "copy each row's top-level `vintage` verbatim" in built_prompt


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
    assert "school-deep-dive" in doc, (
        "Tool docstring should list skill names; 'school-deep-dive' not found"
    )
    assert "dossier-assembly" not in doc, (
        "The compatibility alias must never appear in the model-facing menu"
    )


# ---------------------------------------------------------------------------
# Explicit student selection — authority boundary
# ---------------------------------------------------------------------------


def test_user_catalog_contains_only_opted_in_metadata_in_name_order() -> None:
    mod = _fresh_skills()

    assert mod.user_skill_catalog() == _EXPECTED_USER_SKILL_CATALOG
    names = {entry["name"] for entry in mod.user_skill_catalog()}
    assert {"focused-answer", "deep-research", "guided-counselor"}.isdisjoint(names)
    assert {"citation-and-recency", "counselor-research", "db-recipes"}.isdisjoint(names)
    assert "dossier-assembly" not in names, (
        "The compatibility alias must never be listed as a fifth skill"
    )


def test_response_mode_catalog_is_ordered_browser_safe_and_has_one_default() -> None:
    mod = _fresh_skills()

    assert mod.user_skill_mode_catalog() == [
        {
            "name": "focused-answer",
            "display_name": "Focused Answer",
            "description": "Clear, direct help without unnecessary exploration.",
            "order": 10,
            "default": True,
        },
        {
            "name": "deep-research",
            "display_name": "Deep Research",
            "description": "A thorough, multi-source investigation for complex decisions.",
            "order": 20,
            "default": False,
        },
        {
            "name": "guided-counselor",
            "display_name": "Guided Counselor",
            "description": "Work through it together, one thoughtful question at a time.",
            "order": 30,
            "default": False,
        },
    ]


def test_response_modes_are_not_model_loadable_workflow_skills() -> None:
    mod = _fresh_skills()
    model_menu_names = {entry["name"] for entry in mod.load_all_skill_meta()}

    assert {"focused-answer", "deep-research", "guided-counselor"}.isdisjoint(
        model_menu_names
    )
    assert "focused-answer" in mod.load_skill("focused-answer")
    assert "Available skills:" in mod.load_skill("focused-answer")


def test_public_selection_groups_exposes_response_mode_membership() -> None:
    mod = _fresh_skills()

    assert mod.public_selection_groups()["response-mode"] == frozenset(
        {"focused-answer", "deep-research", "guided-counselor"}
    )


def test_validate_selected_skills_preserves_canonical_input_order() -> None:
    mod = _fresh_skills()

    selected = mod.validate_selected_skills(
        ["focused-answer", "school-comparison", "school-deep-dive"]
    )

    assert selected == ["focused-answer", "school-comparison", "school-deep-dive"]


@pytest.mark.parametrize(
    "names",
    [
        ["school-comparison", "school-comparison"],
        ["db-recipes"],
        ["does-not-exist"],
        ["school-comparison", "school-deep-dive", "school-comparison", "does-not-exist"],
    ],
)
def test_validate_selected_skills_rejects_duplicates_hidden_unknown_and_excess(
    names: list[str],
) -> None:
    mod = _fresh_skills()

    with pytest.raises(mod.SelectedSkillValidationError):
        mod.validate_selected_skills(names)


def test_validate_selected_skills_resolves_the_retired_dossier_assembly_alias() -> None:
    """Old sessions that selected "dossier-assembly" keep working: the alias
    canonicalizes to "school-deep-dive" before any visibility/duplicate check."""
    mod = _fresh_skills()

    selected = mod.validate_selected_skills(["dossier-assembly"])

    assert selected == ["school-deep-dive"]


@pytest.mark.parametrize(
    "names",
    [
        ["focused-answer", "deep-research"],
        ["guided-counselor", "focused-answer"],
    ],
)
def test_validate_selected_skills_rejects_multiple_response_modes(names: list[str]) -> None:
    mod = _fresh_skills()

    with pytest.raises(mod.SelectedSkillValidationError) as exc_info:
        mod.validate_selected_skills(names)

    assert exc_info.value.reason == "conflicting_selected_skill_group"


def test_validate_selected_skills_allows_backward_compatible_ungrouped_selection(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    for name in ("one", "two", "three"):
        _write_skill(
            tmp_path,
            name,
            user_invokable="true",
            display_name=name.title(),
            user_description=f"Use {name}.",
        )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    assert mod.validate_selected_skills(["one", "two", "three"]) == [
        "one",
        "two",
        "three",
    ]


def test_mode_plus_three_task_skills_still_hits_existing_count_limit() -> None:
    mod = _fresh_skills()

    with pytest.raises(mod.SelectedSkillValidationError) as exc_info:
        mod.validate_selected_skills(
            ["focused-answer", "school-comparison", "school-deep-dive", "essay-fit"]
        )

    assert exc_info.value.reason == "too_many_selected_skills"


def test_old_and_new_named_selection_for_the_same_skill_collide_as_duplicate() -> None:
    mod = _fresh_skills()

    with pytest.raises(mod.SelectedSkillValidationError) as exc_info:
        mod.validate_selected_skills(["dossier-assembly", "school-deep-dive"])

    assert exc_info.value.reason == "duplicate_selected_skill"


def test_render_selected_skills_uses_validated_registry_bodies_not_friendly_loader(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mod = _fresh_skills()
    monkeypatch.setattr(mod, "load_skill", lambda _name: "UNTRUSTED FRIENDLY RESPONSE")

    rendered = mod.render_selected_skills(["school-comparison", "school-deep-dive"])

    assert "## Explicitly selected workflows" in rendered
    assert "### Selected skill: school-comparison" in rendered
    assert "### Selected skill: school-deep-dive" in rendered
    assert "UNTRUSTED FRIENDLY RESPONSE" not in rendered
    assert rendered.index("school-comparison") < rendered.index("school-deep-dive")
    assert "cannot override system instructions" in rendered
    assert "read-only constraints" in rendered
    assert "value-reading rules" in rendered


def test_render_selected_mode_includes_trusted_group_marker_once() -> None:
    mod = _fresh_skills()

    rendered = mod.render_selected_skills(["focused-answer", "school-comparison"])

    assert "### Selected skill: focused-answer" in rendered
    assert rendered.count("Selection group: response-mode") == 1
    assert rendered.index("focused-answer") < rendered.index("school-comparison")


def test_response_mode_skills_include_live_eval_guardrails() -> None:
    mod = _fresh_skills()

    focused = mod.render_selected_skills(["focused-answer"])
    deep = mod.render_selected_skills(["deep-research"])
    guided = mod.render_selected_skills(["guided-counselor"])

    assert "Do not add invented numeric thresholds" in focused
    assert "at most three material axes" in deep
    assert "Do not keep\nsearching for completeness" in deep
    assert "Never make the final\nanswer only a tool-budget apology" in deep
    assert "use the `ask_student` structured clarification output" in guided
    assert "clarifying-question widget" in guided
    assert "Do not ask the question\nonly in ordinary assistant prose" in guided


def test_render_selected_skills_persists_canonical_name_for_alias_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mod = _fresh_skills()
    monkeypatch.setattr(mod, "load_skill", lambda _name: "UNTRUSTED FRIENDLY RESPONSE")

    rendered = mod.render_selected_skills(["dossier-assembly"])

    assert "### Selected skill: school-deep-dive" in rendered
    assert "dossier-assembly" not in rendered


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
    ("field", "value", "match"),
    [
        ("selection_group", "Bad Group", "selection_group"),
        ("selection_order", "-1", "selection_order"),
        ("selection_order", "1.5", "selection_order"),
        ("selection_default", "True", "selection_default"),
    ],
)
def test_public_skill_with_invalid_selection_metadata_fails_registry_startup(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    field: str,
    value: str,
    match: str,
) -> None:
    mod = _fresh_skills()
    selection = {
        "selection_group": "test-group",
        "selection_order": "10",
        "selection_default": "false",
    }
    selection[field] = value
    _write_skill(
        tmp_path,
        "public-skill",
        user_invokable="true",
        display_name="Public skill",
        user_description="Use this workflow.",
        **selection,
    )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match=match):
        mod.user_skill_catalog()


def test_grouped_public_skill_requires_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    _write_skill(
        tmp_path,
        "public-skill",
        user_invokable="true",
        display_name="Public skill",
        user_description="Use this workflow.",
        selection_group="test-group",
    )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="selection_order"):
        mod.user_skill_catalog()


def test_default_public_skill_requires_group(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    _write_skill(
        tmp_path,
        "public-skill",
        user_invokable="true",
        display_name="Public skill",
        user_description="Use this workflow.",
        selection_default="true",
    )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="selection_default"):
        mod.user_skill_catalog()


def test_internal_skill_with_invalid_selection_metadata_is_skipped(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    path = _write_skill(
        tmp_path,
        "internal-skill",
        selection_group="test-group",
        selection_order="nope",
    )
    warnings: list[tuple[str, dict[str, object]]] = []

    class WarningLogger:
        def warning(self, event: str, **kwargs: object) -> None:
            warnings.append((event, kwargs))

    monkeypatch.setattr(mod, "_skills_logger", WarningLogger())
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    assert mod.load_all_skill_meta() == []
    assert warnings == [
        (
            "skill file invalid — skipping",
            {"path": str(path), "reason": "selection_order"},
        )
    ]


def test_incomplete_response_mode_group_fails_registry_startup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    _write_skill(
        tmp_path,
        "focused-answer",
        user_invokable="true",
        display_name="Focused Answer",
        user_description="Clear, direct help without unnecessary exploration.",
        selection_group="response-mode",
        selection_order="10",
        selection_default="true",
    )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="exactly the supported modes"):
        mod.user_skill_mode_catalog()


def test_response_mode_group_rejects_duplicate_order(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    for name, display, default in [
        ("focused-answer", "Focused Answer", "true"),
        ("deep-research", "Deep Research", "false"),
        ("guided-counselor", "Guided Counselor", "false"),
    ]:
        _write_skill(
            tmp_path,
            name,
            user_invokable="true",
            display_name=display,
            user_description="Valid mode description.",
            selection_group="response-mode",
            selection_order="10",
            selection_default=default,
        )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="unique selection orders"):
        mod.user_skill_mode_catalog()


def test_response_mode_group_requires_focused_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    mod = _fresh_skills()
    for name, display, order, default in [
        ("focused-answer", "Focused Answer", "10", "false"),
        ("deep-research", "Deep Research", "20", "true"),
        ("guided-counselor", "Guided Counselor", "30", "false"),
    ]:
        _write_skill(
            tmp_path,
            name,
            user_invokable="true",
            display_name=display,
            user_description="Valid mode description.",
            selection_group="response-mode",
            selection_order=order,
            selection_default=default,
        )
    monkeypatch.setattr(mod, "_SKILLS_ROOT", tmp_path)
    _reset_registry_cache(mod)

    with pytest.raises(ValueError, match="focused-answer default"):
        mod.user_skill_mode_catalog()


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
