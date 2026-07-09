# Implementation Plan: Agent Workspace Tools — Phase 1: Tasks

Status: Draft — awaiting approval
Branch: feat/mvp3-frontend-prototype (or split to feat/agent-task-tools)
Design basis: ADR 0027 agent seam ("future agent tools call the same service functions directly with `actor='counselle'`"), ADR 0013 (unmounted-not-hidden), ADR 0011 (model/provider agnostic), ADR 0017 (layering)
Date: 2026-07-09

## Goal

Give the Counselle agent full control over the student's **tasks**: six per-run PydanticAI
function tools (`view_tasks`, `search_tasks`, `create_tasks`, `update_task`, `archive_tasks`,
`restore_task`) that wrap `app/workspace/service_tasks.py` directly with `actor="counselle"` —
same transaction, same change log, same ownership checks, same live SSE invalidation as the HTTP
routes. The student sees every agent action twice: as a timeline step in chat and as a live
update on the workspace board with "Counselle" attribution. Tasks are the template; essays,
applications, and activities repeat this pattern in later phases.

## Current state (verified 2026-07-09)

- **The service layer is agent-ready.** `service_tasks.py` has list/create/update/archive/bulk/
  restore with ownership checks (`WHERE user_id`), link validation, transactional
  `workspace_changes` rows, and post-commit event publishing. `Actor = Literal["student",
  "counselle"]` already includes the agent.
- **Nothing is ever hard-deleted.** Zero `DELETE FROM` in workspace code; archive sets
  `archived_at`, restore clears it, application archive cascades via `archived_via_application`.
  This is what makes agent autonomy safe: everything is undoable, attributed, and logged.
- **The agent run has no user identity.** `api/routes/sessions.py:220-256` authenticates and
  passes `user_id` to `TurnRegistry.start` (`app/turns.py:287`), which stores it on
  `_Turn.user_id` (turns.py:209) — but `_drive`'s call (`turns.py:479-485`) drops it;
  `run_turn` (`app/run_turn.py:438`) never receives it. This is the only missing plumbing.
- **Extra-tools pattern exists**: `app/agent_node.py:548-565` appends per-run closures
  (write_plan, render_viz, read_tool_result, load_skill) via `extra_tools`; every result flows
  through `process_tool_result` (overflow spill + `ui` demotion).
- **pg_trgm is already installed** (`migrations/0009_pg_trgm.sql`). `counselle.tasks` has
  `title text NOT NULL`, `notes text`, partial index `tasks_user_active_idx`. **No new
  migration needed.**
- **The FE anticipated this**: `ToolWidgets.tsx` already ships a `task_added` widget;
  `StepKind` on the wire is open (`KnownStepKind | (string & {})`) so new kinds degrade
  gracefully on old clients.
- **Agent tool budget today**: 11 MCP + up to 3 Tavily + 4 extras. +6 brings ~24 mounted max.

## Binding design decisions (locked in design review — do not relitigate)

1. **Direct service calls.** Tools call `service_tasks` in-process. NOT the counselle-db MCP
   child (read-only pipeline boundary, no app_pool/event bus/credentials), NOT HTTP self-calls.
2. **Mount gate = authenticated user.** Tools are built only when the turn carries a `user_id`
   (ADR 0013: unmounted, not hidden). Eval runner and CLI pass no user → tools don't exist.
3. **Model/provider agnostic (ADR 0011).** Flat typed schemas, `Literal` enums, string UUIDs,
   documented string sentinel for field-clearing. No provider-specific tuning anywhere.
4. **Search = Postgres FTS + pg_trgm, no embeddings.** `websearch_to_tsquery` over
   `title || ' ' || coalesce(notes,'')`, trgm similarity fallback for typos. The LLM is the
   synonym layer (docstring teaches OR-joined synonyms + retry-before-concluding-nonexistence).
