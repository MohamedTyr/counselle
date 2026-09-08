# Plan — Slim the school detail page

## Problem

The "Your application" tab of the school detail page carries a **requirements /
"Common items to verify"** section (Application fee, Testing, CSS Profile, FAFSA,
Teacher/Counselor recommendations, Transcript, Interview) with per-item
`SCHOOL REQUIREMENT` / `YOUR TRACKING` rows and quick-add-task affordances. That
is Common App's job, not Counselle's — we are the AI thinking partner beside the
application, not the submission system. It also carries two metadata fields the
student never needs to edit: **Platform** and **Cycle year**.

**Goal.** The tab shows exactly: Status, List, Round, Test plan, Intended major,
Application deadline, Essays, Notes. Nothing else.

**Non-goals.**
- Essays are untouched. Not one line in `SchoolEssaysSection.tsx`.
- `cycle_year` **stays in the data model** (see Risk R1). Only the editable field
  in the metadata bar goes.
- Task progress rollups, the schools table, `AddSchoolDialog`'s cycle picker, and
  the tasks feature are all out of scope.

---

## Key findings that shape the plan

| # | Finding | Consequence |
|---|---|---|
| F1 | `tasks.requirement_kind` is a **free-text regex-checked column, not an FK** to `school_requirements`. | Dropping the requirements table cannot orphan a task. |
| F2 | The **only** `INSERT INTO counselle.school_requirements` in the repo is raw SQL inside `tests/app/test_school_workspace_live.py`. There is no production write path. | The table is empty in every real environment. Removal is data-loss-free. |
| F3 | `get_school` (`app/workspace/agent_tools_schools.py:291-344`) fetches `ApplicationDetail` and **discards `detail.reference`**. | No agent tool sees requirements. Zero agent blast radius. |
| F4 | There is **no `ObjectType` member** for requirements (`app/workspace/models.py:51-60`). | No workspace change events, no actor-attributed change rows to migrate. |
| F5 | `SchoolReference` also carries `test_policy`, a **separate CDS feature** fused into the same envelope, gated by `_vintage_matches_cycle()` on `cycle_year`. | Slim `SchoolReference`; never delete it. `cycle_year` must survive. |
| F6 | "Refresh reference" is **not an endpoint** — it's a plain refetch of `GET /applications/{id}` (`SchoolWorkspace.tsx:101-104`). | Keep it; it still refreshes `test_policy`. |
| F7 | `application.progress` (`task_completed`/`task_total`) is computed from **tasks**, not requirements (`service_applications.py:547`). | The "Your application" tab badge and the schools-table progress column are unaffected. |
| F8 | `MIN_CYCLE_YEAR`/`MAX_CYCLE_YEAR` are defined **twice** — `SchoolWorkspace.tsx:53-54` and `AddSchoolDialog.tsx:47-48`. | Delete only the `SchoolWorkspace` copy. |
| F9 | `humanize` and `cycleLabel` in `school-workspace-format.ts` are shared with the surviving `FieldSelect`s and with `SchoolEssaysSection.tsx:331`. | Keep both. |

---

## Risk register

**R1 — `cycle_year` removal would be a data-model change, not a UI change. (HIGH, mitigated by scoping out)**
`cycle_year` is: a required no-default field on `SchoolDraft` (`agent_tools_schools_mutations.py:77`) and on `ApplicationCreate`; the discriminator in the two partial unique indexes `applications_user_school_cycle_active_idx` / `..._legacy_active_idx` (migration `0011`, lines 17-23) that enforce one active application per school per cycle; the input to `_active_cycles()` / `search_schools()`; and the gate on `test_policy`'s vintage check. Collapsing it would risk unique-violation consolidation of real multi-cycle rows.
**Mitigation:** this plan removes only the metadata-bar `<Input>`. The column, the API contract, and every backend consumer are untouched.

**R2 — Deleting `school_requirements` while a live DB is mid-cutover. (MEDIUM)**
Per `CLAUDE.md`, owner acceptance on the CDS cutover is pending and the seed file has already drifted from the live DB. Adding a second drift is bad.
**Mitigation:** Phase 3 (the migration) is **written but not applied**, exactly like the `cds_documents` index precedent. Phases 1–2 are complete and shippable without it — an empty, unread table is inert. Record the un-applied migration in `TODOS.md`.

