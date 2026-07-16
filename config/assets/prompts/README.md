# Agent prompts

One file per agent prompt, loaded by name via `load_prompt` (`config/settings.py`, ADR 0018). Prompts are versioned data assets: editorially tunable and reviewable without embedding prose in control flow.

`counselor.md` owns routing and composition behavior, while code owns values,
displays, evidence, and canonical caveat text. Its only runtime format slots are
`data_picture`, `temporal_context`, `student_context`, and `subreddit_menu`.
`data_picture.md` is the template for the live manifest/coverage summary; it must not
hardcode a domain inventory or metric count.
