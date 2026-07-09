# Plan: Workspace Object Completeness (pre-agent-tools field pass)

Status: REVIEWED v3 — 3-reviewer pass (domain, codebase verification,
agent-contract) 2026-07-08; founder cuts applied same day (feedback channel
de-scoped, `platform` field dropped, per-school task seeding removed).
Branch: feat/mvp3-frontend-prototype
Depends on: MVP3 workspace (shipped 2026-07-06, `specs/mvp3/workspace-design.md`, ADR 0027)

## Problem statement

The agent's workspace tools are about to be written. Tool schemas are direct
projections of the service-layer patch models (`ApplicationPatch`, `TaskPatch`,
`EssayPatch`, …) — per ADR 0027, tools wrap the exact same service functions as
the HTTP routes. Anything untyped, missing, or wrong in those models today is a
frozen tool-contract problem tomorrow. Before writing tools, close the
field-level gaps a real US applicant hits in the existing objects, and pin the
essay-layer contracts (write format, concurrency) that would otherwise be
invented after the freeze.

**Non-goals:** new pages, new objects (student profile, recommenders,
per-school workspaces — parked, see below), Calendar, deploy, the agent tools
themselves.

## Audit verdict (post-review)

- **Tasks** — complete except one enum value (`interview`, change 10).
- **Essays** — columns are fine; the *service layer* is not. `word_count` is
  caller-supplied (change 8), deadline is derived-only (change 7), updates are
  unconditional last-write-wins (change 9). The untyped `comments`/
  `suggestions` jsonb is de-scoped from v1 (see Confirmed non-changes).
- **Activities & Honors** — complete. Verified Common-App-faithful (10
  activities; 50/100/150 char limits; 5 honors, 100-char title; grade/timing/
  level sets all match). No changes. Keep the "re-verify against the live form
  each cycle" posture.
- **Applications** — the spine and the thinnest object; changes 1–6.
- **Seeding** — the per-school starter checklist is removed outright
  (change 11): founder decision 2026-07-08, per-school workspaces are a future
  feature. This also removes the checklist's never-lie violation ("Complete
  the Common App sections" seeded for UC/MIT/Georgetown/ApplyTexas schools).

## Changes

### Applications

**1. Status: add `Deferred` and `Enrolled`.**
Current: `Considering | Applying | Submitted | Accepted | Rejected |
Waitlisted | Withdrawn`.
- `Deferred` — EA→deferred-to-RD is among the most common outcomes and the
  moment of peak counseling need (LOCI). Mid-cycle state, positioned after
  `Submitted`.
- `Enrolled` — the model currently cannot record where the student committed
  on May 1; a student with five acceptances has five identical `Accepted` rows
  forever, and "deposited at B, still on A's waitlist" is unrepresentable.
  Terminal state, after `Accepted`.
- Documented semantics (goes in the tool contract): mid-cycle =
  `Considering/Applying/Submitted/Deferred/Waitlisted`; terminal =
  `Accepted/Rejected/Withdrawn/Enrolled`. `Withdrawn` also covers "declined an
  offer" — no separate `Declined` value. Never auto-flip other schools when
  one becomes `Enrolled`; declining is the student's action to record.

**2. Round: add `ED2` and `REA`; remove `Scholarship deadline`.**
- `ED2` — real, binding January round; the standard move after ED1 rejection.
- `REA` — restrictive early action; constrains the rest of the list, so round
  strategy advice is impossible without it.
- Remove `Scholarship deadline` — a date pretending to be an admission plan;
  it caps the product at one tracked date per school. Data migration: rows
  with `round = 'Scholarship deadline'` → `round = 'RD'`, copy `deadline` into
  `scholarship_deadline` (dev-only data; check row count first).
- `Priority` stays — real vocabulary at big publics, distinct from Rolling.

**3. New date columns: `aid_deadline date NULL`, `scholarship_deadline date
NULL`.** CSS Profile/FAFSA priority dates are per-school and the most-missed
deadline class; scholarship date absorbs the removed round value. User-owned,
never guessed (never-lie; pipeline coverage ~0). FAFSA-vs-CSS as separate
columns is over-modeling — extra dates are `category="aid"` tasks.

**4. `notes text NULL`.** The school object has no free text anywhere while
every other object has its raw-material layer (task `notes`, activity
`story`). Fit impressions, visit notes, portal URLs, deferral dates live here.
Agent-readable and agent-writable, but agent writes are **append-semantics at
the tool layer** (see Tool-contract decisions) — a whole-field replace from a
tool must never rewrite the student's own words.