5. **Errors are teaching payloads, not exceptions.** `{"status":"error", "error", "retryable",
   "recovery", ...}` matching the Tavily envelope — `StepMapper` paints error labels for free;
   `ModelRetry` is wrong because the correct recovery is usually a *different* tool call.
   Framework schema-validation retry still covers genuinely malformed args.
6. **Safety = reversibility, not confirmation gates.** No code-level confirm flow. Prompt-level
   rule: confirm before archiving >2 tasks or anything in-progress. Soft archive + change log +
   visible steps + restore = the undo-based safety model.
7. **New `workspace` StepKind** (not `db_tool`): db_tool receipts route school-source chips and
   eng-only row_count semantics — wrong bucket for user-data mutations; `write_plan` set the
   dedicated-kind precedent; tier is `null` (student's own data — neither official nor
   community).
8. **create_tasks is all-or-nothing; archive_tasks is per-item.** Atomic create means "fix item
   N, resubmit everything" is always safe (partial success is the duplicate-generating trap).
   Archive is naturally idempotent, so skipped ids report and the rest proceed.
9. **Archived rows ARE searchable** (flagged `state: "archived"` per row, no opt-out param).
   Search is the recovery path for "where did that task go" — invisible archived rows would
   make the agent conclude non-existence and create duplicates.

## Part A — Tool interface spec (implement verbatim)

### Shared conventions

- Factory `build_workspace_tools(app_pool, workspace_events, user_id: UUID, tool_overflow)
  -> list[Tool[Any]]` in **new module `app/workspace/agent_tools.py`**; closures hardcode
  `actor="counselle"`; every return goes through `process_tool_result(payload, tool_overflow,
  tool_name=...)`. Never raise for semantic failures; catch `WorkspaceNotFoundError` /
  `WorkspaceValidationError` / asyncpg errors → error payloads.
- **IDs**: full lowercase UUID strings under `id`; params typed `str` (not `UUID`) so bad ids
  hit our curated error, not a framework retry. **Dates**: `YYYY-MM-DD` in and out; timestamps
  (`created_at`/`updated_at`) never shown; every read result carries `"today"` once.
- **Null omission**: task rows omit null/default-false fields. **Enums**: `Literal[...]` params
  so valid values live in the tool schema (no result-side legend).
- Success envelope: `{"status": "ok"|"warning", "summary": "<one line>", ..., "footer": ...}`.
- **Task row shape** (key order fixed; nulls omitted): `id, title, status, category, priority,
  assignee, needs_input, due, planned, reminder, app, essay, notes, completed, state`.
  `app`/`essay` are **names** (the model reasons in names; write-ids come from `link_targets`).
  `notes` truncated at 120 chars + `…`. `completed` only on done rows; `state` only in search
  results. Never: `user_id`, raw link UUIDs per row, `archived_via_application`.
- **`link_targets` block** (in view results + invalid-link errors): compact ` · `-joined
  strings, active rows only, capped 30 + `"+N more"`:
  `{"applications": ["<uuid> · Duke University (RD, deadline 2027-01-02)", ...],
    "essays": ["<uuid> · Why Duke? (Duke University)", ...]}`

### A.1 `view_tasks`

```python
async def view_tasks(
    status: Literal["active", "todo", "doing", "waiting", "done", "all"] = "active",
    application_id: str | None = None,
    essay_id: str | None = None,
    done_within_days: int = 30,
    limit: int = 25,
) -> dict[str, Any]:
```

Docstring (the LLM contract, verbatim):

```
View the student's task board — the shared workspace you and the student both see.

Defaults to the active working set (todo, doing, waiting), sorted by urgency:
earliest due date first (undated last), then priority high to low. Call this
before discussing, creating, or changing tasks — it returns current task ids,
and every mutation tool requires an id echoed from here or from search_tasks.

The result also lists link_targets: the active applications and essays
(id · name) that tasks can link to. Use those exact ids for application_id /
essay_id when creating or updating tasks.

Completed tasks are hidden by default; the footer says how many exist and how
recent they are. Fetch them with status="done". Archived tasks never appear
here — search_tasks finds them.

Args:
    status: Which slice to show. "active" (default) = todo + doing + waiting;
        a single status name; or "all" = active plus done.
    application_id: Only tasks linked to this application (exact id from
        link_targets).
    essay_id: Only tasks linked to this essay (exact id from link_targets).
    done_within_days: When done tasks are in scope, only those completed in
        the last N days (default 30). Raise it to look further back.
    limit: Maximum rows returned (default 25). The footer reports anything
        beyond the cap and how to narrow.
```

