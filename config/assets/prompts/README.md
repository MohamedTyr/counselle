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

`goal_criteria.md` and `goal_judge.md` are goal mode's two typed-output calls
(plans/goal-mode-plan.md Part 3, `app/goal_judge.py`), each a standalone
`Agent(...)` with typed output — neither is a `counselor.md` substitution and
neither ever mounts a tool. `goal_criteria.md`'s one runtime slot is
`goal_statement` (the student's `/goal` text, verbatim); it turns that
statement into 2-6 frozen, binary, workspace-checkable criteria plus a
mandatory `not_checked_note` naming what is outside Counselle's view (C11).
`goal_judge.md`'s slots are `goal_statement`, `criteria_block`,
`evidence_block`, and `calibration_block`; it is a loop gate, never an
answer validator (D5) — its only effects are the loop's stop/continue
decision and the rendered verdict card, and it is blind to the agent's own
self-report (D4). Both prompts are rendered via `app.asset_format.render_slots`,
the same strict slot mechanism `counselor.md`/`essay_partner.md` use.
