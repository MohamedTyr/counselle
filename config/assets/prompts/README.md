# Agent prompts

One file per agent prompt, loaded by name via `load_prompt` (`config/settings.py`, ADR 0018). Prompts are versioned data assets: editorially tunable and reviewable without embedding prose in control flow.

`counselor.md` owns routing and composition behavior, while code owns values,
displays, evidence, and canonical caveat text. Its only runtime format slots are
`data_picture`, `temporal_context`, `student_context`, and `subreddit_menu`.
`data_picture.md` is the template for the live data-picture/coverage summary; it must not
hardcode a fact-key inventory or count.

`essay_partner.md` replaces `counselor.md` for a turn from the essay editor's AI panel
(`Surface.ESSAY`). Its runtime format slots are `essay_context` (the one essay this turn
is about, rendered in code by `app.prompt.render_essay_context`), `student_context`, and
`temporal_context`. It never names a tool it does not have: the essay surface's narrower
tool profile is enforced in code at mount time (ADR 0013), never by this prose.