Returns: `{"status","today","summary","tasks":[rows],"link_targets",{...},"footer"}`.
Sort: due asc nulls-last → priority high>med>low → created_at asc (done view: completed desc).
Footer always computes done/archived counts (one aggregate query):
`"Showing 8 of 8 active tasks. 34 done (6 in the last 30 days) — view_tasks(status=\"done\")
to see them. 2 archived — search_tasks finds them."` Over-cap: deterministic truncation +
`"Showing 25 of 41 — narrow with application_id, essay_id, or status."` Filtered-empty must
never read as globally empty: `"No active tasks linked to Duke University."` + footer
`"12 active tasks exist elsewhere — call view_tasks() without filters."` Empty board: footer
suggests offering starter tasks via create_tasks linked to `link_targets` applications.

### A.2 `search_tasks`

```python
async def search_tasks(query: str, limit: int = 15) -> dict[str, Any]:
```

Docstring (verbatim):

```
Full-text search across ALL of the student's tasks — active, completed, and
archived. Matches title and notes, tolerates typos and partial words.

Use this to find a specific task that isn't in the view_tasks active set:
past work ("did we finish the FAFSA?"), possibly-archived items, or anything
you remember by wording rather than by id.

Query tips: use plain keywords, not sentences. Include synonyms joined with
OR — students and counselors name the same work differently ("LOR OR
recommendation OR rec letter", "aid OR FAFSA OR CSS profile"). Quoted phrases
match exactly; prefix a word with - to exclude it. If a query finds nothing,
rephrase with different synonyms and try once or twice more BEFORE concluding
the task does not exist — a false "there's no such task" misleads the student
just like an invented fact does.

Every hit carries state: "active", "done", or "archived". Archived hits are
off the student's board; offer restore_task if the student wants one back.

Args:
    query: Keywords with OR-joined synonyms. Not a full sentence.
    limit: Maximum hits, most relevant first (default 15).
```

Returns rows with `state` per hit (+ `archived` date on archived hits) and a `match` key —
a `ts_headline` snippet ≤140 chars with `«»` delimiters, omitted when the match is in the
title. Order: FTS rank desc; trgm similarity ≥ 0.3 fallback when FTS is empty (typos).
Footer (`"Archived hits can be restored with restore_task(...)"`) only when ≥1 archived hit.
Empty result is `status:"ok"` with a retry-teaching footer, NOT an error.

### A.3 `create_tasks` (batch, all-or-nothing)

```python
class TaskDraft(BaseModel):
    title: str                      # imperative, e.g. "Request transcript from registrar"
    notes: str | None = None
    status: Literal["todo", "doing", "waiting", "done"] = "todo"
    category: Literal["essay", "lor", "aid", "research", "form", "interview", "other"] = "other"
    priority: Literal["low", "med", "high"] = "med"
    assignee: Literal["student", "counselle"] = "student"   # "counselle" only for own work
    needs_input: bool = False       # blocked on the student telling you something
    due: str | None = None          # YYYY-MM-DD
    planned_for: str | None = None
    reminder: str | None = None
    application_id: str | None = None   # exact id from link_targets
    essay_id: str | None = None

async def create_tasks(tasks: list[TaskDraft], force: bool = False) -> dict[str, Any]:
```

1–20 items enforced in the wrapper (agent bypasses HTTP rate limits — this is the boundary
cap). **Duplicate guard**: trgm similarity of each draft title vs *active* task titles,
threshold 0.6 → soft-block the whole batch with the match listed; `force=true` overrides
(returns `status:"warning"` + `warnings` list). Docstring (verbatim):

