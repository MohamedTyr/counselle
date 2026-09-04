# Tasks redesign — implementation plan

Status: ready to execute · Date: 2026-09-04

**You are the implementing agent. This plan makes every decision for you.**
If you believe a decision here is wrong, stop and ask the owner. Do not improvise,
do not "improve" as you go, and do not defer anything to a later phase that this
plan places in an earlier one.

## 0. The three documents

| Document | Authority |
|---|---|
| `plans/tasks-redesign-spec.md` | **Behaviour.** What the feature does. |
| `plans/tasks-redesign-design.md` | **Appearance.** Every pixel, token, duration, and piece of copy. Binding. |
| `plans/tasks-redesign-plan.md` (this file) | **Execution.** Order, file-by-file changes, gates. Wins on any conflict about *how*. |

Also binding, in this order of precedence when they conflict: `DESIGN.md` (the design
system) > `plans/tasks-redesign-design.md` > this plan. And `CLAUDE.md` (house rules)
> everything, on process questions.

Read all three before writing a line. Read `DESIGN.md` §19 (the numbered rule list)
and §21 (the PR checklist) before writing any frontend code.

## 0.1 Standing rules for every phase

1. **Verify before editing.** Open the file. Never assume a symbol, prop, route, or
   column exists because this plan names it. This plan was written from a full read
   of the codebase on 2026-09-04, but the file may have moved.
2. **Smallest diff.** Extend what exists. Do not restructure code you are only
   passing through. Deletions listed here are deliberate; deletions not listed here
   are out of scope.
3. **No reflexive tests.** Per `CLAUDE.md`: write a test only where this plan
   explicitly says to. The named tests are honesty-critical or logic-gnarly. Do not
   add a test per component, and do not chase a coverage number.
4. **Parameterized SQL only.** Never f-string SQL.
5. **No magic values.** Every colour, size, duration in the frontend comes from a
   token. If the design doc names a literal (e.g. `150ms`), that literal is the
   sanctioned value — use it, and do not invent a second one.
6. **Stop at a red gate.** Each phase ends with a gate command. If it fails, fix it
   before the next phase. Do not proceed with a broken build.
7. **Commit per phase**, conventional commits, e.g. `feat(tasks): collapse task
   status to done_at (P1)`.

---

# 1. Decisions already made — do not re-litigate

The spec contains seven claims that are false or under-specified against the actual
codebase. All seven are resolved here. These resolutions are final.

| # | Spec said | Reality | **Decision** |
|---|---|---|---|
| D1 | §8.1 "no backend change is required to ship [Plan with agent]" | True for tool *mounting* (`app/workspace/agent_tools.py:155-156`), false for tool *schema* — the tools speak `due`/`planned_for`/`status`/`assignee`, which stop existing. | Agent-tool schemas change in **P2**. Non-negotiable: the agent must speak the same vocabulary as the UI. |
| D2 | §8.1 a "hidden context block" carries view + task list to the composer | No such channel exists. `useComposerStartTurn.submit()` sends only `text`. The one prefill mechanism (`features/ai-composer/draft-prompt.ts`) carries a single **visible, editable** string, by explicit design. | **Fold the context into the visible prompt text.** Zero backend change. Matches the composer's documented philosophy ("prefill is always visible and editable"). Exact format in **P7.2**. Do not build a hidden channel. |
| D3 | §6.5 search "uses the existing `search_tasks` service" | That service is agent-only. `api/routes/tasks.py` has no search route. | **Client-side filter** over the already-cached `useTasks()` list. ~40 tasks is not a full-text-search problem. No new backend route. `TaskSearch`'s external shape (query string in, tasks out) lets this swap later without a rewrite. |
| D4 | §6.1 manual reorder in Today | No ordering column exists on tasks. `Activity`/`Honor` have `sort_order` + `PUT /…/order`; tasks do not. | **Build it, in P9, last.** Full instructions given. It is the one phase that may be cut without touching any other phase — see §2. |
| D5 | The brief said "dark default theme; design both" | **The app is light-only.** `DESIGN.md` §3.4 + rule 7: no `.dark` class, no `prefers-color-scheme` branch, no dark token set; `sonner.tsx` pins `theme="light"`. The dark screenshots in `artifacts/` were captured through a browser force-dark filter. | **Light only. Write zero `dark:` variants.** Every token added is an alias or a dimension, so a future dark pass stays a `primitives.css`-only edit. |
| D6 | §10 keeps `reminder_at` "for one release"; §13 says "no code path writes `reminder_at`" | Direct contradiction inside the spec. | **§13 wins.** Stop writing `reminder_at` immediately (P1/P2). Keep the *column* for one release so its values can be exported. |
| D7 | §12 lists every JS consumer of the kanban tokens | It never names `frontend/src/styles/task.css`, which becomes ~100% dead — all ~70 tokens are lane tokens or multi-select tokens, and both concepts are deleted. | **Rewrite `task.css`** down to the 10 tokens in the design doc §10. |

### Two declared divergences from `DESIGN.md` §14.2

Both are argued in `plans/tasks-redesign-design.md` §3.9 and §3.8. **Both are accepted.**
Implement them as written, and write the one-sentence justification comment at each
site in `task-config.ts`, because a future reader will otherwise "fix" them back.

- **The flag is `--brand` (wine), not `--danger-fg` (red).** §14.2 maps `priority:
  high → error`. Here `flagged` is the student's own mark, and red must mean exactly
  one thing on this page.
- **Deadline urgency is amber at ≤2 days and red when overdue, not red at ≤14 days.**
  Fourteen days of red in a forty-row list is why the current board reads as an alarm.

### Naming, fixed

`when` is a SQL reserved word. The column, wire field, and TypeScript field are all
**`when_on`**; the visible label is always **"When"**. Likewise **`deadline_on`** /
"Deadline". Do not introduce a rename layer between wire and domain — same name at
every level. `done_at`, `flagged`, `created_by_actor`, `last_actor` keep their names
verbatim from DB to TSX.

---

# 2. Phases and gates

| Phase | Scope | Gate |
|---|---|---|
| **P1** | DB migration, models, service, REST routes | `uv run pytest -m "not live_llm and not live_search and not live_db"` green; `uv run ruff check . && uv run mypy .` clean |
| **P2** | Agent tools speak the new vocabulary | same as P1 |
| **P3** | Frontend wire types, domain layer, hooks | `cd frontend && npm run build` |
| **P4** | `task.css` rewrite + `text-chrome` token | `npm run build` |
| **P5** | `TaskRow`, `SchedulerPopover`, `QuickAddBar`, `TaskDetailPanel` | `npm run build && npm run typecheck` |
| **P6** | Routes and the four views | `npm run build`, app boots, all four views render |
| **P7** | Cross-feature surfaces, Plan with Counselle, search, keyboard map | `npm run build` |
| **P8** | Deletions, tests, full verification, in-browser check | everything below, plus the §11 checklist |
| **P9** | Today manual reorder (**cuttable**) | `npm run build` + backend gate |

**P9 is the only cuttable phase.** If the owner wants to ship sooner, stop after P8;
Today then sorts deterministically (P6.2) and nothing else changes. Every other phase
is a hard dependency of the one after it.

> `npm run typecheck` does **not** catch undefined identifiers in this repo. Only
> `npm run build` (which runs `tsc -b`) does. Always run `npm run build`.

---

# P1 — Backend: schema, models, service, routes

## P1.1 Migration