**R3 — Dead API surface if backend is left untouched. (LOW)**
Removing only the UI leaves `SchoolRequirement`, `_requirement()`, `_provenance()` and the requirements query as code nothing calls.
**Mitigation:** Phase 2 removes them. Ordering (UI first, then backend) means the app is never broken between phases.

**R4 — Over-deletion of shared helpers. (LOW)**
`FieldSelect`, `humanize`, `cycleLabel`, `ChecklistMap`, `application.progress` all look requirement-adjacent but are shared.
**Mitigation:** the explicit keep-list in Phase 1 step 3/4 and F7/F9 above.

---

## Open decision — the `2025-26` header line

`SchoolWorkspace.tsx:98-100` renders a **read-only** `cycleLabel(application.cycle_year)`
string ("2025-26") above the metadata bar, next to "Refresh reference". It is not
one of the eight surfaces you listed, but it is also not the *field* you pointed
at — it's a passive label.

**Recommendation: keep it.** It's the only place the student can tell which
admissions cycle this application row belongs to, and a student with a gap-year
or reapplication row genuinely needs that. It is a one-line change to drop if you
disagree — say the word and I'll delete lines 98-100 along with the rest.

---

## Phase 1 — Frontend (the whole user-visible change)

Ship this and the screen is done.

1. **Delete** `frontend/src/features/schools/SchoolRequirementsSection.tsx` (whole
   256-line file).

2. **`frontend/src/features/schools/SchoolWorkspace.tsx`** — remove:
   - the `RequirementsSection` import (line 25), the "Requirements" section-nav
     button (311-314), and the render call (320-323);
   - the Platform block: `platforms` / `PlatformSelection` / `platformLabels` /
     `platformSelectionLabels` (44-52, 55-65), `platformDraft` + `platformOtherDraft`
     state (82-85), the Platform `FieldSelect` (131-147), and the
     "Other application platform" conditional input (190-230);
   - the Cycle year block: `MIN_CYCLE_YEAR`/`MAX_CYCLE_YEAR` (53-54), `cycleDraft`
     state (78-80), and the Cycle year `<Input>` (148-188).
   - **Keep:** the `cycleLabel` header line (98-100, per the open decision above),
     the "Refresh reference" retry (101-104), the test-policy blurb, and the
     Status / List / Round / Test plan `FieldSelect`s.
   - Verify after: no orphaned `useState`, no now-unused import, the section-nav
     array has no dangling separator, and the metadata grid still lays out at the
     narrower column count (it was sized for 6 fields, now 4 — check `md:grid-cols-*`
     and the responsive breakpoints rather than leaving a ragged gap).

3. **`frontend/src/features/schools/school-workspace-fields.tsx`** — delete
   `Provenance` (24-42) and `QuickAddTask` (78-124). **Keep `FieldSelect`** (44-76).

4. **`frontend/src/features/schools/school-workspace-format.ts`** — delete
   `applicabilityLabels` (16-22), `CommonRequirement` + `commonRequirements` (24-65),
   `referenceDetail` + `formatDetailValue` (79-131), `audienceDescription` (133-159).
   **Keep `humanize` (67-71) and `cycleLabel` (73-77)** — both are shared (F9).

5. **`frontend/src/domain/school.ts`** — drop the now-dead `School.platform` (19)
   and `School.checklist` (20) fields and their assignments in
   `schoolFromApplication` (52-54). Confirmed read nowhere. **Keep `School.cycleYear`**
   — read by `school-cells.tsx:117-119`.

6. **`frontend/src/features/schools/SchoolWorkspace.test.tsx`** — delete the
   `requirement()` fixture helper (22-37) and three tests: "renders common items to
   verify…" (55-84), "suppresses tracking actions for published not-required items"
   (117-138), "reloads the application after changing cycle year" (162-177).
   **Keep** the query-failure test (86-115) and the archive test (140-160).

7. **Do not touch** `api/workspace/types.ts`, `hooks/applications.ts`,
   `hook-utils.ts`, or the `render-app.tsx` fixtures. They mirror the backend
   contract, which is unchanged until Phase 2 — and the fixtures must keep
   satisfying `ApplicationView` / `SchoolReference`.

**Gate:** `cd frontend && npm run build && npm test`. `npm run build` (not just
`typecheck`) is required — `tsc -b` is what catches identifiers left undefined by
a deletion; `typecheck` passes them through.

