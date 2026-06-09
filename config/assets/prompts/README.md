# Agent prompts

One file per agent prompt, loaded by name via `load_prompt` (`config/settings.py`, ADR 0018). The actual prompt files land in Phase 4 (agent runtime); until then this directory is an intentional placeholder. Prompts are versioned data assets — editorially tunable, reviewable in diffs, hot-changeable without touching code.