Create **`migrations/0019_tasks_redesign.sql`**. Follow the house convention exactly
(read `migrations/0018_drop_essay_prompt_drafts.sql` first for the shape: prose
header explaining *why*, then `-- depends:`, then plain SQL).

```sql
-- Tasks redesign (plans/tasks-redesign-spec.md §10): collapse status → done_at,
-- add when_on/deadline_on as DATE columns replacing the timestamptz planned_for/
-- due_at, add flagged (replacing the priority scale in the UI), and add
-- created_by_actor/last_actor so a task row can answer "did Counselle create or
-- touch this" without joining counselle.workspace_changes (spec §7.1, §8.3).
--
-- Nothing is dropped here. status, priority, category, assignee, needs_input,
-- due_at, planned_for, reminder_at, completed_at all survive for one release per
-- spec §10. `status` is kept in sync with done_at by application code
-- (app/workspace/service_tasks.py), not by a trigger, because every write path
-- already funnels through that one module. The sync exists because
-- service_applications.py's progress rollup still reads status = 'done'.
--
-- depends: 0018_drop_essay_prompt_drafts

ALTER TABLE counselle.tasks
  ADD COLUMN when_on date,
  ADD COLUMN deadline_on date,
  ADD COLUMN done_at timestamptz,
  ADD COLUMN flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN created_by_actor text NOT NULL DEFAULT 'student'
    CHECK (created_by_actor IN ('student', 'counselle')),
  ADD COLUMN last_actor text NOT NULL DEFAULT 'student'
    CHECK (last_actor IN ('student', 'counselle'));

-- Backfill. The AT TIME ZONE 'UTC' cast is mandatory: due_at/planned_for are
-- timestamptz written at UTC midnight by every known writer
-- (app/workspace/agent_tools_shared.py:validate_date_field), and a bare ::date
-- cast would use the migration session's TimeZone and shift the day by one for
-- any non-UTC session.
UPDATE counselle.tasks SET
  when_on     = (planned_for AT TIME ZONE 'UTC')::date,
  deadline_on = (due_at AT TIME ZONE 'UTC')::date,
  done_at     = CASE WHEN status = 'done' THEN updated_at ELSE NULL END,
  flagged     = (priority = 'high');

-- Spec §10 row 3: a 'waiting' task with no work date gets a check-in date so it
-- surfaces somewhere. Log the ids first so the result is reviewable.
CREATE TABLE counselle._task_migration_0019_waiting_ids AS
SELECT id, user_id, title FROM counselle.tasks
WHERE status = 'waiting' AND when_on IS NULL;

UPDATE counselle.tasks
SET when_on = (current_date + 3)
WHERE status = 'waiting' AND when_on IS NULL;

-- Spec §10 last line: delete the placeholder rows the old "New task" button
-- created before the user typed anything.
DELETE FROM counselle.tasks
WHERE title = 'Untitled task'
  AND notes IS NULL
  AND application_id IS NULL
  AND essay_id IS NULL
  AND when_on IS NULL
  AND deadline_on IS NULL
  AND done_at IS NULL;

-- Spec §2.5 / §13: a task's title is never empty. Nothing enforced this before —
-- Pydantic's `title: str` accepts "".
ALTER TABLE counselle.tasks
  ADD CONSTRAINT tasks_title_not_blank CHECK (btrim(title) <> '');

-- The new views filter on (user_id, when_on) and (user_id, deadline_on) with
-- done_at IS NULL, mirroring the existing tasks_user_active_idx partial pattern.
CREATE INDEX tasks_user_open_when_idx
  ON counselle.tasks (user_id, when_on)
  WHERE archived_at IS NULL AND done_at IS NULL;
CREATE INDEX tasks_user_open_deadline_idx
  ON counselle.tasks (user_id, deadline_on)
  WHERE archived_at IS NULL AND done_at IS NULL AND deadline_on IS NOT NULL;
```

Create **`migrations/0019_tasks_redesign.rollback.sql`**:

```sql
-- Structural rollback only. Rows deleted by the "Untitled task" cleanup are not
-- recoverable, and there is no reverse mapping from a when_on/flagged value
-- written after this migration back to planned_for/priority. This matches the
-- documented pattern in 0018_drop_essay_prompt_drafts.rollback.sql.

DROP INDEX counselle.tasks_user_open_deadline_idx;
DROP INDEX counselle.tasks_user_open_when_idx;
ALTER TABLE counselle.tasks DROP CONSTRAINT tasks_title_not_blank;
DROP TABLE IF EXISTS counselle._task_migration_0019_waiting_ids;

ALTER TABLE counselle.tasks
  DROP COLUMN when_on,
  DROP COLUMN deadline_on,
  DROP COLUMN done_at,
  DROP COLUMN flagged,
  DROP COLUMN created_by_actor,
  DROP COLUMN last_actor;
```

**Before applying, check the title constraint will not fail:**
```sql
SELECT count(*) FROM counselle.tasks WHERE btrim(title) = '';
```
If this returns non-zero, add `UPDATE counselle.tasks SET title = 'Untitled' WHERE
btrim(title) = '';` immediately above the `ADD CONSTRAINT` and note it in the header
comment. Do not drop the constraint.

Apply with the command from `README.md:55`:
```bash
uv run yoyo apply --batch --database "${COUNSELLE_DB_APP_DSN}?schema=counselle" migrations/
```

## P1.2 `app/workspace/models.py`

Add to `Task` (after `requirement_kind`, keeping the existing fields untouched):

```python
    when_on: Date | None = None
    deadline_on: Date | None = None
    done_at: datetime | None = None
    flagged: bool = False
    created_by_actor: Actor = "student"
    last_actor: Actor = "student"
```

`Date` is already imported in this module (used by `Application.deadline`) — verify
the import name before using it.

`TaskCreate`: add `when_on: Date | None = None`, `deadline_on: Date | None = None`,
`flagged: bool = False`. Change `title: str` to
`title: str = Field(min_length=1)`. **Keep** `status`, `assignee`, `needs_input`,
`due_at`, `planned_for`, `reminder_at` as accepted-but-defaulted fields for the
one-release bridge — the frontend simply stops sending them.

`TaskPatch`: add `when_on`, `deadline_on`, `done_at`, `flagged`, all `| None = None`.
**`done_at` must be clearable** (setting it to `None` un-completes a task from the
Logbook), so do **not** add it to the `reject_null_required_fields` validator's field
list. `flagged` **must** be in that validator's list (it is a required boolean, like
`needs_input`).

**Never** add `created_by_actor` / `last_actor` to `TaskCreate` or `TaskPatch`. They
are set only by `service_tasks.py` from its `actor` parameter. A client must not be
able to claim the agent made a change.

## P1.3 `app/workspace/service_tasks.py`

1. **`create_task` and `create_tasks_batch`**: add `when_on, deadline_on, flagged,
   created_by_actor, last_actor` to the INSERT column list and the value tuple.
   `created_by_actor` and `last_actor` both take the function's `actor` parameter —
   never a value from `data`. Also set `status = 'done'` and `completed_at = now()`
   at insert if `done_at` is supplied (it will not be, from any current caller, but
   keep the two columns coherent).
