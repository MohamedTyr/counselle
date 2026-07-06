# Implementation Plan: MVP3 Workspace — Fully Wired, Agent-Ready

Status: Shipped — graduated after Phase 9 close-out
Branch: feat/mvp3-frontend-prototype
Design doc: `specs/mvp3/workspace-design.md` (APPROVED)
Date: 2026-07-06

## Goal

Wire the four MVP3 pages (Schools, Tasks, Essays, Activities) to a real backend: Counselle-owned
Postgres tables, one `app/workspace/` service layer, full CRUD with per-user scoping, transactional
add-school seeding, derived roll-ups, actor attribution on every mutation, and a per-user SSE
change-events channel — so the future agent gets workspace tools by wrapping the same service
functions the HTTP routes wrap, with zero rework.

## Current State (verified 2026-07-06)

Backend: auth (fastapi-users cookie-JWT, `counselle.users`, user id = `uuid`), sessions/chat,
SSE turn streaming exist. **Zero workspace endpoints.** No ORM anywhere — raw parameterized
asyncpg; migrations are plain SQL via yoyo (`migrations/0001`–`0006` + `.rollback.sql` siblings).
Two pools: `app_pool` (RW, `counselle.*`, on `Runtime`) and the RO catalog pool (pipeline
`public.*`). School name search/resolution logic already exists in `counselle_db/service.py`
(`_SEARCH_SQL`, abbreviation expansion, pg_trgm fuzzy fallback, `_campus_rank`) but has no HTTP
typeahead route. `counselle_db.service_find.find_schools` is a filter/rank tool, **not** the
right primitive for add-school typeahead. Pipeline DB has **no** logo column, **no** alias table,
and deadline coverage of 7/2,746 — seeding/deadlines cannot come from the DB.

Frontend: all four pages render fixtures into `useState`. The only TanStack Query usage is
`src/app/auth.ts` (`useMe` et al.) — the reference pattern. Shared transport errors exist
(`src/api/http/errors.ts`: `TransportError`, `errorFromResponse`). No SSE client, no dialog /
command / alert-dialog / toast primitives. "Add school" button is dead
(`features/schools/SchoolsRoute.tsx:136`). Tasks have **no delete control**. The essay editor's
Save button is cosmetic — Tiptap content is discarded on unmount. Activities is the complete
reference implementation: full CRUD, drag reorder, delete-with-undo (`UndoToast`, 5s window),
URL-as-state deep links.

## Architecture Principles (binding)

1. **Service layer first (ADR 0017).** All workspace logic lives under the existing `app/` layer
   in `app/workspace/` as plain `async def` functions taking explicit `pool(s)`, `event_bus`,
   `user_id: UUID`, `actor: Actor` parameters — never request-scoped state. HTTP routes are thin
   wrappers; future agent tools are direct in-process PydanticAI tools over the same service
   functions via `Runtime`/`AppDeps`, matching ADR 0017's carve-out for our own code.
2. **Ownership enforced inside the service**, not only in route dependencies: every query is
   scoped `WHERE user_id = $n`; missing/foreign rows raise `WorkspaceNotFoundError` → routes map
   to `EnvelopeError(404)` (never 403, mirroring `owned_session`). This keeps the service safe
   for non-HTTP callers (the agent).
3. **No ORM, no Alembic.** asyncpg + parameterized SQL only; schema changes via
   `migrations/0007_workspace.sql` (+ rollback), `counselle.*` only.
4. **One change log = actor audit + SSE replay.** Every mutation inserts a
   `counselle.workspace_changes` row in the same transaction, then publishes to an in-process
   per-user event bus after commit. The bus lives on `Runtime.deps.workspace_events` and service
   functions publish because the bus is an explicit argument; direct agent calls and HTTP calls
   therefore behave identically. SSE reconnect replays from the table via `Last-Event-ID`.
   The bus is a **third named in-process state owner** — documented in a new ADR 0027 (amends
   ADR 0023; scale-out path: Postgres LISTEN/NOTIFY).
5. **Soft archive everywhere.** `DELETE` sets `archived_at` (undo = `POST …/restore`); list
   queries filter `archived_at IS NULL`. Archiving an Application cascades: linked tasks/essays
   get `archived_at` + `archived_via_application = <app id>` in the same transaction; restore
   un-archives exactly that set. Retention = keep-everything (repo posture); purge is a later knob.
6. **Never lie to a student.** No deadline pre-fill from the DB. Seeded checklist/essay slots are
   labeled as editable starting points, never presented as school-verified requirements. The fake
   "Plan with agent" task creation and the fake essay "version" chip are removed (see Decisions).