```
Create one or more tasks on the student's board. All-or-nothing: either every
task in the batch is created, or none are — a rejected batch creates nothing,
so it is always safe to fix the reported item and resubmit the whole batch.

Check view_tasks (or search_tasks) first so you don't duplicate existing
work. If a draft's title is nearly identical to an existing active task, the
whole batch is rejected with the matching task listed; either update that
existing task instead, or resubmit with force=true if the student really
wants a separate task.

Link each task to its application and/or essay whenever one clearly applies,
using exact ids from view_tasks link_targets — linked tasks appear on that
application's page. Defaults per task: status "todo", category "other",
priority "med", assignee "student".

Args:
    tasks: The tasks to create, 1–20 per call.
    force: True only to re-submit a batch that was rejected as a
        near-duplicate after confirming it is genuinely separate work.
```

Returns `created: [{id, title}, ...]` only (the model supplied every other field one message
ago; echoing is token waste) + footer `"The student sees these on their board now."`
Emits `ui` payload for the step widget (see Part B.3).

### A.4 `update_task` (single, flat patch)

```python
async def update_task(
    task_id: str,
    title: str | None = None,
    notes: str | None = None,
    status: Literal["todo", "doing", "waiting", "done"] | None = None,
    category: Literal["essay", "lor", "aid", "research", "form", "interview", "other"] | None = None,
    priority: Literal["low", "med", "high"] | None = None,
    assignee: Literal["student", "counselle"] | None = None,
    needs_input: bool | None = None,
    due: str | None = None,
    planned_for: str | None = None,
    reminder: str | None = None,
    application_id: str | None = None,
    essay_id: str | None = None,
) -> dict[str, Any]:
```

**The clear-a-field rule**: `None` = unchanged; the string `"clear"` clears (clearable: notes,
due, planned_for, reminder, application_id, essay_id). A documented string sentinel is the only
mechanism that serializes identically across every provider; the wrapper maps it to an
explicitly-set `None` in `TaskPatch`. Docstring (verbatim):

```
Change one existing task. Only the fields you pass change; everything else is
untouched.

task_id must be an exact id echoed from a view_tasks or search_tasks result
in this conversation — never construct or guess an id. Typical moves: status
"doing" when work starts, "done" when finished (completion time is recorded
automatically — use this instead of archiving finished work), priority or due
changes, flipping needs_input, or linking the task to an application/essay
using ids from view_tasks link_targets.

To CLEAR an optional field, pass the string "clear" for that field
(clearable: notes, due, planned_for, reminder, application_id, essay_id).

Args:
    task_id: The task's id, echoed exactly from a prior result.
    ... (per-field lines as in A.3 schema descriptions)
```

Returns **full task row** (unlike create: the final state is a merge with fields the model may
not have seen — or that the student changed from the UI mid-conversation; ~50 tokens makes a
confirm-read redundant and prevents state drift) + `summary` naming only changed fields: `"Updated \"…\" — status → doing,
due → 2026-07-15."`

### A.5 `archive_tasks` (batch, per-item)

```python
async def archive_tasks(task_ids: list[str]) -> dict[str, Any]:
```

1–20 ids. Wrapper fetches rows in the same transaction (to report titles), then
`bulk_archive`. Docstring (verbatim):

```
Remove tasks from the student's board. This is a soft delete — restore_task
brings any of them back exactly as they were.

Use for tasks that are no longer relevant: wrong school, duplicates, a plan
that changed. Do NOT archive finished work — mark it done with update_task
so the record of progress stays visible.

Confirm with the student first before archiving more than two tasks at once,
or any task that is in "doing" or "waiting". Each id must be echoed from a
prior view_tasks or search_tasks result. Unknown or already-archived ids are
skipped and reported; the rest still archive.

Args:
    task_ids: Ids of the tasks to archive, 1–20.
```