**5. `intended_major text NULL`.** Students apply to a program, not a school
(CS at one place, undecided at another); supplements ask "why this major."
Free text, not controlled vocabulary.

**6. `test_plan` (nullable): `submit | withhold | undecided`.** The per-school
score-submission decision every applicant makes in the test-optional era;
today the student has nowhere to record it. Score *values* stay parked with
the profile object; the per-school *decision* belongs here.

### Essays

**7. Per-essay `deadline date NULL` override.** Scholarship and
honors-college essays have their own dates, and if tools freeze with deadline
read-only, `update_essay` gains a field post-freeze — the exact churn this
plan exists to prevent. Implementation note (verified): the existing
projections select `e.*, a.deadline` — a naive new column silently collides;
use `COALESCE(e.deadline, a.deadline) AS deadline` for the effective value.

**8. Server-derived `word_count`.** Today `word_count` is a plain patchable
integer the caller supplies; a tool that writes `content` without a matching
`word_count` silently desyncs every roll-up. Derive it server-side whenever
`content` is in the patch (the `_tiptap_text` extractor already exists in
`service_essays.py`), and drop `word_count` from the tool-facing schema.

**9. Optimistic-concurrency guard on essay updates.** All updates are
unconditional last-write-wins; the core product loop is *student has the
editor open while the agent works*, and an agent full-doc `content` write
racing the debounced autosave loses student prose with no recovery (snapshots
are deferred). Add an optional `expected_updated_at` precondition to
`update_essay` (reject with conflict if stale). Applications/tasks stay
last-write-wins (fine — field-granular, low-stakes).

### Tasks

**10. Category: add `interview`.** The plan's premise (enums freeze into tool
contracts) applies to `TaskCategory` identically. Alumni interviews are
near-universal at the schools these students target and are a deadline-bearing
Nov–Feb workflow. Additive Literal change.

### Seeding

**11. Remove per-school task seeding (founder decision 2026-07-08).**
Adding a school no longer spawns a starter checklist. Rationale: a proper
per-school workspace is a planned future feature; a generic 6-task checklist
is not it, and its Common-App wording was a live never-lie violation for
UC/MIT/Georgetown/ApplyTexas schools.
- Empty the `tasks:` list in `config/assets/workspace_seeding.yaml` — keep
  the seeding mechanism (`seeding.py`, template model, transactional add)
  intact; only the template shrinks. Zero code deleted, future feature slots
  back in via config.
- The seeded **essay slot stays** (one supplement per school), retitled
  `"Supplemental essay (confirm required)"` — many schools have zero
  supplements; the current title asserts one exists.
- Follow-through: new schools now start at 0/0 task progress — verify the
  Schools table/detail progress cells render 0/0 sanely (empty state, not
  "0% complete" alarm); update tests that assert seeded task counts and any
  add-school UI copy that promises a checklist.

## Tool-contract decisions (recorded now, no schema cost)

These bind the tool layer when it's written; they exist so the first tool
written doesn't freeze the wrong contract:

1. **Essay write format is markdown/plaintext, converted to Tiptap at the
   tool boundary.** LLMs cannot reliably emit Tiptap JSON for non-trivial
   docs and it wastes tokens both directions; a small md→Tiptap adapter
   (paragraphs/headings/bold/italic/lists) is mechanical. `content: object`
   must not appear in the tool schema.
2. **Agent-writable allow-list per object.** Applications: agent may write
   `list_type, round, deadline, aid_deadline, scholarship_deadline,
   intended_major, test_plan`; decision statuses
   (`Accepted/Rejected/Enrolled/…`) are student-only — the agent files a
   `needs_input` task instead; `notes` writes are append-only at the tool
   layer. Tasks/essays/activities: fully writable (soft-archive + change log
   make this safe).
3. **Create idempotency at the tool layer.** `create_task`/`create_essay`
   have no natural key; a retried tool call duplicates. Dedupe by
   title+link on retry in the tool wrapper — do not add a
   `client_request_id` column.

## Confirmed non-changes (audited, decided against or deferred)

- **`platform` field — dropped (founder decision 2026-07-08).** The
  application-platform distinction (Common App/UC/Coalition/ApplyTexas) is
  deferred along with the per-school workspace concept.