2. **`_update_task_row`** (currently lines 587-645): add `CASE WHEN $n THEN $n+1 ELSE
   col END` pairs for `when_on`, `deadline_on`, `flagged`, and `done_at`, following
   the existing pattern exactly.
   **The current numbering, verified:** `$1` = task_id, `$2` = user_id, then 13
   present-flag/value pairs occupying `$3`–`$28` (28 parameters total). Append the
   four new pairs at **`$29`–`$36`** in this order — `when_on` `$29/$30`,
   `deadline_on` `$31/$32`, `flagged` `$33/$34`, `done_at` `$35/$36` — and the
   unconditional `last_actor` at **`$37`**. Do not renumber the existing pairs.
   Then:
   - Add the `status`/`completed_at` bridge, replacing the existing `completed_at`
     CASE arm. When `done_at` is present in the patch:
     `status = CASE WHEN $35 THEN (CASE WHEN $36 IS NOT NULL THEN 'done' ELSE 'todo'
     END) ELSE <existing status arm> END`, and
     `completed_at = CASE WHEN $35 THEN $36 ELSE <existing arm> END`.
     Reusing `$35`/`$36` across several SET clauses is valid and is already the
     pattern this statement uses for `$13`/`$14`. This preserves legacy
     `status`-only patches (they fall through to the existing arms) and makes
     `done_at` win when both are sent.
   - Add `last_actor = $n` set unconditionally to the `actor` value on every update.
     This requires threading `actor` into `_update_task_row`, which does not receive
     it today — add it as a keyword parameter and pass it from `update_task`.
3. **`list_tasks`**: add a `done: bool | None = None` keyword. `True` →
   `done_at IS NOT NULL`; `False` → `done_at IS NULL`; `None` → no filter. Keep the
   existing `statuses` parameter working for the bridge release.
4. **Delete `bulk_update_status` entirely.** Its only callers are the REST route
   deleted in P1.4 and one test. Multi-select is out of scope (spec §14).
5. **Keep `bulk_archive`** — still used by `_archive_one`/`archive_task` and by the
   agent's `archive_tasks` tool.

## P1.4 `api/routes/tasks.py`

- **Delete** `bulk_status_route` and the `BulkStatusBody` model.
- **Delete** `bulk_archive_route` and the `BulkArchiveBody` model. The service
  function stays; the *route* has no remaining caller once multi-select is gone.
- Remove the now-unused `BATCH_ITEMS_MAX` import if nothing else in the file uses it.
- Every other route is unchanged: `TaskCreate`/`TaskPatch` gained fields, so the
  routes accept them with zero edits.

## P1.5 Tests to change (P1)

Change only these. Do not add new ones beyond the two named.

- `tests/api/test_workspace_routes.py` — delete the two bulk-route tests (they mock
  `api.routes.tasks.bulk_update_status`/`bulk_archive`, ~lines 243-251).
- `tests/app/test_workspace_services_live.py` — `test_task_bulk_ops_are_owned_and_logged`
  (~line 753): drop the `bulk_update_status` half, keep the `bulk_archive` half and
  its change-row count assertions (the expected count math changes — recompute it,
  do not guess).
- `tests/api/test_workspace_routes_live.py` — `test_add_school_list_complete_task_rollup_moves`
  (~line 70): switch it to complete a task via `{"done_at": "..."}` instead of
  `{"status": "done"}`, and assert the rollup still moves. **This test is the reason
  the status bridge exists — it must stay green.**
- **ADD** one test in `tests/app/test_workspace_services_live.py`: patching
  `done_at` to a timestamp sets `status='done'` and `completed_at`; patching it back
  to `None` sets `status='todo'` and clears `completed_at`. This is the bridge
  invariant and it is the one piece of P1 that will break silently.
- **ADD** one test in the same file: `create_task` with `actor="counselle"` sets
  `created_by_actor='counselle'`, and a subsequent `update_task` with
  `actor="student"` sets `last_actor='student'` while leaving `created_by_actor`
  unchanged. This is an honesty claim (spec §7.1/§8.3) — per `CLAUDE.md` principle 3
  it gets a hard test.

**Gate P1:** `uv run pytest -m "not live_llm and not live_search and not live_db"`
green, `uv run ruff check . && uv run mypy .` clean. Do not source `.env` for the
routine run — it produces two spurious failures.

---

# P2 — Backend: agent tools

The agent must speak the same vocabulary as the UI or it will create tasks the UI
cannot represent.

## P2.1 `app/workspace/agent_tools_shared.py`

- **`TaskDraft`** (lines 107-124): remove `status`, `assignee`, `needs_input`,
  `reminder`. Rename `due` → `deadline`, `planned_for` → `when`. Add
  `flagged: bool = False`. Add `Field(min_length=1)` to `title`. **Keep `category`** —
  spec §2.2 keeps the column for agent use; it is simply never shown as a picker.
- Both new date fields parse with the **existing** `validate_date_only` (lines
  385-394), which already returns a plain `date`. Do not use `validate_date_field`
  (it returns a UTC-midnight datetime, which is the thing being replaced).
- **`render_task_row`** (lines 338-373): output keys become
  `id, title, category, flagged (omit when false), when, deadline,
  deadline_inherited, app, essay, notes, done (omit when false)`. Remove `status`,
  `priority`, `assignee`, `needs_input`, `reminder`. Add a keyword parameter
  `inherited_deadline: date | None = None`, rendered as `deadline_inherited` **only
  when the task's own `deadline_on` is None**. The distinction between an owned and
  an inherited deadline is an honesty requirement (spec §2.4) — the agent must not
  report an inherited date as the task's own.

## P2.2 `app/workspace/agent_tools_mutations.py`

- `_parse_draft` / `_draft_to_task_create`: map the renamed fields.
- **`update_task` tool signature** (lines 251-315): replace the `status`, `assignee`,
  `needs_input`, `due`, `planned_for`, `reminder` parameters with `when: str | None`,
  `deadline: str | None`, `flagged: bool | None`, `done: bool | None`. `done=True` →
  `done_at = now()`; `done=False` → `done_at = None`. Keep the existing `"clear"`
  sentinel convention for `when`/`deadline`.
- `_SUMMARY_ROW_KEYS` (318-331) and `_task_changes` (412-473): update to the new
  field names. Remove the handling for every deleted field.
- Update the `create_tasks` docstring (72-91) — it currently documents
  `status "todo"`, `assignee`, etc. The docstring is the contract the model reads;
  a stale one is a live bug.

## P2.3 `app/workspace/agent_tools.py`

- **`view_tasks`**: collapse the `status` parameter from
  `"active"|"todo"|"doing"|"waiting"|"done"|"all"` to `"open"|"done"|"all"`, default
  `"open"`. Implement it with `list_tasks(..., done=...)` from P1.3, not the legacy
  `statuses` list.
- `_sort_tasks` (250-263): sort key becomes
  `(not flagged, when_on is None, when_on, deadline_on is None, deadline_on, created_at)`.
  Delete the `PRIORITY_ORDER` usage.
- In `_view_tasks_impl`, the `apps: list[ApplicationView]` list is already in scope
  (~line 312). Build `{app.id: app.deadline}` from it and pass each task's parent
  deadline to `render_task_row(inherited_deadline=...)`.

## P2.4 Tests (P2)

`tests/app/test_workspace_tools.py` is the heaviest rewrite in the backend — roughly
45 test functions, essentially all of which reference a renamed or removed field.
Work through it top to bottom. **Rewrite assertions to the new field names; do not
delete a test to make it pass.** The one exception: tests asserting `status`
transitions between `todo`/`doing`/`waiting` test a concept that no longer exists —
delete those and keep the open/done equivalents.

**Gate P2:** same as P1.

---

# P3 — Frontend: wire types, domain, hooks