Returns `archived: [{id, title}], skipped: [{id, reason}]` — titles echoed deliberately so the
model notices a wrong archive while restore is one call away. Partial → `status:"warning"`;
all-skipped → the stale-id error payload. Footer: `"restore_task(task_id=...) undoes any of
these."`

### A.6 `restore_task` (single)

```python
async def restore_task(task_id: str) -> dict[str, Any]:
```

Docstring (verbatim):

```
Bring one archived task back to the student's board, exactly as it was.

Find archived tasks with search_tasks — hits marked state "archived". A task
whose linked application or essay is itself archived cannot be restored on
its own: restore the application first (that brings back its tasks and
essays together), or recreate the task without the link using create_tasks.

Args:
    task_id: The archived task's id, echoed from a search_tasks result.
```

Returns full task row + `summary: "Restored \"…\" to the active board."`

### A.7 Error payloads (exact strings; all include `"status": "error"`)

| Case | error | retryable | recovery |
|---|---|---|---|
| Stale/foreign/archived task_id (incl. ownership — never reveal existence) | `No active task with id "…". It may have been archived, completed and pruned from your view, or the id may be stale.` | false | `Call view_tasks to see current active tasks and their ids, or search_tasks if it may be done or archived (archived tasks come back with restore_task). Do not retry this same id.` |
| Invalid app/essay link | `tasks[2]: application_id "…" does not match any active application in this student's workspace. Nothing was created.` | true | `Pick the exact id from link_targets below and resubmit the whole batch, or omit the link if none fits.` + **`link_targets` shipped inside the error** (saves the discovery round-trip) |
| Near-duplicate create | `tasks[0] "…" is nearly identical to the existing active task "…" (id …, status doing). Nothing was created.` | true | `Update the existing task instead (update_task), or if the student genuinely wants a separate task, resubmit the same batch with force=true.` |
| Unparseable date | `due "July 15" is not a valid date.` | true | `Resubmit with the date as YYYY-MM-DD, e.g. "2026-07-15". Pass "clear" to remove a date.` |
| Restore blocked (archived parent) | `"…" can't be restored on its own — its linked application (UCLA) is archived.` | false | `Restore the application first (that also restores its tasks and essays), or recreate the task without the link via create_tasks.` |
| Restore of non-archived task | `That task is not archived — it is already on the active board.` | false | `No action needed. view_tasks confirms its current state.` |

Empty search / empty board are `status:"ok"` with teaching footers (A.1/A.2), never errors.
Idempotency-by-convergence: double-fired mutations resolve to teaching payloads, not blind errors.

## Part B — Integration changes (file-by-file, verified anchors)

### B.1 Identity plumbing (the only new plumbing in the system)

1. `app/run_turn.py:438` — add kw-only `user_id: str | None = None` to `run_turn`.
2. `app/run_turn.py:484-488` — add `"user_id": user_id` to the initial `turn_ids` dict. Both
   prepare branches (fresh spread at 351/356; parked spread + `aupdate_state` pre-write at
   331-345) then carry it with zero further changes.
3. `app/turns.py:479-485` — `_drive` passes `user_id=turn.user_id`.
4. `app/state.py:75-79` — document `user_id` in the `turn_ids` docstring (no TypedDict change).
5. `app/agent_node.py` — **hoist `ids = _turn_ids(state)` from line ~613 to above the toolset
   block (~548)** and read `user_id = ids.get("user_id")`. ⚠ Risk #1: forget the hoist and the
   gate reads nothing.
6. Eval runner (`evals/runner.py:644`) + CLI (`scripts/chat_cli.py:63`) need **no change** —
   default `None` → unmounted. Pin with a test.

Do NOT add a new top-level TurnState key — `turn_ids` already threads fresh path, parked path,
resume pre-write, and the node's fallback-minting read. Clarify-resume is a fresh invocation in
V1 (run_turn.py:10-16) so user_id is re-supplied every turn; the legacy GraphInterrupt path
checkpoints turn_ids so it survives there too.

### B.2 Mounting