7. **Enums mirror the frontend unions verbatim** (single vocabulary, validated by Pydantic
   `Literal`s; DB columns are `text`): ApplicationStatus (Considering/Applying/Submitted/Accepted/
   Rejected/Waitlisted/Withdrawn), ListType (Reach/Target/Safety), Round (EA/ED/RD/Rolling/
   Priority/Scholarship deadline), TaskStatus (todo/doing/waiting/done), TaskCategory
   (essay/lor/aid/research/other/form), TaskPriority (low/med/high), Assignee/Actor
   (student/counselle), EssayStatus (Not started/Drafting/Needs review/Ready/Submitted),
   EssayType (Personal statement/Supplement/Scholarship/Optional).
8. Files < 800 lines, functions < 50; parameterized SQL only; every update/archive/restore sets
   `updated_at = now()` in SQL; new tunables go on `Settings`
   (`COUNSELLE_*`) or `config/assets/`; registry-first for all new frontend primitives.

## Phase 1 — Backend foundation (schema, models, change log, event bus)

### 1.1 Migration `migrations/0007_workspace.sql` (+ `.rollback.sql`), `-- depends: 0006_indexes`

Tables (all `counselle.*`; `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`,
`user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE`,
`created_at/updated_at timestamptz NOT NULL DEFAULT now()`, `archived_at timestamptz` unless noted):

- **`applications`** — `school_unitid integer NOT NULL` (pipeline reference, no cross-schema FK),
  `status text NOT NULL DEFAULT 'Considering'`, `list_type text NOT NULL`, `round text NOT NULL`,
  `deadline date`. Partial unique index `(user_id, school_unitid) WHERE archived_at IS NULL`
  (re-adding an archived school creates a fresh row).
- **`essays`** — `application_id uuid REFERENCES counselle.applications(id) ON DELETE CASCADE`
  (NULL = personal statement / unlinked), `title text NOT NULL`,
  `essay_type text NOT NULL DEFAULT 'Supplement'`, `status text NOT NULL DEFAULT 'Not started'`,
  `prompt text`, `content jsonb NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}'`
  (valid empty Tiptap JSON document),
  `word_count integer NOT NULL DEFAULT 0`, `word_limit integer`,
  `comments jsonb NOT NULL DEFAULT '[]'`, `suggestions jsonb NOT NULL DEFAULT '[]'`
  (agent feedback channel, rendered as counts), `archived_via_application uuid REFERENCES
  counselle.applications(id) ON DELETE SET NULL`.
- **`tasks`** — `application_id uuid REFERENCES … ON DELETE CASCADE`,
  `essay_id uuid REFERENCES counselle.essays(id) ON DELETE SET NULL`, `title text NOT NULL`,
  `notes text`, `status text NOT NULL DEFAULT 'todo'`, `category text NOT NULL DEFAULT 'other'`,
  `priority text NOT NULL DEFAULT 'med'`, `assignee text NOT NULL DEFAULT 'student'`,
  `needs_input boolean NOT NULL DEFAULT false`, `due_at/planned_for/reminder_at/completed_at
  timestamptz`, `archived_via_application uuid REFERENCES counselle.applications(id) ON DELETE
  SET NULL`.
- **`activities`** — `sort_order integer NOT NULL`, `activity_type/position_label/organization/
  description text NOT NULL DEFAULT ''`, `grades text[] NOT NULL DEFAULT '{}'`,
  `timing text[] NOT NULL DEFAULT '{}'`, `hours_per_week numeric`, `weeks_per_year numeric`,
  `continue_in_college boolean`, `story text` (Counselle-only, never exported).
- **`honors`** — `sort_order integer NOT NULL`, `title text NOT NULL DEFAULT ''`,
  `grades text[] NOT NULL DEFAULT '{}'`, `levels text[] NOT NULL DEFAULT '{}'`.
- **`workspace_changes`** — `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`,
  `user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE`,
  `actor text NOT NULL`, `object_type text NOT NULL`
  (application|task|essay|activity|honor), `object_id uuid NOT NULL`,
  `op text NOT NULL` (created|updated|archived|restored), `application_id uuid`,
  `created_at timestamptz NOT NULL DEFAULT now()`. No `archived_at`.

Indexes (inline in 0007): `(user_id) WHERE archived_at IS NULL` on the five object tables;
`tasks(application_id)`, `tasks(essay_id)`, `essays(application_id)`;
`workspace_changes(user_id, id)`.

Column-name note: the DB column for Activity's `position` is `position_label` (`position` is a
SQL keyword; the API payload still says `position`).