## P3.1 `frontend/src/api/workspace/types.ts`

Add to `Task` (lines 123-144): `when_on: string | null`, `deadline_on: string | null`,
`done_at: string | null`, `flagged: boolean`, `created_by_actor: "student" |
"counselle"`, `last_actor: "student" | "counselle"`.

Add `when_on`, `deadline_on`, `done_at`, `flagged` to `TaskPatch`. Add `when_on`,
`deadline_on`, `flagged` to `TaskCreate`.

Do **not** remove the legacy fields from these types in this pass — the server still
returns them, and a type that lies about the wire is worse than a wide type. They are
removed in the follow-up release that drops the columns.

## P3.2 `frontend/src/domain/task.ts`

Add the six new fields to the domain `Task` and to `taskFromApi` (nullable → optional
via the existing `undefinedIfNull`). `done_at`, `when_on`, `deadline_on` become
`string | undefined`; `flagged`, `created_by_actor`, `last_actor` are non-optional.

Add `when_on`, `deadline_on`, `done_at`, `flagged` to `patchableTaskFields`. Remove
`status`, `assignee`, `needs_input`, `reminder_at` from that array — the frontend
must not write them (spec §13). Leave `category` in it (the agent owns it, but the
detail panel's link picker may need to clear it; if nothing writes it by the end of
P5, remove it then).

**Also collapse the duplicated cascade.** The rule "setting `application_id` clears
`essay_id` and `requirement_kind`" is implemented twice: `domain/task.ts:90-93` and
`api/workspace/tasks.ts:17-26`. Delete it from `domain/task.ts` and keep the single
copy in the API layer, which is closer to the wire. This is a `CLAUDE.md` "one source
of truth" fix and this is the correct moment for it.

## P3.3 `frontend/src/api/workspace/hooks/tasks.ts`

- **Delete** `useBulkUpdateTaskStatus` and `useBulkArchiveTasks` (their routes are
  gone). Delete the corresponding fetchers in `api/workspace/tasks.ts` and remove
  them from any barrel export.
- **`useUpdateTask`**: change the optimistic derivation (lines 89-92). The current
  branch keys off `patch.status`; it now keys off `patch.done_at`:
  ```ts
  const optimisticPatch =
    patch.done_at !== undefined
      ? { ...patch, status: patch.done_at ? "done" : "todo",
          completed_at: patch.done_at, updated_at: timestamp }
      : { ...patch, updated_at: timestamp };
  ```
  Everything else in that hook — cancel, snapshot, `patchById`, `onError` restore,
  `onSuccess` `replaceById`, `onSettled` invalidate list + application detail —
  stays byte-identical. **This is the pattern every new hook copies.**
- **Add three thin wrappers**, each delegating to `useUpdateTask`'s mutation. Do not
  re-implement the optimistic machinery in any of them:
  - `useCompleteTask()` → `{ id, done: boolean }` → patch `{ done_at: done ?
    nowIso() : null }`.
  - `useScheduleTask()` → `{ id, field: "when_on" | "deadline_on", value: string |
    null }` → patch `{ [field]: value }`.
  - `useToggleFlag()` → `{ id, flagged: boolean }` → patch `{ flagged }`.
- `hook-utils.ts`'s `tempTask` builder: add the six new fields so an optimistic row
  is shape-complete.

## P3.4 `frontend/src/test/render-app.tsx`

Extend `workspaceTaskFixture` (lines ~110-131) with the six new fields. Update
`createWorkspaceFetchPreset`'s task handlers: remove the `/tasks/bulk-status` and
`/tasks/bulk-archive` handlers, and make the PATCH handler mirror the server's
`done_at` → `status`/`completed_at` bridge so tests see realistic responses.

**Gate P3:** `cd frontend && npm run build`. Expect failures in files P5-P8 delete —
that is fine only if every failure is in a file this plan marks DELETE or REWRITE.
Any other failure is a real one.

---

# P4 — Design tokens

## P4.1 Rewrite `frontend/src/styles/task.css`

Delete all ~70 existing tokens (every `--task-todo-*`/`--task-doing-*`/
`--task-waiting-*`/`--task-done-*` lane block, the `*-drop-*` blocks, the
`--task-drag-preview-*` block, and both `--task-card-selected-*` tokens). Replace the
file's body with exactly the ten tokens in `plans/tasks-redesign-design.md` §10,
Tier 3 table. Keep the file's existing header-comment style and explain what the file
now is.

Every one of the ten is an alias onto tier 2 or a dimension. **None may reference a
tier-1 primitive** (`DESIGN.md` rule 3 / Law 1).

`--task-row-spine` must be written as the `calc()` of its three parts, exactly as the
design doc specifies, so that changing the checkbox size re-derives the alignment
instead of silently breaking it.

## P4.2 Add `--text-chrome` to `frontend/src/styles/theme.css`

`--text-chrome: 0.8125rem` with `--text-chrome--line-height: 1.25rem`. This is
`DESIGN.md` known-debt #13, explicitly requested there ("do it when you next touch
this area"), and this feature uses 13px in five places. Once it exists, use
`text-chrome` and never write `text-[13px]`.

## P4.3 Do NOT create `styles/motion.css`

The design doc offers it and then says it must not block this work. Every duration
and easing in the design doc is written as a literal for exactly this reason. Use the
literals. Do not add both.

**Gate P4:** `npm run build`.

---

# P5 — Core components

Every component below is new. Every visual value comes from
`plans/tasks-redesign-design.md` — do not invent one. Where that document gives a
class string, use it verbatim.

**Zero registry installs are required.** Every primitive already exists in
`frontend/src/components/ui/`. Confirmed inventory:

| Need | Import |
|---|---|
| Checkbox | `import { Checkbox } from "@/components/ui/checkbox"` (Radix) |
| Popover | `import { Popover, PopoverTrigger, PopoverPopup } from "@/components/ui/popover"` (Base UI) |
| Calendar | `import { Calendar } from "@/components/ui/calendar"` (react-day-picker, `mode="single"` default) |
| Side panel | `import { Sheet, SheetPopup, SheetHeader, SheetTitle, SheetPanel } from "@/components/ui/sheet"` (Base UI dialog) |
| ⌘K palette | `import { CommandDialog, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from "@/components/ui/command"` (cmdk) |
| Combobox | `Command*` (bare, **not** `CommandDialog`) nested inside `PopoverPopup` |
| Keyboard hint | `import { Kbd } from "@/components/ui/kbd"` |
| Empty state | `import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"` |
| Page scaffold | `import { PageContainer } from "@/components/workspace/PageContainer"` |

`PopoverPopup` already carries `has-data-[slot=calendar]:` styling — it was built to
host `Calendar`. Use that composition; do not build a parallel date picker
(`DESIGN.md` rule 21).

