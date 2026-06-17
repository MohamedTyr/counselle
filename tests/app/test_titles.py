"""CFG-09: the auto-title prompt is a data asset, not an inline string.

Routine (no DB, no LLM): just proves the asset exists and is loadable via the
same ``load_prompt`` seam the counselor/clarifier prompts use.
"""

from __future__ import annotations

from config.settings import load_prompt


def test_title_prompt_loads_from_asset() -> None:
    """``load_prompt("title")`` returns the title-prompt copy from the asset."""
    prompt = load_prompt("title")
    assert prompt.strip()  # non-empty
    assert "name chat conversations" in prompt
