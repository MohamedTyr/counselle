# ADR 0043 — DeepSeek V4.1 Flash on Fireworks for every live model call

**Status:** Proposed — implemented on `worktree-feat-fireworks-deepseek`; merge
is gated on the plan's eval, judge and browser checks
(`plans/fireworks-deepseek-plan.md` §7), and production traffic on the owner
confirming the Fireworks account's data terms.

Supersedes ADR 0011's *default value* and its "any provider via env, no code
change" claim, and ADR 0034's Gemini thinking protocol (`MINIMAL`/`HIGH`
levels, requested provider thoughts). It also reverses ADR 0028's
`thinking_stream`-on default and deletes its `thinking_summaries` alias. The
rest of those ADRs stands: the model is a per-role Settings value, Quick/Think
are server-owned modes the browser selects only by id, and the run is the
message.

## Context

Every live model call — Quick and Think counselor turns, the goal agent,
goal judge and criteria writer, auto-titles, document summaries and the eval
judge — went to Gemini on Vertex. The owner subscribed to Fireworks and wants
the live path on DeepSeek: cheaper, fast, and as strong as possible in both
modes.

A live probe with the owner's key (2026-09-29) found:

- The only callable serverless DeepSeek is
  `accounts/fireworks/models/deepseek-v4p1-flash`. V4 Pro ids are listed but
  return `404 … not deployed`.
- The model **reasons by default** (823 reasoning tokens for a two-sentence
  answer, 8.9s). `reasoning_effort: "none"` turns it off (1.8s); `low` and
  `high` reason at different depths.
- Tool calling, strict JSON-schema output and streaming all work, with or
  without reasoning.
- The reasoning text is **raw chain of thought**, not a summary.
- With reasoning off, one probe answer was wrong (a reach called a target);
  with reasoning on, it was right.

## Decision

1. **One model for every live role.** Every live model setting
   (`model_counselor`, `model_counselor_think`, `model_cheap`, `model_title`,
   and through their `""` fallbacks `goal_model`, `model_goal_judge`,
   `model_goal_criteria`) defaults to
   `fireworks:accounts/fireworks/models/deepseek-v4p1-flash`. The dead
   `model_clarifier` setting is deleted.
2. **Roles differ by reasoning effort, and every call sends one.**
   `reasoning_effort_quick` (default `low`), `reasoning_effort_think`
   (`high`) and `reasoning_effort_cheap` (`none`: titles, summaries, criteria
   writer, goal judge). A goal turn inherits the Quick/Think effort of the turn
   it started in. The eval judge is a measuring instrument, fixed at `high` by
   a constant in `evals/runner.py`. Quick starts at `low`, not `none`, because
   the probe's only wrong answer came at `none`; the eval set decides whether
   it can move.
3. **The effort lives on the model, not the run.**
   `app/llm.py::build_model(settings, model_setting, *, reasoning_effort)` is
   the only live provider-construction site. The effort is required and
   becomes the model's default settings, so anything that runs on the model
   inherits it — including the goal-only `SummarizingCompaction` tier, which
   builds its own agent from the running model with no run settings. The
   goal judge's `temperature=0.0` merges on top.
4. **Fireworks only, checked at boot.** `build_model` supports the
   `fireworks:` prefix only. A Settings validator rejects any other prefix on
   a live model field at boot (the parked CDS `model_cds_*` fields are not
   checked), and `fireworks_api_key` is a masked secret that must be set
   outside development. Adding a second provider is one branch in
   `build_model` plus an ADR.
5. **The Vertex live path is deleted**, not kept as a fallback:
   `app/vertex.py`, the Vertex prefix check and its error handling, and the
   Gemini thinking config. The parked CDS extraction system keeps its own
   Gemini client (ADR 0038) and is untouched.
6. **Raw reasoning is hidden by default.** `thinking_stream` defaults to
   `false`. DeepSeek cannot be asked to reason without returning its
   reasoning, so the gate is in the emission router: with it off, reasoning
   text is consumed but never streamed or recorded. Shown beside a cited
   answer, raw chain of thought — speculative, with uncited numbers — would be
   read as fact.
7. **Earlier turns' thinking never reaches the model.** The history handed to
   the agent drops every earlier `ThinkingPart` (and any response left empty),
   so a chat started on Gemini does not send its thoughts to DeepSeek as
   `<think>` text. The checkpoint itself is never rewritten, so it keeps each
   turn's raw reasoning even with `thinking_stream` off — retained, never
   shown or replayed to the model.
8. **Cost is priced conservatively** at the highest Global rate Fireworks
   publishes ($0.30 in / $1.20 out per 1M) until the account price is
   confirmed; cached input is not discounted, so the goal budget binds early,
   never late. Every live model must have a price entry or boot fails — an
   unpriced model would cost $0 in the goal ledger and the budget would never
   bind.

## Rationale

Same model, different effort, is the whole Quick/Think distinction the
product needs, and the only serverless DeepSeek leaves no model choice to
make. Putting the effort on the model makes it impossible for a call path to
forget it — the failure mode that matters, because an omitted effort does not
error, it silently reasons at the provider default and costs more and runs
slower. One construction site keeps ADR 0011's mechanism (the model is an env
value) without claiming support for providers nothing tests.

## Alternatives

- **Keep Gemini as a fallback provider.** Rejected: a compatibility layer with
  no current use (house rule), and a fallback that silently changes the model
  would misreport which model answered.
- **`infer_model("fireworks:…")` from the setting string.** Rejected: it reads
  the key from a non-`COUNSELLE_` env var and cannot carry the retry count or
  the model-level effort.
- **Per-run `model_settings` for the effort.** Rejected: the summarizing
  compaction tier runs with no run settings and would reason at the provider
  default.
- **Show the raw reasoning.** Deferred to the owner (plan Q1); off by default
  on honesty grounds.
- **LiteLLM.** Still only if cross-provider fallbacks or budgets are needed
  (ADR 0011).

## Consequences

- Rollback is `git revert` plus working Vertex credentials; an env change
  alone cannot restore Gemini.
- If Fireworks retires or renames the model, every live call fails until one
  setting changes; the failure surfaces as the existing user-safe error.
- Student chats, profiles and essays go to Fireworks instead of Google. The
  account's data terms (retention, training) must be confirmed before
  production traffic, and the app's privacy copy must name Fireworks before
  deploy.
- PydanticAI's DeepSeek profile does not recognise `deepseek-v4p1-*` as
  reasoning-capable; harmless while the effort is always explicit, and pinned
  by `tests/app/test_llm.py`'s request-body tests.