Two primitives need one-line fixes while you are here, both named in `DESIGN.md`'s
debt list:
- `components/ui/checkbox.tsx`: `disabled:opacity-50` → `disabled:opacity-64`
  (debt #11). This feature puts a checkbox on every row for the first time at scale.
- Add `pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11` to the
  checkbox's existing `after:` hit-area so touch targets reach 44px.

## P5.1 `frontend/src/features/tasks/task-dates.ts` — rewrite in place

Edit this file, do not replace it. Keep `startOfLocalDay`, `getCalendarDayDiff`,
`getDateKey` unchanged — they are correct and used by everything below.

Delete: `getTodayPlannedForValue`, `isTaskPlannedForToday`, `formatPlannedDateLabel`,
`getPlanningDate`, `getPlanningDateLabel`, `formatReminderLabel`, `mergeDateWithTime`
(no time component survives).

Add, all pure and all taking an injectable `referenceDate = getNowDate()` so tests can
pin the clock:

- `toDateKey(value: string | undefined): string | undefined` — the `YYYY-MM-DD` form.
- `formatWhenChip(when_on, referenceDate)` → `"Today"` | `"Tomorrow"` | `"Fri"`
  (within 7 days) | `"Fri 12 Sep"` (beyond) | `"12 Sep 2027"` (different year).
  Never a bare ISO string.
- `getDeadlineState(deadline_on, referenceDate)` →
  `"overdue" | "due-soon" | "normal" | "hidden"`, with the **exact** thresholds from
  the design doc §3.8: overdue `< today`; due-soon `today ≤ d ≤ today+2`; normal
  `today+3 < d ≤ today+7`; hidden otherwise or when null.
  Note the deliberate gap: `d == today+3` falls in neither due-soon nor normal as
  literally written in the design table. **Resolve it here: `today+3` is `normal`.**
  Implement as: overdue `< today`, due-soon `≤ today+2`, normal `≤ today+7`,
  hidden otherwise.
- `formatDeadline(deadline_on, referenceDate)` → the date half of the chip.
- `formatPageSubtitle(view, count, referenceDate)` → the strings in design doc §2.1's
  table, e.g. `"Thursday 4 September · 8 tasks"`. Always pair a number with its noun.

All dates are date-only strings (`YYYY-MM-DD`) end to end. Never construct a `Date`
from one with `new Date("2026-09-04")` for comparison purposes without normalising —
that parses as UTC midnight and can render as the previous day in a negative-offset
timezone. Parse with an explicit local constructor:
`new Date(y, m - 1, d)` from split parts. **This is the single most likely correctness
bug in the whole feature. Write a unit test for `formatWhenChip` and
`getDeadlineState` covering a `UTC-5` and a `UTC+13` local timezone.**

## P5.2 `task-config.ts` — rewrite

Delete: `todayColumns`, `laneThemeClass`, `categoryLabel`/`Options`,
`priorityLabel`/`Options`/`prioritySortRank`/`priorityBadgeVariant`,
`statusLabel`/`Options`/`statusBadgeVariant`, `assignee*`, `booleanOptions`,
`allTaskColumns`, `allTasksTableWidth`, `categoryChipClass`, `selectionDragThreshold`,
`emptyTaskIdSet`.

Keep/add: the derived-label computation from spec §2.3, the scheduler's option list
(label, resolver, shortcut key), and the two justification comments for the declared
divergences (§1 above). Nothing here should be a colour — colours live in CSS.

## P5.3 `TaskRow.tsx` — the most important file

Build to `plans/tasks-redesign-design.md` §3 exactly: geometry (§3.1), the redundancy
rule (§3.2 — this is what makes the design work, and it is the part an implementer
will most likely skip), checkbox (§3.3), title (§3.4, **`font-normal`, `truncate`,
never `line-clamp`**), agent glyph (§3.5), derived label (§3.6 — **plain text, not a
`Badge`**), When chip (§3.7), deadline chip (§3.8), flag (§3.9), hover-revealed
affordances (§3.10), row states (§3.11), responsive (§3.12), **and the completion
motion (§4) in full** — the seven-step timeline (checkbox fill at 120ms, `clip-path`
strike-through at 180ms, title colour at 200ms, row exit at t=300 over 140ms, sibling
`layout="position"` spring at t=440, count decrement, undo toast at t=440), the
un-checking mirror (§4.2), and the `prefers-reduced-motion` table (§4.3).

**§4 is a first-class deliverable of this phase, not a P8 verification afterthought.**
It is the most-repeated interaction in the product and the easiest thing to skip while
still passing a type-check. An implementer who ships a plain checkbox toggle here will
not discover the gap until four views are already built on top of this component.

Props:
```ts
type TaskRowProps = {
  task: Task;
  applicationsById: ReadonlyMap<string, ApplicationView>;
  essaysById: ReadonlyMap<string, EssaySummary>;
  /** Which meta the surrounding group already states — suppressed per §3.2. */
  suppress?: { label?: boolean; when?: boolean };
  isSelected: boolean;
  showReorderGrip?: boolean;   // Today only, P9
  onOpen: (taskId: string) => void;
  onComplete: (taskId: string, done: boolean) => void;
  onSchedule: (taskId: string, field: "when_on" | "deadline_on") => void;
  onToggleFlag: (taskId: string) => void;
};
```

`suppress` is how the redundancy rule is enforced — the *view* knows what its group
header said, so the view passes it down. Do not try to infer it inside the row.

Accessibility, following the conventions already in this codebase: every icon-only
control gets a specific `aria-label` built from the task's own title (e.g.
`Complete "${task.title}"`), and every decorative Lucide icon gets
`aria-hidden="true"`. Never a generic "Open" or "Select".

The hover-revealed schedule affordance (§3.10.1) is icon-only and easy to miss, since
it is not present at rest. Its label is exactly:
`aria-label={`Add a when date to "${task.title}"`}`.

The row is a `<li>` in a `<ul role="list" className="-mx-2">`.

## P5.4 `SchedulerPopover.tsx`

Build to design doc §6. Note the deliberate deviation from the spec's ASCII: **a
single column of six rows, not a 2×2 grid** — each row carries its resolved date and
its shortcut key, which the grid cannot fit at 280px. Behaviour is identical.

Props: `{ value: string | undefined; field: "when_on" | "deadline_on"; onChange:
(value: string | null) => void; children: ReactNode /* the trigger */ }`.
In `deadline_on` mode the last row reads **"No deadline"** instead of "Anytime".

Calendar mode swaps contents in place at a fixed `w-[280px]`; the shell never resizes.
`Escape` closes the whole popover from either mode rather than stepping back.

## P5.5 `QuickAddBar.tsx` + `task-parse.ts`

Build to design doc §5 and spec §4.

`task-parse.ts` is a pure module, no React:
```ts
export type ParsedQuickAdd = {
  title: string;                 // the string minus every consumed token
  when_on?: string;              // YYYY-MM-DD
  deadline_on?: string;
  flagged?: boolean;
  application_id?: string;
  essay_id?: string;
  tokens: { start: number; end: number; kind: "when" | "deadline" | "flag" | "app" | "essay" }[];
  needsCheckIn: boolean;         // §4.3 waiting hint
};
export function parseQuickAdd(input: string, ctx: {...}, ignoredRanges: ...): ParsedQuickAdd;
```

**Dependency decision, final: add `chrono-node@2.10.1`** (verified 2026-09-04: current
version, **zero runtime dependencies**, pure parser, no React/DOM coupling, no peer
conflict with React 19 / react-router 8). Install with
`cd frontend && npm install chrono-node@2.10.1`.

Use it **only** for the date half of the grammar (`today`, `tmr`, `fri`, `next mon`,
`this weekend`, `in 3 days`, `sep 12`, `9/12`, `2026-09-12`). Relative-weekday maths
and "this weekend" vs "next week" disambiguation are exactly what a hand-rolled
matcher gets wrong. Load it with `await import("chrono-node")` on first focus of the
quick-add input, matching the lazy-import convention already in `app/router.tsx`, so
it stays out of the initial `/app/tasks` chunk.

