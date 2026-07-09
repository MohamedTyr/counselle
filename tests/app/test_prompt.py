from __future__ import annotations

import app.prompt as prompt_mod
import config.settings as cfg_mod
import counselle_db.static_map as static_map_mod


def _render_prompt() -> str:
    cfg_mod.reset_config_caches()
    static_map_mod.load_static_map.cache_clear()
    return prompt_mod.build_system_prompt("Today is 2026-06-18.", 2746)


def test_prompt_contains_final_answer_and_viz_guardrails() -> None:
    prompt = _render_prompt()

    assert "do not draft answer prose" in prompt
    assert "write exactly one final answer" in prompt
    assert "once per distinct visualization" in prompt


def test_prompt_contains_agent_planning_and_tool_loop_guidance() -> None:
    prompt = _render_prompt()

    assert "Counselle is an admissions work agent" in prompt
    assert "plan briefly before the first substantive tool call" in prompt
    assert "unless a `write_plan` tool is present" in prompt
    assert "when `write_plan` is present, call it" in prompt
    assert "update the plan as steps start and finish" in prompt
    assert "Use the normal agent loop" in prompt
    assert "Visible operational summaries are allowed" in prompt
    assert "Do not expose hidden chain-of-thought" in prompt
    assert "Do not dump raw JSON" in prompt


def test_prompt_contains_agent_voice_bans() -> None:
    prompt = _render_prompt()

    assert "Do not restate the student's question" in prompt
    assert "repeat the full search query" in prompt
    assert "turn tool arguments into prose" in prompt
    assert "Start the final answer with the answer itself" in prompt
    assert "first sentence must say how the schools differ" in prompt
    assert "\"Of course,\"" in prompt
    assert "\"Let me pull up,\"" in prompt
    assert "\"I've got,\"" in prompt
    assert "\"I've pulled,\"" in prompt
    assert "Do not explain internal data/tool availability" in prompt
    assert "Do not narrate tool plumbing" in prompt
    assert (
        "Attribute claims to the actual source type or institution with citation markers"
        in prompt
    )


def test_prompt_voice_examples_avoid_live_failure_openings() -> None:
    prompt = _render_prompt().lower()

    assert "let me pull duke" not in prompt
    assert "i'll check duke's admissions numbers first" in prompt
    assert "of course. let me pull" not in prompt
    assert "i've got the basics" not in prompt
    assert "i've pulled some initial numbers" not in prompt


def test_prompt_removed_old_chat_and_situational_constraints() -> None:
    prompt = _render_prompt()

    assert "honest and knowledgeable college counselor" not in prompt
    assert "best human counselor" not in prompt
    assert "Clarifying Questions" not in prompt
    assert "use this exact structure in your tool call" not in prompt
    assert "`multi_select`" not in prompt
    assert "In summer (June" not in prompt
    assert "In fall (Aug" not in prompt
    assert "Numbers never appear in your prose for visualizations" not in prompt


def test_prompt_contains_viz_placement_marker_contract() -> None:
    prompt = _render_prompt().lower()

    assert "result_for_agent" in prompt
    assert "display strings" in prompt
    assert "placement_marker" in prompt
    assert "exact returned" in prompt
    assert "[[viz:" in prompt
    assert "wherever the visualization should appear" in prompt
    assert "do not alter it" in prompt
    assert "hidden from the student" in prompt
