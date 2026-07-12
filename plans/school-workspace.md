# School Workspace - Implementation Plan

Status: Ready for final review
Date: 2026-07-12
Branch: feat/mvp3-frontend-prototype

## 0. Outcome

Promote each saved school from a sheet to a full page at `/app/schools/:applicationId`.
The page connects the existing Schools, Tasks, and Essays workspace into one coherent unit.
It is dark-only using the app's existing global semantic tokens and contains no embedded chat.

The data model ships with both layers on day one:

- **School reference layer:** shared, Counselle-owned catalog facts keyed by school and
  admissions cycle. The tables, read path, provenance rules, and UI exist now; rows can be
  filled later without schema or frontend changes.
- **Student tracking layer:** user-scoped application fields, checklist state, tasks, and essay
  documents. It references catalog records without copying catalog truth into user state.

Counselle remains beside Common App and school portals. It never claims that an off-platform
submission was received. Unknown is a first-class state.

## 1. Locked product rules

1. No new top-level navigation section. The page is a Schools drill-down.
2. No automatically generated tasks or placeholder essays. Remove the current add-school
   seeding path (`seed_application_workspace`, its template dependency, seeded IDs, and seeded
   response contract). Rows may offer explicit quick-add actions only.
3. Activities stay global and unchanged.
4. No on-page Counselle drawer. The prompt empty state links to plain `/app/ai` and provides a
   copyable suggested request; it does not claim the agent is pre-scoped.
5. Dark mode uses the workspace's existing global semantic theme. Do not add a page-local
   `.dark` class because portaled controls would escape it. A future real light theme must theme
   the workspace shell and portal container together if this route remains dark.
6. Never fabricate school requirements, applicability, prices, receipt status, or provenance.

## 2. Cycle is part of application identity

- Add nullable `applications.cycle_year integer` (the fall enrollment year, e.g. `2027`).
- Legacy rows remain null unless their cycle is unambiguous; never silently assign a cycle. When
  null, the page shows `Confirm application cycle` and does not load or render catalog facts.
  New applications require an explicit cycle.
- Add one canonical typed Settings value, `current_admissions_cycle_year`, used only to visibly
  preselect the new-application control. Migrations use an explicit historical literal only for
  rows whose cycle is provable; they never read runtime Settings or install a permanent DB default.
- Reference lookups always use `(school_unitid, cycle_year)` from the application row.
- Active application uniqueness becomes `(user_id, school_unitid, cycle_year)` so a user can
  retain separate applications across cycles without mixing tracking data.
- Pipeline test-policy data is shown only when its envelope vintage is compatible with the
  application cycle; otherwise it is labeled stale/unavailable and the portal is authoritative.
- Empty copy names the cycle: `No catalog data for the 2026-27 application cycle.`

## 3. Reference schema: shared, publishable, extensible

One migration (`0011_school_workspace.sql`, renumber if another migration lands first) creates
the reference tables and tracking columns. The app-owned pool reads `counselle.*`; the pipeline
`Catalog` is used only for pipeline test-policy lookup.

### 3.1 Catalog lifecycle and provenance

Both reference tables have:

- `state text NOT NULL CHECK (state IN ('draft','published','retracted'))`
- `source text`, `source_url text`, `verified_at date`, `published_at timestamptz`,
  `retired_at timestamptz`, timestamps
- a database constraint requiring nonblank `source`, HTTPS `source_url`, `verified_at`, and
  `published_at` when `state='published'`
- services return only published, non-retired rows to students
- corrections retract/retire rows; linked prompt rows are preserved

Draft rows are editorial data and never become student-visible facts. Empty tables mean no facts.

### 3.2 Prompt groups and prompts

`school_prompt_groups` represents `answer N of M` without encoding policy in display text:

- `id uuid PK`, `school_unitid integer`, `cycle_year integer`, `label text`,
  `choice_min integer NOT NULL CHECK (choice_min > 0)`, lifecycle/provenance columns
- unique active identity `(school_unitid, cycle_year, label)`

`school_essay_prompts`:

- `id uuid PK`, `school_unitid integer`, `cycle_year integer`, `ordinal integer > 0`
- `prompt text NOT NULL CHECK (btrim(prompt) <> '')`, `word_limit integer > 0 nullable`
- `applicability text NOT NULL DEFAULT 'unknown' CHECK (... IN
  ('required','optional','not_required','conditional','unknown'))`
- `audience jsonb NOT NULL DEFAULT '{}'` for structured conditions such as college, program,
  major, residency, or applicant type; conditional prompts render `Verify whether this applies`
  unless the condition can be resolved from student data
- optional `group_id`; `(group_id, school_unitid, cycle_year)` has a composite foreign key to a
  matching unique key on the group table, so imports cannot cross-link schools or cycles
- lifecycle/provenance columns and lookup indexes on `(school_unitid, cycle_year)`
- unique active ordinal per school/cycle

### 3.3 Non-essay requirements

`school_requirements`:

- `id uuid PK`, `school_unitid integer`, `cycle_year integer`
- `kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,63}$')`
- `label text NOT NULL`, `applicability text NOT NULL DEFAULT 'unknown'` using the full prompt
  vocabulary, including `not_required`
- `audience jsonb NOT NULL DEFAULT '{}'`, `detail jsonb NOT NULL DEFAULT '{}'`
- lifecycle/provenance columns
- unique active `(school_unitid, cycle_year, kind)` and lookup index

Reference `kind` is deliberately an open validated string. Known kinds use typed Pydantic detail
models (fee, recommendations, form, testing, aid); unknown kinds retain validated base fields and
render through a generic reference-row fallback. Filling a new kind is data entry, not a deploy.
Known detail models reject negative amounts/counts and invalid shapes.

## 4. Student tracking schema

Add:

- `applications.checklist jsonb NOT NULL DEFAULT '{}'`
- `applications.platform text` constrained to
  `common_app|coalition|school_portal|direct|other`, plus nullable
  `applications.platform_other` required only for `other`
- `tasks.requirement_kind text` using the same open slug validation as catalog kinds
- `essays.prompt_ref uuid NULL REFERENCES school_essay_prompts(id) ON DELETE RESTRICT`

Checklist keys remain a closed trackable subset (`fee`, `css_profile`, `fafsa`, `testing`).
Checklist status is validated per key. Missing means `Not tracked`, never `Not started`.
Checklist patches use one atomic SQL jsonb merge with explicit JSON-null deletion semantics; no
fetch/merge/write race.

`prompt_ref` rules are enforced inside the essay create/patch transaction:

- it requires `application_id`
- prompt school and cycle must equal the application's school and cycle
- changing `application_id` revalidates or rejects the link
- one active essay per `(application_id, prompt_ref)` via a partial unique index
- duplicate-essay clears `prompt_ref`
- the UI supports `Use existing essay` and `Unlink` so essays created before catalog population
  can attach later without duplicate documents

Rollback drops `essays.prompt_ref` and its index before prompt tables, then the remaining columns
and reference tables in dependency order.

## 5. Backend contract

### 5.1 Types

Extend workspace models with cycle, platform, checklist, task kind, and prompt reference fields.
Add DTOs for prompt groups, prompts, requirements, provenance, and `SchoolReference`.
`ApplicationDetail` becomes `{ application, tasks, essays, reference }`.

### 5.2 Read path

Add `get_school_reference(app_pool, catalog, unitid, cycle_year)`:

- app pool queries the published Counselle reference tables
- catalog resolves preference-ordered test policy through `preferred_field('test_policy')`
- output distinguishes populated versus loaded-empty; query failures propagate as reference
  errors and must never be converted to empty catalog data

`get_application_detail` loads the application first, then resolves reference data for that exact
school/cycle. Application detail revalidates on window focus and exposes manual retry.

### 5.3 Writes and events

All student mutations continue through existing application/task/essay services, actor-attributed
change rows, and SSE invalidation. Reference data is not editable from this UI and emits no user
workspace events. `create_essay`/`update_essay` own transactional prompt-link validation.