### 1.2 `app/workspace/models.py`

Pydantic models + `Literal` enums per Principle 7: `Application`, `ApplicationView` (adds
`school_name`, `school_city`, `school_state`, `website_url: str | None`,
`progress: {completed,total}`, `essays: {completed,total}`), `ApplicationCreate`
(`unitid, list_type, round, deadline?`), `ApplicationPatch`, `Task`/`TaskCreate`/`TaskPatch`
(now with `application_id?`, `essay_id?`), `Essay`/`EssaySummary` (list payload: no `content`,
adds `preview: str` derived server-side from content plain text, `comment_count`,
`suggestion_count`)/`EssayCreate`/`EssayPatch`, `Activity`/`Honor` + create/patch,
`ChangeEvent` (`{id: int, v: 1, type: "<object_type>.<op>", data: {object_type, object_id, op,
actor, application_id?}}` — thin events; clients refetch), `Actor =
Literal["student", "counselle"]`, `WorkspaceNotFoundError`, `WorkspaceValidationError`.

### 1.3 `app/workspace/changes.py` — change log + event bus

- `async def record_change(conn, *, user_id, actor, object_type, object_id, op,
  application_id=None) -> int` — INSERT into `workspace_changes` inside the caller's transaction,
  returns `id`.
- `class WorkspaceEventBus` — `dict[UUID, set[asyncio.Queue[ChangeEvent]]]`; `subscribe(user_id)`
  (bounded queue, drop-oldest on overflow — SSE replay covers gaps), `publish(user_id, event)`,
  `unsubscribe`. Created in `app.deps.build_runtime`, stored on `Runtime.deps.workspace_events`
  (asyncio-single-loop, no locks needed beyond standard care). Queue size is a Settings knob
  `workspace_event_queue_size: int = 256`.
- `async def replay_changes(pool, *, user_id, after_id: int, limit: int) -> list[ChangeEvent]` —
  reconnect catch-up query.
- Convention: every service mutation does `transaction → write rows → record_change(s) → commit →
  event_bus.publish` (publish only after commit so events never describe rolled-back writes). The
  mutation returns the user payload after publishing; tests can subscribe to the passed bus to
  assert live events without involving HTTP.

### 1.4 ADR `docs/adr/0027-workspace-service-and-change-events.md`