- **New `app/workspace/agent_tools.py`** (feature-package placement): the factory + six
  closures per Part A. Convert state's `user_id` str → `UUID(user_id)` once in the factory.
  Module docstring must note the legacy-replay caution (a GraphInterrupt re-execution would
  re-run create_tasks; V1 mounts no ask_student alongside these; idempotency keys deferred).
- `app/agent_node.py` ~550: `workspace_events = getattr(deps, "workspace_events", None)`;
  mount only when `user_id` truthy AND `deps.app_pool` AND `workspace_events`; extend
  `extra_tools`. No prompt branching.
- `app/tool_specs.py:17-21` — add the six names to `_GATED_BY` with value `"auth"` →
  they enter `GATEABLE_TOOLS` → hallucinated calls while unmounted paint no timeline step
  (`EmissionRouter(unmounted=...)` at agent_node.py:605 does the rest). `gated_by` values are
  consumed nowhere else (verified).
- `app/workspace/service_tasks.py` — add `search_tasks(...)` (FTS + trgm per §Locked-4, plus
  `ts_headline` match snippet) and extend `list_tasks` with kw-only optional filters
  (`statuses`, `application_id`, `essay_id`, `completed_after`, `limit`) defaulting to current
  behavior (REST callers unchanged). Plus one aggregate count query for the footer. ~+80 lines
  (file at 416, limit 800).

### B.3 Timeline steps + wire contract

- `domain/events.py:33-43` — `StepKind` + `"workspace"` (rationale: Locked-7).
- `app/steps.py` — `workspace` branch in `_detail_for_known_kind` (summary from
  `content["summary"]` + duration + existing `_error_detail_kwargs`); add `{tasks_phrase}`
  (`"a task"` / `"N tasks"` from `len(args["tasks"]|args["task_ids"])`) to `_label_args`
  AND the step_labels.yaml header comment.
- `config/assets/step_labels.yaml` — six rows, `kind: workspace`, `tier: null`:
  `view_tasks: "Checking the task list"`, `search_tasks: "Searching tasks for “{query}”"`,
  `create_tasks: "Adding {tasks_phrase} to the plan"`, `update_task: "Updating a task"`,
  `archive_tasks: "Archiving {tasks_phrase}"`, `restore_task: "Bringing back an archived task"`.
- `ui` payloads: `create_tasks` returns top-level `"ui": {"widget": "task_added", ...}` —
  `demote_tool_ui` moves it to the step receipt; FE `TOOL_WIDGETS.task_added` **already
  exists** (ToolWidgets.tsx:285-287). Batch `task_list` widget = optional stretch.
- Frontend: `frontend/src/api/chat/types.ts:86-95` add `"workspace"` to `KnownStepKind`;
  `step-receipts.ts:13-23` add the `workspace` presentation entry (compile-forced).
  `activity-trace-helpers.ts` / `AgentRunView.tsx` — no changes.
- `specs/mvp2/plan/wire-contract.md:62` — add `workspace` to the pinned kind union
  (+ backfill the missing `write_plan` while there).

### B.4 Prompt

- `config/assets/prompts/counselor.md` — static `## Workspace Tasks` section near "Planning And
  Tool Loop", using the write_plan conditional phrasing (inert when tools unmounted). Content =
  the playbook: view before create; search with synonym retries before concluding
  non-existence; link via exact link_targets ids; done ≠ archive; confirm before archiving >2
  or in-progress; after any change tell the student plainly what changed on their board.
- `app/prompt.py` — **no change** (no new slot). Per-turn workspace summary block riding the
  `temporal` pattern: **deferred** (adds a DB query to every turn; view_tasks covers it; seam
  verified viable — prepare has app_pool and, post-B.1, user_id).

### B.5 No migration

pg_trgm installed (0009). On-the-fly tsvector, no stored column, no GIN index —
`tasks_user_active_idx` narrows before any text predicate; per-user rows are tens-to-hundreds.

### B.6 ADR