Hand-roll the rest — `!`/`!!`, `@school`, `#essay` are prefix scans against the
already-cached applications/essays lists. That is the ~20 lines the spec describes;
do not pull a second library for them.

`by <date>` / `due <date>` sets `deadline_on`; a bare date sets `when_on`. Run the
`by`/`due` matcher first and exclude its range before parsing `when_on`.

The inline highlight is a **mirror layer** (design doc §5.2): an
`aria-hidden` absolutely-positioned div rendering the same string with token spans,
behind an input with `color: transparent; caret-color: var(--ink)`. **This technique
already exists in this codebase** — the composer's skill highlight, tokens
`--workspace-composer-skill-highlight`/`-underline`/`-radius` in `workspace.css`.
Read that implementation and reuse the mechanism; do not invent a second one.

The `Input` primitive may need its `nativeInput` escape hatch for caret/selection
access — check Base UI's `Input` API before deciding, and use `nativeInput` only if
the Base UI primitive genuinely cannot expose what the mirror needs.

**A mirror that drifts one pixel from its input is the most visible bug this
component can have.** Verify alignment in a real browser at 375px and 1440px before
calling P5 done.

Write unit tests for `parseQuickAdd` covering: each token kind; `by nov 1` →
`deadline_on` not `when_on`; a title that contains a date word which the user
un-parsed; the `waiting on` hint trigger; and an input with no tokens at all.

## P5.6 `TaskDetailPanel.tsx`

Rewrite of `TaskDetailSheet.tsx`. Build to design doc §7 — **exactly six rows plus
one footer line**. Salvage `TaskPropertyRow`, `TaskPropertyValue`, `ReadableDate`
from the old file. Delete `TaskPropertySelect`, `TaskDatePickerInput` (the scheduler
replaces it), `TaskAssigneeBadge`, `TaskReadOnlyValue`.

Row 5 (Link) is one combined School/Essay picker: `Command*` bare inside
`PopoverPopup`. Choosing an essay sets both `essay_id` and its `application_id`.
Copy, fixed: `CommandInput` placeholder `Search schools and essays…`;
`CommandEmpty` `No matches`; group headings `Schools` and `Essays`. Read one existing
`Command`-in-a-popup composition first (`NewEssayDialog.tsx`, `AddSchoolDialog.tsx`,
`ExploreFilterBar.tsx`, or `cds-admin/upload/SchoolPicker.tsx`) and match its heading
style rather than inventing a second one.

Row 4 shows deadline inheritance when `deadline_on` is null and the linked
application has a deadline: `Jan 1` + `· from Berkeley`. **It is displayed, never
written** (spec §2.4). Write a test for this — it is an honesty surface.

Autosave on blur. No Save/Cancel buttons (`DESIGN.md` §17.3).

Footer: `Created Sep 2 by Counselle · Updated 3h ago`, using the existing
`formatRelativeTime` from `lib/time.ts` and `created_by_actor` from the row.

**Gate P5:** `npm run build && npm run typecheck`.

**And a mandatory visual checkpoint before P6 starts.** Mount `TaskRow` in one
throwaway list (reuse the old `/app/tasks` mount point temporarily) and check it in a
real browser at 375px and 1440px against design doc §12 criteria 1–24, plus the
completion motion end to end. **Do not begin P6 until this passes.** This is the one
point in the plan where a wrong call about spacing, the redundancy rule, or the motion
is cheap to fix. After P6 the same fix touches four views, the detail panel, search,
and the keymap.

---

# P6 — Routes and views

## P6.1 Routing

In `frontend/src/app/router.tsx`, convert `{ path: "tasks", element: <TasksPage /> }`
(line ~98) to a parent with children:

```ts
{
  path: "tasks",
  element: <TasksLayout />,
  children: [
    { index: true, element: <Navigate replace to="today" /> },
    { path: "today", element: <TodayView /> },
    { path: "upcoming", element: <UpcomingView /> },
    { path: "anytime", element: <AnytimeView /> },
    { path: "logbook", element: <LogbookView /> },
  ],
},
```

Route-based, not tab state, because: the app's convention for a distinct navigable
surface is a route (`schools/:schoolKey`, `essays/:essayId`); the current tri-tab has
**no URL reflection at all**, which is a real bug this fixes for free; `1 2 3` become
plain `navigate()` calls; and back/forward and bookmarking start working.

**The catch-all at line ~176 redirects to `/app/tasks`** — verify it still lands
correctly through the `index` redirect after this change.

`?task=<id>` keeps working unchanged and composes with every child route.
`SchoolRequirementsSection.tsx:200` already deep-links this way — do not break it.

**`TasksLayout` must hoist `useTasks()`, `useApplications()`, `useEssays()`** and pass
data down through `<Outlet context={...} />`. If a child route calls `useTasks()`
itself, switching views stops being free and starts being a network round trip. This
is a MUST, not an optimisation.

`TasksLayout` owns: `PageContainer`, the view tabs, the quick-add bar,
`TaskDetailPanel`, `UndoToast`, and the global keymap.

**View counts.** The tab counts and each `PageHeader` subtitle count are computed by
running the *same* grouping/filter functions from `task-filters.ts` that the views
themselves use, against the one hoisted `useTasks()` list. Never a separate count
query, never hand-duplicated filter logic. This is what guarantees the tab number,
the subtitle number, and the rendered row count cannot disagree.

**The search action** (`<SearchButton />` in design doc §2.1) is inline JSX inside
`TasksLayout.tsx` — a `Button variant="ghost" size="icon"` that opens `TaskSearch`
(P7.3). Do not create a `SearchButton.tsx` file.

## P6.1a The agent nudge — cut, deliberately

Design doc §2.4 specifies the nudge's appearance and opens with "rendered only when
the agent has produced one." **Nothing produces one.** There is no nudge column, no
SSE event, no `/v1/config` entry, and spec §8 — which §6.1 cites for it — never
defines the mechanism. Building it would mean inventing a data path, a TTL, and
dismissal persistence.

**Decision: cut it from this pass.** Render nothing where the nudge would go.
Design doc §2.4's own precondition makes this correct, not a violation. Do not
invent a client-side heuristic nudge. If the owner wants it, it needs its own spec
first.

## P6.2 The four views

All four render `TaskRow`. They differ only in filtering, grouping, and header. Put
the pure grouping functions in `task-filters.ts` (rewritten) and unit-test the
grouping, not the rendering.