Documents: the `app/workspace/` service layer as the single mutation path (HTTP now, direct
PydanticAI tools later), the change-log table as actor audit + replay source, the event bus as the
third named in-process state owner on `Runtime.deps` (amends ADR 0023's "exactly two" clause),
scale-out path (LISTEN/NOTIFY), and soft-archive semantics.

**Gate:** `uv run yoyo apply` + rollback + re-apply clean against a dev DB; models importable;
unit tests for `record_change`/bus/replay green. Runtime boot pre-loads `workspace_seeding.yaml`
with the other YAML assets and `build_runtime()` creates `Runtime.deps.workspace_events`.

## Phase 2 — Workspace services + seeding + school search

Service files (each mutation takes explicit pool(s), `event_bus`, `user_id`, `actor`; reads omit
`actor`; every mutation follows the `record_change` convention; all list/get scoped by `user_id`):

### 2.1 `app/workspace/service_applications.py`

- `search_schools(catalog, app_pool, *, user_id, query, limit=8)` — first extract/promote a public
  helper in `counselle_db/service.py` (for example `search_school_names`) that reuses the existing
  name-path internals: ILIKE search, abbreviation expansion, pg_trgm fuzzy fallback, and
  `_campus_rank` main-campus ordering. Do **not** call `service_find.find_schools` here; it is for
  filter/rank criteria and requires at least one filter. The workspace wrapper annotates each hit
  with `on_list: bool` (active applications join) and `website_url` (best-effort from the pipeline
  data; if no reliable source exists, return `None` — frontend falls back to a letter avatar).
- `list_applications(app_pool, catalog, *, user_id)` — one query over `counselle.*` with roll-up
  LEFT JOIN counts (`tasks`: `status='done'`/total; `essays`: `status IN ('Ready','Submitted')`/
  total; both excluding archived), then a second query on the RO pool
  (`WHERE unitid = ANY($1)`) to merge school identity in Python (no cross-role SQL join).
- `add_application(app_pool, catalog, event_bus, *, user_id, actor, data, template)` — **one
  transaction**: validate unitid exists in the pipeline catalog (RO read before the transaction);
  INSERT application; seed tasks + essay slots from the template (`app/workspace/seeding.py`); one
  `record_change` per created row; commit; publish all events. Returns the full
  `ApplicationView` + created ids. Duplicate active school → `WorkspaceValidationError` (→ 409).
- `update_application`, `archive_application` (cascade per Principle 5, one `record_change` per
  affected row), `restore_application`, `get_application_detail` (application + linked
  tasks/essays for the side panel).

### 2.2 `app/workspace/seeding.py` + `config/assets/workspace_seeding.yaml`

Template asset (editorial content → `config/assets/`, ADR 0018), loaded via `load_yaml_asset`.
V1 contents (**Decision D1**):

```yaml
tasks:
  - {title: "Complete the Common App sections for this school", category: form, priority: high}
  - {title: "Request recommendation letters", category: lor, priority: high}
  - {title: "Request transcript from your school", category: form, priority: med}
  - {title: "Send test scores (if you're submitting them)", category: form, priority: med}
  - {title: "Research program + confirm application requirements", category: research, priority: med}
  - {title: "Final review before submitting", category: other, priority: high, days_before_deadline: 3}
essays:
  - {title: "Supplemental essay", essay_type: Supplement, status: "Not started"}
```

Rules: `days_before_deadline` produces a `due_at` **only if** the user entered a deadline —
otherwise tasks have no due date (no guessed dates, ever). Exactly one Supplement essay slot is
seeded per school — an editable starting point (users duplicate/delete freely), never a claim
about the school's real requirements. No deadline pre-fill of any kind in v1.

### 2.3 `app/workspace/service_tasks.py`

`list_tasks`, `create_task`, `update_task` (partial patch; setting `status='done'` stamps
`completed_at`, leaving it clears it), `archive_task`/`restore_task`,
`bulk_update_status(ids, status)` and `bulk_archive(ids)` (multi-select drag/delete; one
transaction, per-row `record_change`, skip ids not owned by the user). Validates
`application_id`/`essay_id` ownership on link; accepts explicit `null` patches to unlink a task
from an application or essay.

### 2.4 `app/workspace/service_essays.py`

`list_essays` (summaries with `preview` derived from `content` plain text, linked school name via
application join — RO merge as in 2.1), `get_essay` (full content), `create_essay`,
`update_essay` (autosave path: patch `content`/`word_count`; **last-write-wins**, no version
checks — KISS per design doc), `duplicate_essay`, `archive_essay`/`restore_essay`. Essay deadline
is never stored — derived from the linked application's `deadline` in list/get payloads.

### 2.5 `app/workspace/service_activities.py`

Activities + honors: list/create/update/archive/restore, `reorder(ids)` (full ordered id list →
`sort_order = index`, one transaction, validates the set matches the user's active rows).
Common App caps enforced server-side too (10 activities / 5 honors active per user → 422).
Official Common App first-year resources dated 2025-06-25 confirm 10 activities and activity
character caps (position 50, organization 100, description 150); before release, verify the
active-cycle live form still uses `HONOR_TITLE_LIMIT = 100` and that the new Responsibilities and
Circumstances questions are intentionally out of scope for this workspace.

**Gate:** service unit tests green (mocked pool) + `live_db`-marked tests for: seeding
transaction atomicity (failure mid-seed leaves nothing), ownership scoping (foreign user id sees
nothing / cannot mutate), archive cascade + exact-set restore, change-log row per mutation,
roll-up correctness.

## Phase 3 — API routes + SSE endpoint + rate limit

New route files under `api/routes/`, mounted in `api/main.py` under `/v1`; all behind
`current_active_user`; body-bearing routes declare `Depends(require_json)`; errors via
`EnvelopeError` only; routes pass `event_bus=request.app.state.runtime.deps.workspace_events`,
`user_id=user.id, actor="student"` explicitly into the service. Auth failures stay the existing
fastapi-users 401 shape; workspace code must not translate expired/absent cookies into 403s.

| Route | → service |
|---|---|
| `GET /v1/schools/search?q=&limit=` | `search_schools` |
| `GET /v1/applications` · `POST` | `list_applications` · `add_application` |
| `GET/PATCH/DELETE /v1/applications/{id}` · `POST …/restore` | detail / update / archive / restore |
| `GET/POST /v1/tasks` · `PATCH/DELETE /v1/tasks/{id}` · `POST …/restore` | tasks CRUD |
| `POST /v1/tasks/bulk-status` · `POST /v1/tasks/bulk-archive` | bulk ops |
| `GET/POST /v1/essays` · `GET/PATCH/DELETE /v1/essays/{id}` · `POST …/restore` · `POST …/duplicate` | essays CRUD |
| `GET/POST /v1/activities` + `/{id}` PATCH/DELETE/restore · `PUT /v1/activities/order` | activities |
| same shape for `/v1/honors` | honors |
| `GET /v1/workspace/events` | SSE (below) |

Files: `api/routes/applications.py` (includes schools/search), `api/routes/tasks.py`,
`api/routes/essays.py`, `api/routes/activities.py` (activities + honors),
`api/routes/workspace_events.py`.

**SSE endpoint** (`workspace_events.py`): reuse `SSE_HEADERS`/`EventSourceResponse` +
`ping=settings.sse_keepalive_s` conventions from `api/sse.py` and the `Last-Event-ID` parsing
precedent in `api/routes/sessions.py`. Add a tiny `encode_workspace_sse(change)` instead of
misusing `encode_sse` unless `ChangeEvent` is made structurally compatible with `domain.events`.
Flow: parse `Last-Event-ID` → `replay_changes` from the table → subscribe to the bus → yield live
events; `event.id` = change id (native `EventSource` resends it on reconnect automatically).
Multi-tab = multiple subscriptions per user (bounded queues). **The MVP2 turn registry is not
touched.**

**Rate limit:** one new `check_workspace(user_id, *, per_minute)` method on the existing
`SlidingWindowLimiter` pattern (`api/ratelimit.py`), applied to mutating routes only. New Settings
knob `workspace_writes_per_minute: int = 240` (`COUNSELLE_WORKSPACE_WRITES_PER_MINUTE`; autosave
at 1 write/1.5s ≈ 40/min leaves headroom), added under a `# --- Workspace ---` section in
`config/settings.py`.

**Gate:** route unit tests (mocked pool, `tests/api/test_routes_unit.py` pattern) for: 401 when
unauthenticated, 404 on foreign/unknown ids (never 403), 415 without JSON content type, 422 on
bad enum values, 409 on duplicate active school, 429 pathway; `live_db` test: full add-school → list → complete-task →
roll-up moves; SSE test: mutation → event on subscribed queue; replay returns missed events.
Routine backend command green:
`uv run pytest -m "not live_llm and not live_search and not live_db"`; ruff clean.

## Phase 4 — Frontend data layer (client, hooks, SSE, primitives)

### 4.1 Transport + API modules

- `src/api/http/client.ts` — extract the `safeFetch` pattern from `auth.ts` into a shared
  `requestJson<T>(path, init?)`: `credentials:"same-origin"`, `AbortSignal.timeout`, reuse
  `TransportError`/`errorFromResponse` (no third error type). 401 returns
  `TransportError("unauthorized")`; workspace hooks respond by invalidating `authQueryKey` and
  letting the existing auth boundary redirect/show login state.
- `src/api/workspace/types.ts` — server payload types (mirror `app/workspace/models.py`).
- `src/api/workspace/{applications,tasks,essays,activities}.ts` — one function per endpoint.
- `src/api/workspace/keys.ts` — query-key factory:
  `workspaceKeys.applications.list()`, `.detail(id)`, `.tasks.list()`, `.essays.list()`,
  `.essays.detail(id)`, `.activities.list()`, `.honors.list()`, `.schoolSearch(q)`.
- `src/api/workspace/event-source.ts` — tiny injectable factory:
  `createWorkspaceEventSource(url = "/v1/workspace/events")`, defaulting to native
  `EventSource`. `useWorkspaceEvents` takes the factory as an optional parameter, and
  `src/test/render-app.tsx` installs a deterministic no-op/mock EventSource so authenticated
  route tests that render the real shell do not open real streams or depend on browser globals.

### 4.2 Mutation convention (used by every hook)

`useMutation` with: `onMutate` → cancel queries, snapshot cache, apply optimistic patch
(reusing the existing pure helpers: `updateItemById`, `removeById`, `insertAt`,
`moveTasksToStatus`, `renumber` — they are already reducer-shaped);
`onError` → restore snapshot + error toast; `onSettled` → invalidate the touched keys.
Optimistic creates insert a temp `crypto.randomUUID()` row replaced in `onSuccess`.

### 4.3 SSE client — `src/api/workspace/events.ts` + `useWorkspaceEvents()`

Native `EventSource("/v1/workspace/events")` via `createWorkspaceEventSource`, mounted once
inside `WorkspaceShell` only while `useMe()` has an authed user. On any event: parse
`{data.object_type}` → invalidate the matching query keys
(`application` also invalidates applications list — roll-ups; `task`/`essay` with
`application_id` also invalidate `applications.list`). Invalidation is idempotent, so self-echo
of the user's own mutations is harmless. `onerror` → EventSource auto-reconnects with
`Last-Event-ID`; after the first error, trigger one `fetchMe`/`authQueryKey` invalidation and
close the stream if the user is no longer authenticated, so an expired cookie does not spin an
invisible reconnect loop. No custom retry scheduler in v1.

### 4.4 Registry pulls + shared undo (registry-first rule; run from `frontend/`)

- Search the shadcn MCP from `frontend/` first, then install the selected primitives with
  `npx shadcn@latest add dialog command sonner` (dialog + cmdk command for the add-school
  palette; sonner for error/status toasts). Verify against `@base-ui`-vs-radix mix in
  `components/ui` and restyle with existing semantic tokens.
- Generalize delete-with-undo: move `UndoToast` to `src/components/undo-toast/` and add
  `src/hooks/useUndoableDelete.ts` — calls the archive mutation immediately (optimistic removal),
  shows UndoToast for `UNDO_WINDOW_MS` (5000, existing constant); Undo → restore mutation.
  Server-backed (archive/restore), replacing Activities' client-side re-insert.
- Replace `domain/time.ts` demo scaffolding: `createDemoId`/`createTimestamp`/`demoNowIso` usage
  is removed from production paths phase by phase (timestamps and ids become server-issued;
  relative-time display via one small `formatRelativeTime(iso)` util).

**Gate:** `npm run typecheck && npm test -- --run && npm run lint` green; new fetch-mock presets
and EventSource mock utilities in `src/test/render-app.tsx` cover the workspace endpoints/events
so page tests can be migrated per phase.

## Phase 5 — Schools page

- **Domain shape:** `School` type becomes the API `ApplicationView` (id = application id, plus
  `unitid`, `schoolName`, `location`, `websiteUrl?`, user-owned `status/listType/round/deadline`,
  derived `progress`/`essays`). `nextDeadline`/`deadlineUrgency` become pure client derivations
  from `deadline` (`schools-deadline.ts`); `logoUrl` becomes a favicon derived from
  `websiteUrl` domain (same convention as MVP2 `StepSource.favicon`), falling back to the
  existing letter-avatar primitive.
- **List wiring:** `SchoolsRoute` swaps fixture import for `useApplications()`; existing
  client-side filter/sort/column-resize logic stays as-is over server data; loading skeleton
  (existing `skeleton` primitive) + error state.
- **Add-school flow** (the front door — polish here): `AddSchoolDialog.tsx` — command-palette
  dialog (dialog + command primitives) opened by the "Add school" button
  (`SchoolsRoute.tsx:136`, currently dead) and `mod+K` on the page. 250ms-debounced typeahead →
  `GET /v1/schools/search`; result rows show favicon/letter avatar, name, "City, ST", and an
  "On your list" state (disabled). Selecting flips the same dialog to a confirm step: list type
  (default Target) + round (default RD) preselected, optional deadline date input (empty by
  default, never guessed), then one confirm → `POST /v1/applications` → optimistic row + sonner
  toast; seeded checklist/essays appear via invalidation + change events.
- **Detail side panel:** `SchoolDetailSheet.tsx` (existing `sheet` primitive) opened by row
  click on desktop and by tapping a `SchoolMobileList` card on mobile, deep-linked as
  `?school=<id>` (reuse Activities' `useSearchParams` deep-link pattern). Inline edits for
  status/list type/round/deadline (each a PATCH mutation); linked tasks and essays lists
  (navigate to task sheet / essay editor); archive button → `useUndoableDelete`.
  The external-website link stays as a separate affordance (`SchoolLink` icon), no longer the
  row's primary click.
- **First-run empty state** (none exists today): existing `empty` primitive + "Add your first
  school" CTA opening the dialog.
- Tests: migrate `SchoolsRoute.test.tsx` to fetch mocks; new `AddSchoolDialog.test.tsx`
  (search → select → confirm → optimistic row; already-on-list state; error rollback).

## Phase 6 — Tasks page

- `Task` domain type gains `application_id?: string`, `essay_id?: string`.
- `TasksRoute` swaps `useState<Task[]>` for `useTasks()`; every existing control keeps its
  callback seam: `onUpdateTask(id, patch)` → PATCH mutation (inline edits, detail sheet, status
  selects, date pickers); Kanban drag single/multi → `bulk-status` mutation; "New task" →
  create mutation. Add route-level skeleton and error/retry state before wiring per-view empties.
- **Delete (new — no control exists):** row/card dropdown item + Delete key on selection +
  detail-sheet action → `useUndoableDelete` (bulk-archive for multi-select).
- **School/essay link controls (new):** application picker (`Select` over
  `useApplications()` data) + optional essay picker in `TaskDetailSheet`; each picker includes an
  explicit "No school"/"No essay" option that sends `null` to unlink; linked chips on cards.
- **"Plan with agent" buttons:** stop fabricating local agent tasks (never-lie). Disabled with
  tooltip "Counselle agent — coming soon" (**Decision D2**).
- **First-run empty state** for zero tasks total (per-column/upcoming empties already exist).
- Tests: migrate `TasksRoute.test.tsx`; add delete-with-undo, bulk drag persistence, link-picker.

## Phase 7 — Essays (library + editor)

- **Domain shape:** `Essay` gains `applicationId: string | null`; `school`/`schoolLocation`
  replaced by server-joined `schoolName`/`schoolLocation` display fields; `updatedAt` becomes
  ISO (render-time relative formatting); `deadline`/`dueSoon` derived from the linked
  application; `comments`/`suggestions` are server counts (0 for now); `previewTitle`/
  `previewLines` replaced by server `preview`; **`version` field dropped and the version chip
  removed from `EssayLibraryCard`** — displaying a fake "V2" is a lie (**Decision D3**).
- **Library wiring:** `EssaysWorkspaceProvider`/`essayWorkspaceSnapshot` module-state deleted —
  TanStack Query cache replaces it. New essay / duplicate / mark-ready / archive-with-undo wired
  to mutations; new-essay flow asks type + optional school link (small dialog step; personal
  statement → `applicationId: null`). Filters/search stay client-side. Add library skeleton,
  editor skeleton, and error/retry states. True first-run empty state ("Start your personal
  statement" CTA) distinct from zero-filter-match copy.
- **Editor persistence (biggest gap — content is currently discarded):**
  `useEssayAutosave.ts` — Tiptap `onUpdate` → 1500ms debounce → PATCH `{content, wordCount}`
  (Tiptap JSON); flush immediately on: blur, unmount, `visibilitychange→hidden`, and `pagehide`
  (fetch `keepalive: true`). Save-state indicator wired to real mutation state
  (Saving... / Saved / Retry on error). Concurrency: last-write-wins; the change event keeps a
  second tab from drifting silently (editor route refetches on external `essay.updated` for the
  open essay when the local editor is pristine; if dirty, local wins — KISS).
- **Fixture-only fields:** `EssayRisk` is not persisted and the risk chip is removed until real
  agent analysis creates real flags. Do not store fake risk strings in the backend.
- Tests: migrate `EssaysRoute.test.tsx`; autosave debounce/flush with `vi.useFakeTimers`;
  editor reload restores content.

## Phase 8 — Activities page

- Swap fixture `useState` for `useActivities()`/`useHonors()`; the existing pure mutation
  helpers become the optimistic-update layer (Phase 4.2), so UI behavior is unchanged. Add
  route-level skeleton and error/retry states for both activities and honors lists.
- Reorder drag → `PUT /v1/activities/order` (optimistic; snapshot-cancel already built);
  move up/down same mutation. Delete-with-undo switches from client re-insert to
  archive/restore via `useUndoableDelete` (visuals unchanged). Create respects server-enforced
  caps (client caps stay). Copy-to-clipboard unchanged (client-side). `story` persists
  (Counselle-only, never in copy-export — unchanged).
- Tests: migrate `ActivitiesRoute.test.tsx` to fetch mocks (reorder persistence, undo restore).

## Phase 9 — Cross-cutting close-out

1. Two-tab live-update verification (manual, dev): complete a task in tab A → Schools roll-up
   moves in tab B without refresh; add school in A → row + seeded objects appear in B; agent-path
   rehearsal: call `app.workspace` service functions directly from a REPL with
   `event_bus=runtime.deps.workspace_events, actor="counselle"` → UI updates live (proves the
   agent seam with zero HTTP).
2. Sweep for dead controls across all four pages (the "no gaps" audit) — every button either
   works or is explicitly disabled-with-reason.
3. Docs: `docs/ARCHITECTURE.md` gains a workspace section (version-agnostic, timeless wording);
   `AGENTS.md` status + ADR map updated (ADR 0027); this plan graduates to `specs/` only after
   ship + verification, per repo lifecycle.
4. Full suites: backend routine command + ruff; `npm run typecheck && npm test -- --run && npm
   run lint`; `live_db` suite run once locally.
5. Fixtures: `src/fixtures/*` no longer imported by any production module (test mocks only);
   `domain/time.ts` demo clock deleted.
6. Active-cycle Common App spot-check: verify activity/honor count + character caps against the
   live first-year form before marking Phase 8 done; update `domain/activity.ts`,
   `app/workspace/models.py`, and tests together if the live form differs.

## What Not To Do

- No SQLAlchemy/Alembic; no ORM. No writes to `public.*`/`raw.*` — pipeline stays read-only.
- No reuse of the MVP2 turn registry or chat event vocabulary for workspace events.
- No agent tools, no MCP registration, no chat UI — the service seam is the deliverable.
- No essay version snapshots or version-browsing UI (deferred post-agent).
- No Calendar page work; no deploy work; no Google OAuth changes (DS-04 still open).
- No CI setup (explicitly declined); no visual-regression infra.
- No deadline/requirements pre-fill from pipeline data (coverage 7/2,746 — would be a lie).
- No fake essay risk, fake essay version, fake agent task, or fake school logo data.
- No redesign — wire the approved visuals; new surfaces (dialog, side panel, empty states) built
  from registry primitives + existing tokens.
- No client-side persistence (localStorage) of workspace objects.
- No new in-process state owners beyond the documented event bus.

## Verification

- Backend routine: `uv run pytest -m "not live_llm and not live_search and not live_db"`,
  `uv run ruff check`; targeted `uv run pytest -m live_db` once per phase 1–3.
- Frontend: `npm run typecheck && npm test -- --run && npm run lint` at every phase gate.
- Manual: Phase 9 two-tab test + no-dead-controls sweep against `uvicorn :8000` + `vite :5173`.
- Source check: Common App activity/honor caps verified for the active cycle before release; if
  inaccessible, keep the UI wording generic and do not claim exact Common App compliance.

## Acceptance Criteria (from the design doc, restated)

1. New account → designed first-run empty states with working add flows on all four pages.
2. Add school via real DB search → application + seeded checklist + essay slot appear
   immediately (one transaction).
3. Complete a task → school's progress roll-up updates in a second open tab without refresh.
4. Every object: create, edit, delete-with-undo, persisted across refresh, scoped per user;
   essay content autosaves (close tab mid-draft → nothing lost).
5. Every mutation goes through the service layer, records an actor in `workspace_changes`, and
   emits a change event (two-tab test + REPL `runtime.deps.workspace_events`,
   `actor="counselle"` rehearsal).
6. Zero dead controls; both test suites + typecheck + lint green.

## Known Risks

1. **Event bus lifecycle** (Medium, per design doc): many-tab churn, queue overflow, reconnect
   races. Mitigated by bounded queues + table-backed replay (missed live events are recovered by
   `Last-Event-ID`), and by events being invalidation hints (refetch), not state carriers.
2. **Seeding template is a product guess** (Decision D1) — contents are editable YAML, so
   iteration is cheap; the honesty framing ("starting point, not school requirements") is the
   invariant.
3. **Enum drift FE↔BE**: mirrored `Literal`s/unions in two languages. Mitigated by one shared
   fixture payload used by both backend route tests and frontend fetch mocks.
4. **Essay autosave races** (two dirty tabs): last-write-wins accepted by design; change events
   surface the overwrite rather than hiding it.
5. **RO pool dependency in list payloads**: applications/essays lists merge school identity from
   the pipeline pool; if it's down, degrade to unitid-only display rather than failing the page.
6. **Auth expiry on SSE**: browser `EventSource` hides the 401 status. Mitigated by mounting the
   stream only for authed users and invalidating `authQueryKey` on first stream error.

## Plan Decisions (binding unless founder overrides before build)

- **D1 — Seeding template v1** (design doc Open Question 1, resolved): the 6-task checklist + 1
  supplement slot in §2.2; deadline comes from user entry only. No static common-deadline table.
- **D2 — "Plan with agent" buttons**: disable with "Counselle agent — coming soon" tooltip (they
  currently fabricate fake agent tasks). Do not hide the affordance unless founder overrides.
- **D3 — Essay version chip**: remove (currently a hardcoded lie); comments/suggestions render as
  real zero counts.
- **D4 — School detail = side panel** (design doc OQ2): Sheet side panel, deep linked via
  `?school=<id>`.
- **D5 — Delete semantics** (design doc OQ3): soft archive + 5s undo + application cascade via
  `archived_via_application`, keep-everything retention.
- **D6 — Essay autosave cadence** (design doc OQ4): 1500ms debounce, flush on blur/unmount/
  `visibilitychange`/`pagehide`, last-write-wins, no version snapshots.
- **D7 — Common App caps** (design doc OQ5): official Common App 2025 resources confirm 10
  activities and activity caps (50/100/150); live-form spot-check still required for the active
  cycle, especially `HONOR_TITLE_LIMIT = 100` and whether Responsibilities/Circumstances belongs
  in this workspace scope.