**Visual gate:** load a real school detail page in a browser (backend on :8000,
Vite on :5173) and confirm the metadata bar reads Status / List / Round / Test
plan on row one and Intended major / Application deadline on row two, with no
collapsed or ragged grid cell, and Essays + Notes unchanged below.

---

## Phase 2 — Backend cleanup (no schema change)

Only after Phase 1 is green. Nothing here is user-visible; it removes code that
Phase 1 made unreachable.

1. **`app/workspace/service_reference.py`** — remove the `school_requirements`
   query from `get_school_reference()` (20-55) and delete `_provenance()` (58-64)
   and `_requirement()` (67-78). **Keep the function, keep `_compatible_test_policy()`
   (81-122) and `_vintage_matches_cycle()` (125-133)** — that's the separate CDS
   test-policy feature (F5), and it still drives the blurb the screen keeps.

2. **`app/workspace/models.py`** — delete `SchoolRequirement` (893-916) and the
   five detail models `FeeRequirementDetail` / `RecommendationRequirementDetail` /
   `FormRequirementDetail` / `TestingRequirementDetail` / `AidRequirementDetail`
   (857-890). Drop the `requirements` field from `SchoolReference` (919-924),
   leaving `status`, `cycle_year`, `populated`, `test_policy`.

3. **`tasks.requirement_kind`** — leave the field in place this round.
   Its Python surface (`Task` 273, `TaskCreate` 295, `TaskPatch` 311, `TaskDraft`
   in `agent_tools_shared.py:122`, and the plumbing in `service_tasks.py`) is
   harmless free text with no FK, and it is reachable by the agent's batch
   task-create tool independently of the deleted UI. Removing it is a separate,
   optional cleanup — call it out in `TODOS.md` rather than bundling it here.

4. **Tests** — in `tests/app/test_school_workspace_live.py` delete the requirements
   CRUD/immutability/provenance block (83-174, including the raw-SQL inserts) and
   keep cycle_year uniqueness (177-194), platform validation (197-232), and
   checklist patch (235-262) — those cover backend behavior that still exists.
   In `tests/app/test_school_workspace_models.py` delete the `SchoolRequirement`
   tests (38-78); keep checklist (24-29), `requirement_kind` pattern (34-36),
   platform (88).

5. **Note on `Application.checklist` and `applications.platform`** — both stay.
   `checklist` is the student's own tracking map on a separate column with its own
   validated patch path; `platform` is still a valid API field with server-side
   validation (`_validate_platform_patch`, 584-596). We stopped *rendering* them;
   removing the columns is a data decision, not a UI one, and neither is costing
   us anything. If you want them gone too, that's a follow-up with its own migration.

**Gate:** `uv run pytest -m "not live_llm and not live_search and not live_db"`
(do **not** source `.env` for this run — it fabricates two failures), then
`uv run ruff check . && uv run mypy .`.

---

## Phase 3 — Migration (written, deliberately NOT applied)

`migrations/0019_drop_school_requirements.sql` + `.rollback.sql`, `-- depends: 0018_drop_essay_prompt_drafts`.

```
DROP TRIGGER  ... ON counselle.school_requirements;
DROP FUNCTION counselle.protect_published_requirement_facts();
DROP TABLE    counselle.school_requirements;   -- indexes go with it
```

The rollback is a copy of lines 100-133 + 195-224 of
`migrations/0011_school_workspace.sql`, which already contains the exact symmetric
teardown to model this on. `0011`'s own comment records the same
surgically-drop-one-sub-feature pattern `0017` used for the essay siblings.

**Do not run it against the live DB.** Per R2, the live `cds_library`/`counselle`
databases are already drifted from source control pending owner acceptance, and
adding a second un-signed-off schema change is the owner's call, not ours. The
table is empty and unread after Phase 2, so leaving it costs nothing.

**Record in `TODOS.md`:** migration `0019` written but unapplied; and the optional
follow-up removal of `tasks.requirement_kind`, `applications.checklist`,
`applications.platform`, `applications.platform_other`.

---

## Execution order

1. Phase 1 → build + tests + browser check → commit
   (`refactor(schools): remove requirements section and platform/cycle-year fields`).
2. Phase 2 → pytest + ruff + mypy → commit (`refactor(workspace): drop dead school-requirements backend`).
3. Phase 3 → write migration + `TODOS.md` entries → commit (`chore(db): add unapplied migration dropping school_requirements`).

Each commit leaves the app fully working. Phase 1 alone satisfies the request.