New `docs/adr/0029-agent-workspace-tools-direct-service.md`: agent workspace tools call the
service layer in-process (not MCP/HTTP); mount-gated on authenticated user via `turn_ids`;
`workspace` StepKind; error-payload convention; reversibility-over-confirmation safety model.

## Part C — Tests & evals

| File | Coverage |
|---|---|
| `tests/app/test_workspace_tools.py` (NEW) | Six closures: happy paths, error payload per A.7 case, UUID coercion, `"clear"` sentinel mapping, duplicate guard + force, batch caps (1–20), ui payload shape, overflow routing |
| `tests/app/test_run_turn.py` (MOD) | Mount gate both ways; hallucinated `create_tasks` while unmounted paints no step (mirror :1287); FunctionModel-driven create streams a `workspace` step with `ui.widget == "task_added"` (mirror :539) |
| `tests/app/test_turns.py` (MOD) | `run_turn_fn` recorder pins `user_id=turn.user_id` threading |
| `tests/app/test_tool_specs.py` (MOD) | Six specs load; `gateable_tool_names` includes them |
| `tests/app/test_steps.py` (MOD) | `workspace` kind mapping, labels incl. `{tasks_phrase}`, receipt branch, error label |
| `tests/app/test_workspace_services_live.py` (MOD) | `search_tasks` (websearch, trgm typo fallback, headline, archived hits) + `list_tasks` filters against real pool |
| `evals/` (MOD) | New workspace-task question type + scorer; ⚠ Risk #2: **the runner must seed a real `counselle.users` row and pass `user_id` into `run_turn`** (FK `tasks.user_id → users.id`) + cleanup — otherwise evals silently exercise the unmounted path |
| FE `ChatMessage.test.tsx` / `AgentRunView.test.tsx` (MOD, small) | `workspace` step + `task_added` ui renders; unknown-kind fallback still holds |

Live E2E gate (in-browser, per the phase-gate convention): logged-in session → "break my
Stanford application into tasks" → timeline shows workspace steps → tasks appear on the Tasks
page live with Counselle attribution → "actually remove those" → archive + restore round-trip.

## Phases (each gated on routine suite green: `uv run pytest -m "not live_llm and not live_search and not live_db"` + `ruff` + `mypy`; FE: `npm run typecheck && npm test`)

1. **Service layer** — `search_tasks` + `list_tasks` filters + footer aggregate (TDD against
   unit + live-db service tests).
2. **Identity plumbing** — B.1 exactly; pin eval/CLI-unmounted behavior.
3. **Tools module** — `app/workspace/agent_tools.py` per Part A (TDD:
   `test_workspace_tools.py` first).
4. **Mount + steps + wire** — agent_node gate, tool_specs, StepKind, steps.py, labels, FE
   types/presentation, wire-contract doc.
5. **Prompt + ADR + evals** — counselor.md section, ADR 0029, eval question + seeded user.
6. **Live verification** — full suite incl. live markers, eval run, in-browser E2E gate above.

## Risks

1. **The `_turn_ids` hoist in agent_node.py** — gate reads nothing if missed (caught by the
   mount-gate test, but it would fail confusingly).
2. **Eval FK seeding** — without a real users row, evals pass while testing nothing (Part C).
3. **Tool-count pressure** (~24 mounted) — watch tool-selection quality in the eval run; the
   consolidation lever (batch update) exists but is not needed yet.
4. **Legacy GraphInterrupt replay** re-runs mutations — documented in module docstring; real
   exposure starts only if ask_student ever mounts alongside; idempotency keys deferred.
5. **`summary` key collision** — tool payloads use `"summary"`; steps.py `workspace` branch
   reads it for the receipt. Keep the key stable; test pins it.

## Out of scope (explicitly)

- Essays / applications / activities+honors tools (Phases 2–3 of the tool roadmap — this plan
  is the template).
- Per-turn workspace summary in the system prompt (deferred; seam verified).
- Embeddings/semantic search (FTS+trgm decided; embedding column slots in later without
  changing the tool contract if evals ever demand it).
- Idempotency keys; confirmation state machine; `task_list` FE widget (stretch).
