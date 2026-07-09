# ADR 0029 — Agent workspace tools call the service layer directly

**Status:** Accepted

## Context

The agent needed full control over the student's workspace tasks: viewing,
searching, creating, updating, archiving, and restoring — the same operations
the HTTP routes already expose through `app/workspace/service_tasks.py`
(ADR 0027). Three integration paths existed: reuse the read-only
`counselle-db` MCP server (ADR 0004), self-call the HTTP routes, or call the
service functions in-process.

ADR 0027 already named the answer for future agent tools ("future agent tools
will call the same service functions directly with `actor='counselle'`; they
will not get a separate mutation path"), but that seam had not yet been built,
and building it raised three further questions: how the tools get scoped to
the right student, how their tool-call receipts should surface on the
timeline, and how they should fail without misleading the model.

## Decision

- **Direct, in-process service calls.** `app/workspace/agent_tools.py` builds
  six PydanticAI tools (`view_tasks`, `search_tasks`, `create_tasks`,
  `update_task`, `archive_tasks`, `restore_task`) that call
  `service_tasks.py` directly with `actor="counselle"`, inside the same
  transaction, change-log, and event-publish path as the HTTP routes. The
  `counselle-db` MCP server is not used — it is a read-only pipeline boundary
  with no `app_pool`, event bus, or write credentials (ADR 0004). HTTP
  self-calls are not used either; they would duplicate ownership checks and
  add a network hop for no isolation benefit.
- **Mount-gated on the authenticated user, not hidden.** The tool factory
  runs only when the turn carries a `user_id` (threaded through `turn_ids`,
  per ADR 0022's turn-state pattern) and the runtime has `app_pool` and
  `workspace_events`. Unauthenticated turns, the eval runner, and the CLI
  never mount these tools — no `user_id` is ever passed, so the tools simply
  do not exist for that run. This is the unmounted-not-hidden pattern from
  ADR 0013's source-toggle gating, reused for identity instead of source
  selection: a hallucinated call to an unmounted tool paints no timeline
  step, it just isn't a callable tool.
- **New `workspace` `StepKind`**, not `db_tool`. `db_tool` receipts drive
  school-source citation chips and engineering-only `row_count` semantics —
  the wrong bucket for the student's own task mutations. `write_plan`
  already established the precedent of a dedicated `StepKind` for a
  non-citation, non-DB-fact tool family. Tier is `null`: a student's own
  workspace data is neither official nor community-sourced.
- **Errors are teaching payloads, not exceptions.** Every semantic failure
  (stale id, invalid link, near-duplicate, unparseable date, blocked
  restore) returns `{"status": "error", "error", "retryable", "recovery",
  ...}` — the same envelope shape Tavily tool results already use. This lets
  `StepMapper` paint error labels for free and lets the model see a
  structured next step instead of catching a raised exception.
  `ModelRetry` is deliberately not used: the correct recovery from most of
  these failures is a *different* tool call (e.g. `view_tasks` for a stale
  id), not a retry of the same call with different args. PydanticAI's
  framework-level schema-validation retry still covers genuinely malformed
  arguments.
- **Reversibility over confirmation gates.** There is no code-level confirm
  flow before a mutation runs. Every mutation is soft (archive sets
  `archived_at`, restore clears it — ADR 0027) and every mutation is
  attributed and logged, so undo is always one call away. The one safety
  rule that matters — confirm before archiving more than two tasks at once,
  or anything "doing"/"waiting" — lives in the system prompt, not in code,
  because the risk here is a wrong bulk action, not an unrecoverable one.

## Rationale

Calling the service layer directly keeps ownership checks, actor
attribution, and change-log rows in the one place HTTP and agent callers
already share (ADR 0027) — no second mutation path to keep in sync. Gating
on `user_id` through `turn_ids` reuses an existing, tested state seam
instead of adding new TurnState surface. A dedicated `StepKind` keeps
citation-chip and row-count semantics meaningful for `db_tool` instead of
overloading it. Teaching-payload errors match the pattern the model already
handles well for Tavily results, so no new failure-handling behavior has to
be learned. Reversibility-over-confirmation avoids building a stateful
confirmation machine for a class of mistakes that soft-delete and restore
already make cheap to undo.

## Alternatives

- **Route agent mutations through the `counselle-db` MCP server.** Rejected
  — that server is read-only by design (ADR 0004) and has no app pool, event
  bus, or write credentials; repurposing it would blur the pipeline
  boundary it exists to protect.
- **Agent tools call the HTTP routes over loopback.** Rejected — adds a
  network hop and duplicate request/response modeling for no isolation
  benefit; the service layer is already the shared seam both callers should
  use (ADR 0027).
- **Reuse `db_tool` as the `StepKind` for workspace mutations.** Rejected —
  `db_tool` receipts carry school-source chip and row-count semantics that
  don't apply to a student's own task rows; conflating them would make both
  receipts harder to reason about.
- **Raise exceptions / use `ModelRetry` for semantic failures.** Rejected —
  most of these failures need a different tool call to recover, not a retry
  of the same call; a structured error payload teaches that directly.
- **Require an explicit confirmation step before mutations (e.g. a
  propose/confirm tool pair).** Rejected as unnecessary machinery given
  every mutation is already soft and reversible; a prompt-level confirm
  rule covers the one class of action (large or in-progress-task archives)
  where confirming first is worth the extra turn.

## Consequences

Agent workspace tools inherit every future change to `service_tasks.py`
automatically, including new ownership rules or link validation, without a
second implementation to update. Anything that wants read-only external
access to workspace data still cannot use these tools' code path — the
`counselle-db` MCP boundary stays intact. The `workspace` `StepKind` needs
its own label and receipt handling wherever `db_tool` is special-cased
(`app/steps.py`, `config/assets/step_labels.yaml`, frontend step-kind
unions), which is ongoing maintenance surface but keeps each kind legible.
Because the safety model is prompt-level, a model that ignores the prompt
rule can still archive more than two tasks in one call — restore is the
backstop, not prevention.