- **Essay feedback channel — de-scoped from v1 (decided 2026-07-08).**
  Review finding for the record: `comments`/`suggestions` are untyped
  `jsonb '[]'` with no write path (not in `EssayPatch`; only
  `duplicate_essay` copies them; UI renders counts only). v1 agent feedback =
  chat + tasks. The columns stay but are **not exposed to tools** — no tool
  may read or write them. The future feature lands as typed models
  (`EssayComment`/`EssaySuggestion`) + append/resolve service functions —
  additive new tools, so deferring causes no contract churn. The only
  forbidden path is exposing the raw arrays via `EssayPatch` meanwhile.
- Essay `char_limit` — UC PIQs are word-limited (350 words); `word_limit`
  covers Common App/Coalition/UC. Char caps live in portal activity boxes
  (export concern, not essays).
- Status split into workflow + outcome fields — one enum with documented
  semantics is enough.
- `decision_date`, essay-reuse links, portfolio/audition fields, honors-college
  fields, fee waivers — expressible via tasks + `notes`; revisit post-agent.
- Field-level change-event payloads — additive later
  (`workspace_changes.fields jsonb`), doesn't touch tool contracts.

## Parked — future features, not this pass

- **Per-school workspace** (rich per-school checklist/requirements surface).
  Founder-stated direction; the removed generic seeding (change 11) is *not*
  a preview of it. The seeding mechanism stays in place as its landing slot.
- **Student profile** (GPA, scores, rigor, geography, budget, citizenship).
  Gates "is this a reach *for me*?" — `list_type` is a self-assigned label
  with no data behind it. **Sequence with the agent tools, not after.**
  Verified not a tool-contract trap: profile lands as new read tools; it does
  not change `update_application`'s schema.
- **Recommenders / LOR tracking** (per-recommender × per-school:
  asked → agreed → submitted).

## Touchpoints (verified file manifest)

Backend:
- [ ] `migrations/0008_application_fields.sql` — new columns (applications:
  2 dates + notes + intended_major + test_plan; essays: deadline) + round
  data migration. Needs `-- depends: 0007_workspace` header (yoyo
  convention).
- [ ] `migrations/0008_application_fields.rollback.sql` — required; all 7
  existing migrations are paired with rollbacks.
- [ ] `app/workspace/models.py` — `ApplicationStatus`/`Round`/`TaskCategory`
  Literals; `Application`/`ApplicationView`/`ApplicationPatch` fields (new
  fields are patch-only — `ApplicationCreate` unchanged); `EssayPatch`
  (deadline; drop caller `word_count` from tool path).
- [ ] `app/workspace/service_applications.py` — `update_application` uses
  hand-written per-column `CASE WHEN $n` SQL with positional params; every
  new patchable field = new placeholders + renumbering. No dynamic builder
  exists. `add_application` INSERT unchanged.
- [ ] `app/workspace/service_essays.py` — `_update_essay_row` same CASE WHEN
  pattern; `COALESCE(e.deadline, a.deadline)` in `_ESSAY_LIST_SQL`/
  `_ESSAY_GET_SQL`; server-side word_count on content writes;
  `expected_updated_at` precondition.
- [ ] `config/assets/workspace_seeding.yaml` — empty `tasks:` list; retitle
  essay slot (change 11).
- [ ] `app/workspace/changes.py` — no change (verified: events don't
  enumerate fields; new-field patches emit `application.updated` for free).
- [ ] `api/routes/applications.py`, `api/routes/essays.py` — no change
  (verified: routes import the models directly; no separate schemas).

Backend tests:
- [ ] `tests/app/test_workspace_models.py` — enum coverage.
- [ ] `tests/app/test_workspace_services_unit.py` — natural home for new unit
  coverage (word_count derivation, update precondition, empty seeding
  template).
- [ ] `tests/app/test_workspace_services_live.py` — `ApplicationCreate`/
  `ApplicationPatch` call sites (~156–575); seeded-task assertions must
  change to expect zero.
- [ ] `tests/api/test_workspace_routes.py` — round/status validation cases
  (~366–425); add-school seeded-ids response assertions.
- [ ] `tests/api/test_workspace_routes_live.py` — verify scope when closing.

Frontend:
- [ ] `frontend/src/api/workspace/types.ts` — enums, Application*/Essay*
  types (`SeededWorkspaceIds` shape unchanged — `task_ids` just arrives
  empty).
- [ ] `frontend/src/domain/school.ts` — `School` mapping.
- [ ] `frontend/src/domain/task.ts` — `TaskCategory` + patch field list.
- [ ] `frontend/src/features/tasks/task-config.ts` — `interview` label +
  badge color.
