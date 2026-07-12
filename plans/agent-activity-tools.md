# Implementation Plan: Agent Workspace Tools — Phase 4: Activities & Honors

Status: Draft for review
Date: 2026-07-10
Branch: feat/mvp3-frontend-prototype (same working branch as the task/school/essay tools)

## Goal

Give the Counselle agent full control over the student's Activities page — the
Common App activities list (max 10) and honors list (max 5). Unlike essays,
there is no document layer here: every object is a small structured row. What
makes this surface special is that **it is an export target with hard external
constraints the agent must respect honestly**:

- **Order is meaning.** Common App rank = importance. Position 1 is the
  student's headline activity. The agent needs first-class reorder control.
- **Character budgets are the craft.** Position 50 · organization 100 ·
  description 150 · honor title 100. The signature agent move on this page is
  compressing a student's real story into 150 truthful characters — never
  inventing impact to fill space, never silently shipping an over-limit entry.
- **The `story` field is Counselle-only raw material** (never exported). The
  agent interviews, saves the full story there, and distills the description
  from it.

## Current state (verified 2026-07-10)

- `app/workspace/service_activities.py` is complete for both object types:
  list / create / update / archive / restore / **reorder**, with caps
  (`_ACTIVITY_CAP = 10`, `_HONOR_CAP = 5`) enforced on create *and* restore,
  change-log rows (`actor`), and SSE events. **No new service capability is
  needed** — this is a pure tool-layer feature (plus one one-line hardening
  fix, below).
- The Common App semantics live in `frontend/src/domain/activity.ts`:
  `ActivityType` (30 fixed values), `Grade` (`"9"|"10"|"11"|"12"|"pg"`),
  `Timing` (`"school_year"|"break"|"all_year"`), `RecognitionLevel`
  (`"school"|"state_regional"|"national"|"international"`), char limits
  (50/100/150, honor title 100), `HOURS_MAX = 168`, `WEEKS_MAX = 52`. The
  backend models (`ActivityCreate` / `ActivityPatch` / `HonorCreate` /
  `HonorPatch`) are deliberately loose (`str`, `list[str]`) — the UI is the
  gate for students. The FE file carries a caveat: confirm the vocab against
  the live Common App form each cycle.
- The UI treats char limits as warn-not-block (amber at 90%, red over) — an
  over-limit draft saves fine; only the real Common App form would reject it.
- Task tools (`agent_tools.py` + `agent_tools_mutations.py`), school tools
  (`agent_tools_schools*.py`), and the essay-tools plan
  (`plans/agent-essay-tools.md`) define the template: `ToolCtx`, direct
  service calls with `actor="counselle"`, fixed-key-order rows with
  nulls/defaults omitted, `error()` payloads with `retryable` + `recovery`
  (ADR 0029), batch caps via shared `BATCH_MIN`/`BATCH_MAX`, everything
  through `process_tool_result`.
- Mount point: `build_workspace_tools` (agent_node.py). Tool gating:
  `tool_specs.py` (`"auth"`). Timeline: `step_labels.yaml` `kind: workspace`.
  Prompt: `counselor.md` playbooks gated on tool presence.

### Service hardening required (review finding 2026-07-10)

`_REQUIRE_ACTIVE_SQL` selects only `id`, but `_update_row` returns that
id-only record when the patch is empty — `Activity.model_validate(dict(row))`
then fails on missing fields, so an empty PATCH from the student API today is
a 500, not a no-op. One-line fix in `service_activities.py`: change both
`_REQUIRE_ACTIVE_SQL` statements to `SELECT *`. The agent tools also guard
no-field calls at the tool layer (they never hit this path), but the latent
student-facing 500 should die regardless.

## Binding design decisions (proposed — confirm before implementing)

1. **One surface, one read tool.** `view_activities` returns *both* lists
   (activities + honors) in one payload. The page is one Common App surface
   with at most 15 rows total — there is nothing to paginate, filter, or
   search. No `search_activities`, no `get_activity`; full detail (including
   full `story` text) rides in the view. If stories ever bloat the payload,
   the overflow middleware already handles it; a `get_activity` can be added
   later if evals show the need.
2. **Common App vocabulary is enforced in the tool schema, not the service.**
   `ActivityDraft` / `HonorDraft` (and the update params) use `Literal` types
   mirroring `frontend/src/domain/activity.ts` — the 30 activity types,
   grades, timing, recognition levels, plus `Field(ge=1, le=168)` /
   `(ge=1, le=52)` on hours/weeks. PydanticAI's schema validation then
   rejects invented values for free with a self-correcting retry, and the
   model sees the legal vocab in the tool schema without any docstring
   bloat. The service models stay loose (the student UI is already
   constrained; smallest diff). Both copies carry a cross-reference comment
   naming the other file and the confirm-each-cycle caveat.
