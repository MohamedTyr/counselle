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


def test_prompt_contains_viz_placement_marker_contract() -> None:
    prompt = _render_prompt().lower()

    assert "placement_marker" in prompt
    assert "exact returned" in prompt
    assert "[[viz:" in prompt
    assert "wherever the visualization should appear" in prompt
    assert "do not alter it" in prompt
    assert "hidden from the student" in prompt