Remove add-school workspace seeding and its unused configuration/response plumbing. Adding a
school creates only the application row.

## 6. Page and interaction design

### 6.1 Shell and header

- Route `/app/schools/:applicationId`; thin page wrapper mirrors the essay editor page.
- Retire `SchoolDetailSheet`; `/app/schools?school=<id>` redirects to the canonical route.
- Schools rows and add-school success navigate to the page.
- Header shows logo/name plus editable status, list type, round, major, deadline, platform, and
  cycle. Every chip maps to stored data. Portal links out.
- Use the existing workspace max-width/rhythm and semantic tokens. No decorative card dashboard.

### 6.2 Essays

Two visibly distinct groups:

- **School prompts:** published catalog slots for the selected cycle, with provenance,
  applicability, group choice rule, word limit, and linked essay state. Actions: Start writing,
  Open, Use existing essay, Unlink.
- **Added by you:** application essays with no prompt reference.

Word progress renders a meter only when a word limit exists; otherwise count only. Loaded-empty
copy names the school and cycle and offers Add an essay plus the plain `/app/ai` handoff. Reference
loading failure renders an error/retry state, never absence copy.

### 6.3 Requirements

The view-model is data-driven: known common rows plus all catalog rows, including unknown kinds.
It never hardcodes school facts. Each row has two explicit facets:

- `School requirement`: Required / Optional / Not required / Conditional / Unknown, with source
  and verification date only for published catalog facts
- `Your tracking`: Not tracked / the student-selected state, only for trackable kinds

Rows absent from the catalog appear under **Common items to verify**, not under claims about what
the school requires. Catalog-only unknown kinds render generically. `not_required` rows suppress
tracking controls; conditional rows show the condition and verification prompt. Rows expand to
tasks filtered by `requirement_kind` and an explicit inline Add task action.

### 6.4 Notes and navigation coherence

- Existing application notes remain collapsible.
- Task/essay cards link their school context to the school page. Nested links stop propagation
  and preserve keyboard activation so they do not trigger the parent card.
- Essay editor school context becomes a breadcrumb link back to the school page.
- School page uses the registry breadcrumb only if installed and used; otherwise do not add it.

## 7. Components and visual quality

Search COSS first, then shadcn, before installing. Reuse vendored components wherever possible:
Button, Badge, Select, Empty, Skeleton, Separator, Tooltip, Collapsible, input primitives. Use
registry Accordion and Progress/Meter only when they fit the existing Radix Nova stack. Use real
accessible primitives, semantic tokens, and existing component variants; no custom dropdowns,
raw status pills, nested cards, wide ghost shadows, decorative motion, or fabricated metrics.

Responsive behavior: single readable column on desktop, full-width mobile, no horizontal
overflow. Motion only communicates state and respects reduced motion. Body text meets WCAG AA;
status never relies on color alone.

## 8. Honesty-critical tests

Tests earn their place here because these failures can lie to a student or corrupt links:

- exact cycle selection and active application uniqueness
- draft/retracted/unprovenanced rows never publish
- loaded-empty versus reference-query error
- stale/mismatched test-policy vintage handling
- cross-school/cross-cycle prompt link rejection
- duplicate slot link rejection, attach/unlink, and duplication clearing `prompt_ref`
- atomic concurrent checklist patches and delete semantics
- add-school creates no tasks or essays

## 9. Implementation sequence

1. Migration and backend models/reference service, including removal of seeding.
2. Transactional tracking writes and honesty-critical tests.
3. Canonical school route, sheet redirect, header, catalog states, essays, requirements, notes.
4. Schools/Tasks/Essays navigation coherence and registry component integration.
5. Code review, security/data-integrity review, product/UI review; address all critical/high
   findings before graduating this plan to `specs/`.

## 10. Deliberate non-goals

- Filling the catalog in this build; only its complete storage/read/rendering surface ships.
- Catalog editing UI or agent catalog mutation tools.
- Cross-cycle reconciliation/diff UX.
- Portal receipt tracking or submission replicas.
- Agent one-tap prompt acceptance.
- Light theme and per-school activities.