- [ ] `frontend/src/features/schools/SchoolDetailSheet.tsx` — hardcoded
  status/round option arrays (48–65); new inputs (notes textarea, major,
  test plan, aid/scholarship dates). Needs a small layout pass.
- [ ] `frontend/src/features/schools/AddSchoolDialog.tsx` — hardcoded
  roundOptions (32–39); remove any copy promising a seeded checklist.
- [ ] `frontend/src/features/schools/schools-config.ts` — `statusVariant`/
  `statusSortRank`/`roundSortRank` are exhaustive `Record<Enum, …>` maps;
  the compiler enforces completeness here (free check).
- [ ] `frontend/src/features/schools/schools-filters.ts` — string-equality
  filters; **decide**: does `Deferred` count under the "applying" filter
  bucket? (Product call, not mechanical.)
- [ ] `frontend/src/features/schools/school-cells.tsx` — verify
  `ProgressValue` renders 0/0 sanely for newly added schools (change 11).
- [ ] `frontend/src/features/schools/SchoolMobileList.tsx` — renders status/
  round badges (was missing from v1 manifest).
- [ ] `frontend/src/api/workspace/hook-utils.ts` — `tempApplication()`
  builds `ApplicationView` field-by-field for optimistic updates; compile
  error until new fields added (load-bearing, was missing from v1).
- [ ] `frontend/src/test/render-app.tsx` — `workspaceApplicationFixture` is
  a full Application literal reused across most integration tests
  (load-bearing, was missing from v1).
- [ ] `frontend/src/fixtures/schools.ts` — dead code (zero live importers);
  remove the stale `"Scholarship deadline"` literal as cleanup.
- [ ] `frontend/src/features/schools/schools-sort.ts` — no edits needed
  (verified: consumes config maps).
- [ ] Frontend tests: `AddSchoolDialog.test.tsx`, `schools-model.test.ts`,
  `SchoolsRoute.test.tsx` (fixtures use valid values; scan after fields
  land), essays + tasks test files touched by their changes, any test
  asserting seeded tasks after add-school.

Scope note: `mvp3-frontend/` and `frontend.backup-20260705-070513/` are stale
tracked duplicates that still contain `"Scholarship deadline"`. They are not
part of the live app (`README.md` names `frontend/` as the SPA); acceptance
criterion 3 applies to live code. Deleting the stale trees is separate repo
hygiene, not this plan.

## Enforcement map (verified)

No DB CHECK constraints exist; enums live in exactly two places — Pydantic
`Literal` types (`app/workspace/models.py`) and TS string-literal unions
(`frontend/src/api/workspace/types.ts`) — plus the exhaustive frontend config
maps that make the TS compiler catch missed spots. The migration adds columns
only; no constraints to add/drop.

## Risks

1. **Enum removal breaks existing rows/UI** — mitigated by the round data
   migration and dev-data row-count check.
2. **Scope creep toward the profile object** — line held: `test_plan` is the
   only profile-adjacent field, and it is per-application by nature.
3. **Detail sheet crowding** — ~6 new inputs; small layout pass (grouped
   sections), not a redesign.
4. **Seeding removal regressions** — the add-school flow, progress roll-ups,
   and several tests assume seeded tasks exist; change 11's follow-through
   list covers them, but this is the change most likely to leave a stale
   assertion behind.

## Acceptance criteria

1. A student can record: `Deferred` and `Enrolled` states; `ED2`/`REA`
   rounds; admission + aid + scholarship dates independently; per-school test
   plan; notes; intended major. All patch through the service layer with
   actor attribution and emit change events.
2. Essay: per-essay deadline override (effective = COALESCE with the linked
   application); `word_count` derived server-side on content writes;
   comments/suggestions stay unexposed to tools (de-scope recorded);
   `expected_updated_at` precondition on `update_essay`.
3. No `Scholarship deadline` round remains in live code (DB rows, backend
   models, frontend types/UI/fixtures/tests).
4. Adding a school seeds zero tasks and one `"Supplemental essay (confirm
   required)"` slot; new schools render 0/0 progress sanely; no UI copy
   promises a checklist.
5. Migration 0008 + rollback pair, yoyo `depends` header.
6. Routine backend tests + frontend typecheck/tests green.
7. Tool contracts written after this land encode the final enums/fields and
   the three recorded tool-contract decisions.