- **`TodayView`** — spec §6.1, design §2.5/§2.6. `when_on <= today` and not done.
  Plus the muted "Due soon" group: not-done, `deadline_on <= today+7`, not already in
  the list above, each with a "Plan for today" action. Suppress the When chip on the
  main list (the page title said it); suppress nothing in "Due soon".
  **Ordering, until P9 lands:** `(not flagged, deadline_on nulls last, deadline_on,
  created_at)`. Deterministic, no manual order.
  Footer link: `12 done this week →` to the Logbook.
  **The "Plan for today" action is not a new control.** It is the hover-revealed
  schedule affordance from design doc §3.10.1 (`CalendarPlus` 14px, `--ink-faint`),
  reused unchanged — no new icon, label, or button variant. In the Due-soon group it
  renders at rest rather than on hover (same override as Upcoming's first group), and
  opens the scheduler on `when_on` regardless of which chip was clicked, because the
  point of the group is "give this a when."
- **`UpcomingView`** — spec §6.2. `when_on > today` **and not done**, grouped by day
  for 7 days, then by week for 3, then by month. The "Deadlines without a plan" group
  goes **first**: not-done, `when_on` null, `deadline_on` not null. Suppress the When
  chip inside date-derived groups.
  **Inside "Deadlines without a plan" only,** the schedule affordance from design doc
  §3.10.1 is *not* hover-gated — it renders at rest (same `CalendarPlus` control,
  `opacity-100` always). This is the one sanctioned override of the hide-until-hover
  default: the group exists to say "this needs a when," and hiding the one control
  that fixes it defeats the group.
- **`AnytimeView`** — spec §6.3. `when_on` null and `deadline_on` null and not done,
  grouped by derived label, `Unlabelled` last. Suppress the label inside each group.
  (Note the deliberate split: a task with a deadline but no When belongs to
  Upcoming's first group, not here. Each task appears in exactly one view.)
- **`LogbookView`** — spec §6.4. `done_at` not null, newest first, grouped by day.
  Uncheck restores. **No backend work needed** — `list_tasks` filters only on
  `archived_at IS NULL`, so done-but-unarchived tasks are already in the cache.

Delete the old six-bucket `getUpcomingGroups` entirely.

Empty states: design doc §8, exact copy, including the **two different templates** —
"empty" vs "filtered-to-zero". Never show "Nothing completed yet" to someone who
typed a query.

**Gate P6:** `npm run build`; start the app and confirm all four views render with
seeded data.

---

# P7 — Integration

## P7.1 Cross-feature surfaces (spec §6.6)

- **`features/schools/SchoolRequirementsSection.tsx`** (lines ~187-213): replace the
  bare `<Link to={"/app/tasks?task=" + id}>{title}</Link>` list with a `TaskRow` list.
- **`features/schools/school-workspace-fields.tsx`**'s `QuickAddTask` (lines 78-124):
  replace with the shared `QuickAddBar`, passing `application_id` and
  `requirement_kind` as context defaults. The existing component already proves the
  context-default pattern works — you are generalising it, not replacing the idea.
- **Essay pages have no task section at all today.** Spec §6.6 requires one. Add a
  `TaskRow` list + context-defaulted `QuickAddBar` to the essay editor page, filtered
  to `essay_id === <this essay>`. This is net-new, unlike schools.
- **Rename** the local `TaskRow` function inside
  `features/ai-chat/components/mutation-receipts/TaskMutationWidget.tsx:13` to
  `TaskReceiptRow`. It is a chat-transcript component reading `MutationItem`, totally
  unrelated to the new `TaskRow`, and the name collision will cause a bad import.
  Change nothing else in that file.

## P7.2 "Plan with Counselle" (spec §8.1, decision D2)

Rewrite `PlanWithAgentButton` in `task-actions.tsx`. Delete the `aria-disabled`, the
tooltip, and the "Decision D2" comment block (lines 25-29). Rename it
`PlanWithCounselleButton` and change the label to **"Plan with Counselle"** — the
product says the noun (`DESIGN.md` §13.4).

Implement it as a `<Link to="/app/ai" state={{ draftPrompt }}>`, exactly like the two
existing callers `features/schools/SchoolDetailRoute.tsx:378` and
`features/schools/facts/SchoolFactsPanel.tsx:138`.

`draftPrompt` is a **visible, editable** string — there is no hidden channel and this
plan does not build one (D2). Compose it as:

```
<default question for this view>

Today is <weekday, D Month YYYY>. Here is what I have in <view name>:
- <title> — when: <when or "no date">, deadline: <deadline or "none">, <label>
- …
```

Cap at 40 tasks and at 2000 characters (`parseDraftPromptState` rejects longer). The
default questions are in spec §8.1, one per view.

## P7.3 Search (spec §6.5, decision D3)

`TaskSearch.tsx`, built on the existing `CommandDialog` (`components/ui/command.tsx`,
already `cmdk`-backed and ready-made for a global palette). Opens on `⌘K` and `/`.
`CommandInput` placeholder: `Search tasks…`. Zero-results copy is design doc §8's
search row — the filtered-to-zero template, not the empty template.
Filters the cached list client-side — adapt `filterTasksByQuery` and
`getSearchableTaskText` from the old `task-filters.ts` to the new field set, and
search **open and done** tasks. Results render `TaskRow`.

Keep the component's external contract as "query string in, task list out" so a
server-backed search can replace the internals later without touching the UI.

## P7.4 Keyboard map (spec §9)

Build `useTaskKeymap.ts`. No shared hotkey system exists in this app — every feature
hand-rolls `window.addEventListener("keydown", …)`. **The reference implementation to
study is `features/cds-admin/review/use-review-controller.ts:205`** — it solves the
same problem (single-letter shortcuts that must not fire while an input or editable
surface has focus) and has a companion `ShortcutsPopover.tsx` for discoverability.

Do not build a general-purpose app-wide registry — this is one feature's keymap, and
YAGNI applies. Guard every single-letter binding with the existing `isEditingSurface`
predicate from `TasksRoute.tsx:75-85` (move it into the hook).

Bindings: exactly spec §9's table.

## P7.5 Undo generalisation (spec §9, `⌘Z`)

`hooks/useUndoableDelete.ts` is structurally delete-specific — one archive/restore
pair, and `UndoToast`'s copy is hardcoded to `"{label} deleted"` (line 46).

Add `hooks/useUndoableAction.ts` alongside it (do not modify the existing hook —
activities and honors use it). Same 5s window (`UNDO_WINDOW_MS` already equals the
spec's 5s, no change), same toast, but storing `{ kind, label, inverse }`. Route the
verb through `UndoToastPending`'s **existing unused `kind?: string` slot** rather than
adding a prop, and make the toast copy read `"{label} {verb}"`.

Wire it for complete, reschedule, and delete.

**Gate P7:** `npm run build`.

---

# P8 — Deletions, tests, verification

## P8.1 Delete these files outright

```
frontend/src/features/tasks/TaskBoard.tsx
frontend/src/features/tasks/TaskColumn.tsx
frontend/src/features/tasks/TaskCard.tsx
frontend/src/features/tasks/AllTasksTable.tsx
frontend/src/features/tasks/UpcomingTasksView.tsx      (replaced by UpcomingView.tsx)
frontend/src/features/tasks/TaskDetailSheet.tsx        (replaced by TaskDetailPanel.tsx)
frontend/src/features/tasks/useTaskDrag.ts
frontend/src/features/tasks/useTaskSelection.ts
frontend/src/features/tasks/useIsResizing.ts
frontend/src/features/tasks/task-static-controls.tsx
frontend/src/features/tasks/task-inline-controls.tsx
frontend/src/features/tasks/task-sort.ts
frontend/src/features/tasks/task-mutations.ts
```

`task-sort.ts` goes because its one surviving function depends on two symbols P5
deletes, and each view now owns its ordering inline. `task-mutations.ts` goes because
after P8 nothing imports it — and its `createNewTask` is the exact code path that
creates the "Untitled task" rows spec §13 forbids.

**`task-inline-controls.tsx` (579 lines) is already dead today** — confirmed zero
imports anywhere in the bundle. It is not in the spec's §12 list because the spec
author did not know. Delete it regardless.

`TasksRoute.tsx` is replaced by `TasksLayout.tsx`; delete it once the layout is wired.
Keep `pages/tasks-page.tsx` as the barrel the router imports, re-pointed at
`TasksLayout`.

## P8.2 Tests

- Rewrite `task-model.test.ts` against the new pure modules. Drag-payload tests die
  with the drag code.
- Rewrite `TasksRoute.test.tsx` → `TasksLayout.test.tsx`. **Reuse the harness
  verbatim** — `renderApp`, `createWorkspaceFetchPreset`, `workspaceTaskFixture`, and
  the `vi.mock("@/lib/time", …)` time-pinning preamble. Rewrite only the assertions.
- The tests this plan explicitly requires, and no others: the P1.5 pair
  (`done_at` bridge, actor attribution), `formatWhenChip`/`getDeadlineState` across
  two timezones (P5.1), `parseQuickAdd` (P5.5), deadline inheritance display (P5.6),
  and the Today/Upcoming/Anytime grouping functions (P6.2).

## P8.3 Verify

```bash
uv run pytest -m "not live_llm and not live_search and not live_db"
uv run ruff check . && uv run mypy .
cd frontend && npm run build && npm test
```

Then **in a real browser**, because jsdom cannot see any of this:
1. The quick-add mirror aligns with its input at 375px and at 1440px.
2. Row height measures exactly 36px at ≥768px, 44px below.
3. Every title and every group header sits exactly 36px from the list's left edge.
4. Completing a task takes ~440ms end to end and the list closes the gap smoothly.
5. Nothing shifts position on hover — check the When chip, the flag, the quick-add
   border, and the hover-revealed schedule affordance specifically.
6. With `prefers-reduced-motion: reduce`, every transform is gone and the interaction
   is still legible.

Then walk `plans/tasks-redesign-design.md` §12 — all 30 visual acceptance criteria —
and spec §13's nine functional ones. Both lists are objectively checkable. Do not
mark this done until each has been checked, not assumed.

## P8.4 Docs

- `DESIGN.md`: §14.2's "Tasks" mapping table becomes factually wrong the moment this
  ships — it maps `status`/`priority`/`category` badges that no longer exist. Replace
  it with the new mapping (flag → `--brand`; deadline → amber at ≤2 days, red when
  overdue; no status, priority, or category badges at all), citing
  `plans/tasks-redesign-design.md` §9.4's cross-check table. Then update §20 Known
  debts: close #5 (Tasks bypasses `PageContainer` — fixed in P6.1), #17
  (`zIndex: 2147483647` — moot, `useTaskDrag.ts` is deleted), #19 (`dayDiff <= 6` vs
  `<= 7` — resolved by the single `getDeadlineState` in P5.1), and #20 (no undo on
  bulk delete — moot, bulk actions are gone). Mark #13 (`text-[13px]` scattered) as
  partially closed and note that the sites outside this feature still need a sweep.
- `CLAUDE.md`: update the MVP3 workspace paragraph to describe the new task model.
- `docs/ARCHITECTURE.md`: update the workspace section for the two-date model and the
  actor columns.
- `TODOS.md`: record the follow-up migration that drops `status`, `priority`,
  `category`, `assignee`, `needs_input`, `due_at`, `planned_for`, `reminder_at`, plus
  the `reminder_at` value export promised in spec §10.
- Move `plans/tasks-redesign-*.md` to `specs/tasks-redesign/` per the `CLAUDE.md`
  graduation rule — **only after the owner accepts the shipped work**, not before.

---

# P9 — Today manual reorder (cuttable)

Only start this after P8 is green and accepted. Nothing else depends on it.

The precedent to copy exactly is `Activity`/`Honor`, which already have a `sort_order`
column and a `PUT /activities/order` route (see the fixture handlers in
`test/render-app.tsx:565-576,651-661`).

1. Migration `0020_task_sort_order.sql`: `ADD COLUMN sort_order integer`, backfilled
   `NULL`. Null sorts last; only tasks the user has explicitly reordered get a value.
2. `PUT /tasks/order` taking `{ ids: string[] }`, assigning `sort_order` by index,
   scoped to the authenticated user. Mirror the activities route.
3. Frontend: the generic **`useReorderList`** hook already exists at
   `api/workspace/hooks/shared.ts:300-328` and does exactly "optimistically reorder a
   cached list by a supplied id order, roll back on error." It slots in unchanged the
   moment the route exists. Do not write a new one.
4. UI: `⌥↑`/`⌥↓` first — it is required regardless and is the accessible path. Then
   the hover-revealed grip per design doc §3.10, in the list container's 16px gutter
   so the row's own geometry and the 36px spine stay byte-identical across all views.
5. **Do not add a drag-and-drop library.** `DESIGN.md` §17.5 forbids it by name
   ("no dnd-kit, no react-beautiful-dnd"). Narrow the native-HTML5 pattern from the
   deleted `useTaskDrag.ts` to a single axis, or ship keyboard-only.

---

# Appendix A — file disposition

| File | Disposition |
|---|---|
| `TasksRoute.tsx` | DELETE → `TasksLayout.tsx` |
| `TaskBoard.tsx`, `TaskColumn.tsx`, `TaskCard.tsx`, `AllTasksTable.tsx` | DELETE |
| `useTaskDrag.ts`, `useTaskSelection.ts`, `useIsResizing.ts` | DELETE |
| `task-static-controls.tsx`, `task-inline-controls.tsx` | DELETE (the latter is already dead) |
| `UpcomingTasksView.tsx` | DELETE → `UpcomingView.tsx` |
| `TaskDetailSheet.tsx` | DELETE → `TaskDetailPanel.tsx` (salvage 3 primitives) |
| `task-actions.tsx` | REWRITE `PlanWithAgentButton`; keep `TaskSchoolChip`, `TaskDeleteMenu` |
| `task-dates.ts` | REWRITE IN PLACE (edit, don't replace) |
| `task-config.ts`, `task-filters.ts`, `task-types.ts` | REWRITE |
| `task-sort.ts` | **DELETE** — its one surviving function, `compareTasksByPlanningDate`, imports `getPlanningDate` (deleted in P5.1) and `prioritySortRank` (deleted in P5.2). Each view owns its own ordering inline per P6.2. |
| `task-mutations.ts` | **DELETE** — after P8 nothing imports it. Its three exports are consumed only by files this plan deletes, and `createNewTask` is literally the source of the "Untitled task" rows spec §13 forbids. |
| `task-model.test.ts`, `TasksRoute.test.tsx` | REWRITE (reuse the harness) |
| `pages/tasks-page.tsx` | KEEP (barrel; re-point at `TasksLayout`) |
| **NEW** | `TasksLayout.tsx`, `TodayView.tsx`, `UpcomingView.tsx`, `AnytimeView.tsx`, `LogbookView.tsx`, `TaskRow.tsx`, `TaskDetailPanel.tsx`, `SchedulerPopover.tsx`, `QuickAddBar.tsx`, `task-parse.ts`, `TaskSearch.tsx`, `useTaskKeymap.ts`, `hooks/useUndoableAction.ts` |

Expected: ~5,555 lines → ~1,400.

# Appendix B — the five ways this gets made ugly

From `plans/tasks-redesign-design.md` §13, ranked by probability. Read that section
in full; this is the index.

1. Every meta item becomes a `Badge` → chip-shape means interactive; plain text means
   informational.
2. A hairline appears between every row → zero dividers; the 24px/4px group rhythm is
   the only separation.
3. Row titles ship at `font-medium` → they are 400; the only `font-medium` in the list
   body is the group header.
4. The list gets wrapped in a `Card` → the list has no container; rows sit on
   `--canvas`.
5. Overdue becomes a red pill, row, or left border → overdue is ink: word, glyph, hue,
   never a fill.