3. **Char limits warn, never block** — the same posture as essay word limits
   and the student UI. Saves always succeed; over-limit results carry a
   `warning` with exact counts. **Counts are honesty-critical:** every
   rendered row shows true `len()` character counts for the budgeted fields
   (`chars: "position 12/50 · org 45/100 · desc 158/150 OVER"`), because the
   Common App form will hard-reject what we soft-allowed. Never round, never
   estimate.
4. **Hours/weeks out of range is an error, not a warning.** 200 hours/week is
   input nonsense, not student intent — schema bounds reject it (decision 2).
5. **Order is a first-class mutation.** `reorder_activities` /
   `reorder_honors` take the *complete* ranked id list; the service already
   enforces set-equality with the active rows, which makes the operation
   atomic and self-validating. Rank renders 1-based in every row.
6. **Caps are curated errors.** The tool pre-checks `active + batch ≤ cap`
   and returns a teaching error ("the Common App allows 10 activities —
   archive one first, or fold this into an existing entry") rather than
   letting the service raise mid-batch. Restore over cap reuses the service
   guard with the same recovery.
7. **Duplicate guard, cheap version.** Activities: an active row with the
   same case-insensitive (position, organization) pair rejects the batch,
   naming the existing id; honors: same case-insensitive title. `force=true`
   overrides (mirrors `create_tasks`). No trgm — 15 rows max, equality is
   enough.
8. **Direct edits, `actor="counselle"`,** same transaction/change-log/SSE
   path as the HTTP routes — identical to the task/school/essay stance.
9. **No new ADR.** These tools introduce no new architecture; they are the
   fourth application of the ADR 0029 pattern. The ADR's tool inventory
   mention gets extended if it lists tools by name.

## Part A — Tool interface spec (implement verbatim)

Eleven tools: one shared view + five per object type. Shared conventions
apply: `"status": "ok"` + `today`; `error()` payloads; fixed-key-order rows
with null/default fields omitted; batch caps via `BATCH_MIN`/`BATCH_MAX`
(1–20) and `batch_size_error`; every payload through `process_tool_result`.

### A.1 `view_activities` (read — the whole page)

```
view_activities(
  status: Literal["active", "archived", "all"] = "active",
) -> {status, today, summary, activities: [row], honors: [row], footer}
```

Activity row (rank order = current sort_order, 1-based):

```
{rank, id, type, position, organization, description,
 grades: ["9","10"], timing: ["school_year"],
 hours_per_week?, weeks_per_year?, continue?,     # omitted when null
 chars: "position 12/50 · org 45/100 · desc 148/150",
 story?}                                           # full text, omitted when empty
```

Honor row: `{rank, id, title, grades, levels, chars: "title 34/100"}`.

- Lists are raw vocab values (the model echoes them back into updates) — no
  prettifying.
- `summary`: "7 of 10 activity slots · 3 of 5 honor slots." Empty board
  summary + footer teach the interview-first playbook ("ask about their
  extracurriculars, then create_activities").
- Footer (non-empty): order = Common App importance rank; reorder tools
  change it; over-limit entries are flagged in `chars` and warrant a trim.
  When any row is over a limit, the footer says so explicitly.
- `status="archived"` / `"all"`: archived rows carry `state: "archived"` +
  `archived` date (no rank); footer offers `restore_activity` /
  `restore_honor`.

### A.2 `create_activities` (batch, all-or-nothing validation)

```
create_activities(activities: list[ActivityDraft], force: bool = False)
  -> {status, today, summary, activities: [row], footer?, warning?}

ActivityDraft = {
  type: ActivityType,                    # 30-value Common App Literal
  position: str,                         # role/leadership, budget 50
  organization: str = "",                # budget 100
  description: str = "",                 # budget 150
  grades: list[Grade] = [],
  timing: list[Timing] = [],
  hours_per_week: int | None = None,     # 1–168 (schema-bounded)
  weeks_per_year: int | None = None,     # 1–52 (schema-bounded)
  continue_in_college: bool | None = None,
  story: str | None = None,              # Counselle-only, never exported
}
```

- Batch bound is the shared `BATCH_MIN`/`BATCH_MAX` (1–20) via
  `batch_size_error` — no activity-specific cap constant; the *real*
  constraint is slot capacity (`active + batch ≤ 10`), reported by
  `slot_cap_error` (decision 6).
- Pre-checks (whole batch rejected on first failure, nothing created):
  batch size, slot capacity, duplicate guard (decision 7, `force`
  overrides).
- New rows append at the end of the rank order (service behavior); the
  result footer notes the ranks and suggests `reorder_activities` if the
  student's phrasing implied importance ("my main activity is…").
- Over-limit fields save with a `warning` naming each row/field and its
  exact count (decision 3).
- Like `create_tasks`, atomicity is validation-level: everything is checked
  up front, then rows insert sequentially (each in its own service
  transaction). Good enough at this scale; same stance as tasks.

### A.3 `update_activity` (single)

```
update_activity(
  activity_id: str,
  type: ActivityType | None = None,
  position: str | None = None,           # "" empties
  organization: str | None = None,
  description: str | None = None,
  grades: list[Grade] | None = None,     # replaces the whole list
  timing: list[Timing] | None = None,
  hours_per_week: int | Literal["clear"] | None = None,
  weeks_per_year: int | Literal["clear"] | None = None,
  continue_in_college: bool | Literal["clear"] | None = None,
  story: str | Literal["clear"] | None = None,
) -> {status, today, summary, activity: row, warning?}
```

- No-field calls → retryable error ("pass at least one field").
- Unknown/archived id → `stale_activity_error` (A.11).
- Over-limit → save + `warning` with counts.
- Docstring routes ordering to `reorder_activities` (rank is not a field).

### A.4 `archive_activities` (batch 1–20, per-item) / `restore_activity` (single)

Mirror `archive_tasks` / `restore_task` exactly: per-item results for archive
(unknown ids reported individually, successes stand), all-or-nothing single
restore. **Param naming is a contract with the step-label phrase functions**
(see Part B): the batch params are `activities` (create) and `activity_ids`
(archive) — exactly parallel to `tasks`/`task_ids`, which
`app/steps.py::_tasks_phrase` reads by those names. Restore over the cap → curated error, recovery "archive another
activity first — the Common App allows 10." Restore result includes the row
and its (end-of-list) rank.

### A.5 `reorder_activities` (single, atomic)

```
reorder_activities(ids: list[str])   # the COMPLETE active list, new rank order
  -> {status, today, summary, activities: [row], footer}
```

- Docstring: "Pass every active activity id from view_activities, in the new
  order, most important first — rank 1 is the activity admissions officers
  see first."
- The service's set-equality guard surfaces as a retryable error: "ids must
  be exactly the current active activities — call view_activities and
  resubmit the full list." Duplicate ids → the service's uniqueness error,
  same recovery.
- Result re-renders the full ranked list so the model confirms the outcome.

### A.6–A.10 Honor tools

`create_honors` / `update_honor` / `archive_honors` / `restore_honor` /
`reorder_honors` — exact structural mirrors of A.2–A.5 with the honor shape:

```
HonorDraft = {
  title: str,                            # budget 100
  grades: list[Grade] = [],
  levels: list[RecognitionLevel] = [],   # multi-select
}
```

Cap 5; duplicate guard on case-insensitive title; same warn-never-block char
posture on `title`. Batch params named `honors` / `honor_ids` (the phrase
contract, A.4).

### A.11 Error payloads

Reuse `error()` from `agent_tools_shared`. New canned errors:

- `stale_activity_error(id)` / `stale_honor_error(id)` — "No active
  activity/honor with id … Call view_activities to see the current lists and
  their ids (archived entries come back with restore_…). Do not retry this
  same id."
- `slot_cap_error(kind, cap, active)` — the teaching cap error (decision 6).
- Reorder set-mismatch error (A.5).
- Vocab and range violations never reach the tool body — PydanticAI schema
  validation returns them to the model as retries (decision 2).

## Part B — Integration changes (file-by-file)

| File | Change |
|---|---|
| `app/workspace/service_activities.py` | `SELECT *` in `_REQUIRE_ACTIVE_SQL` (hardening finding) |
| `app/workspace/agent_tools_shared.py` | `ActivityType`/`Grade`/`Timing`/`RecognitionLevel` Literals + char-limit/cap constants (cross-ref comment → `frontend/src/domain/activity.ts`), `ActivityDraft`, `HonorDraft`, `stale_activity_error`, `stale_honor_error`, `slot_cap_error` |
| `app/workspace/agent_tools_activities.py` | new — `view_activities`, row rendering, `chars` budget line, kind-generic helpers shared with the mutation modules |
| `app/workspace/agent_tools_activities_mutations.py` | new — `create_activities`, `update_activity`, `archive_activities`, `restore_activity`, `reorder_activities` |
| `app/workspace/agent_tools_honors_mutations.py` | new — the five honor tools (thin: reuse the kind-generic helpers) |
| `app/workspace/agent_tools.py` | mount the eleven tools in `build_workspace_tools`; module + factory docstring update |
| `app/tool_specs.py` | eleven entries, all `"auth"` |
| `app/steps.py` | `_activities_phrase` / `_honors_phrase` (reading `activities`/`activity_ids` and `honors`/`honor_ids`, mirroring `_tasks_phrase`) + the two new keys in the label-params dict |
| `config/assets/step_labels.yaml` | eleven `kind: workspace` labels ("Checking activities & honors", "Adding {activities_phrase}", "Updating an activity", "Removing {activities_phrase}", "Bringing back an activity", "Reordering the activities list", honor equivalents) |
| `config/assets/prompts/counselor.md` | "Workspace Activities & Honors" playbook (below) |
| `tests/app/test_tool_specs.py`, `tests/app/test_steps.py` | extend the existing spec/label parity coverage |
| `tests/app/test_workspace_tools_activities.py` | new — tool-contract tests (Part C) |
| `tests/app/test_workspace_services_unit.py` | empty-patch no-op regression for the hardening fix |
| `evals/questions.yaml` (+ `evals/runner.py` if a new eval type is needed) | one activities eval using the existing `workspace: true` user-seeding seam and the `workspace-task` eval type as the template |

Prompt playbook (gated on tool presence, like tasks/schools):

- view before discussing or changing; exact ids only, never constructed;
- order = importance — rank 1 is the headline activity; confirm before big
  reorders the student didn't ask for;
- the 150-char description is a craft: compress the student's *real* story —
  never invent numbers, roles, impact, or awards to fill space; when material
  is thin, interview for the real detail first;
- capture the full story in `story` (it is private to Counselle and never
  exported), then distill the description from it;
- never leave an over-limit entry unmentioned — the Common App form will
  reject it even though the workspace saves it;
- caps are real (10 activities, 5 honors): when full, help the student choose
  what to cut or merge — confirm before archiving anything;
- after any change, tell the student plainly what changed on their page.

## Part C — Tests & evals

Test only what is genuinely new — the schools tools set the precedent
(spec/label parity only; the batch/stale/clear/link mechanics were already
proven on the task tools and reuse the same helpers). The new logic here,
and the honesty-critical char counts (an export-integrity surface), earn
real tests:

- `chars` rendering: exact counts, OVER flag, per-field boundaries (149, 150,
  151 chars).
- Warn-never-block: over-limit create/update saves and carries the warning.
- Slot-cap error on create batch and on restore.
- Reorder: happy path re-ranks, set-mismatch and duplicate-id errors carry
  the re-view recovery.
- Duplicate guard (case-insensitive pair/title) + `force`.
- Service regression: empty patch is a no-op, not a 500.

Skip re-testing what tasks already pin: batch-size errors, stale-id shapes,
clear sentinels, no-field errors, foreign-id opacity — same shared helpers,
same service scoping, no new failure mode.

Evals: one live eval — the student pastes a resume-style blurb; the agent
creates the activities, compresses one description to ≤150 chars *without
inventing facts*, and reorders on "robotics is my main thing."

## Phases (each gated on `uv run pytest -m "not live_llm and not live_search and not live_db"` + `ruff` + `mypy`)

1. Shared layer: vocab Literals, drafts, canned errors in
   `agent_tools_shared.py`; service hardening fix + regression test.
2. `view_activities` + row/chars rendering + tests.
3. Activity mutations (A.2–A.5) + tests.
4. Honor mutations (A.6–A.10) + tests.
5. Wiring: mount, `tool_specs`, `step_labels` + the `steps.py` phrase
   functions, counselor.md playbook; parity tests green.
6. Eval + review pass + commit.

## Risks

- **Tool-count growth** — 33 mounted workspace tools once essays land
  (13 + 9 + 11). Descriptions stay tightly scoped and the vocab lives in
  schemas, not prose; the schools rollout showed clean routing at 13 and the
  essay plan already commits to watching evals — same watch here. If routing
  degrades, the honor tools are the consolidation candidates.
- **Vocab drift** — the Common App list is duplicated FE/BE (a wire contract,
  like TaskStatus). Cross-reference comments on both copies + the
  confirm-each-cycle caveat; no automated bridge (not worth it for a
  once-a-year check).
- **Story payload size** — full stories ride in `view_activities`. Bounded by
  the 10-row cap and the overflow middleware; add `get_activity` only if
  evals show bloat.
- **Batch-create atomicity is validation-level**, same as `create_tasks` — a
  concurrent student write between the cap pre-check and the last insert can
  land a partial batch. Vanishingly rare at this scale; the service cap still
  prevents exceeding 10/5.

## Out of scope (explicitly)

- Common App export/copy tooling (the FE "copy" affordance is the export
  path today).
- AI drafting UX inside the Activities page UI (drawers, suggestions) — the
  agent works through chat; the page updates live via the existing SSE
  invalidation.
- Any new service capability or schema change beyond the one-line hardening
  fix.
- Wiring the mvp3-frontend activities page to the live API if any of it is
  still fixture-bound (separate task; the tools target the real service
  regardless).
