# Scholarships: complete feature plan

Branch `feat/scholarships-ui`, worktree `../counselle-scholarships`. Both surfaces' frontend is built and running against an in-memory mock (`frontend/src/api/scholarships/mock-db.ts`). This plan takes it to a shipped feature: database, backend, the frontend swap to real data, the remaining admin work, a read-only agent tool, tests and docs.

## 1. Problem and non-goals

Students need a list of scholarships they can browse, filter, save and act on, with an honest read of which ones they fit. Admins need to add, edit, publish, unpublish and archive scholarships by hand, keep them fresh, and see who changed what. Today nothing is stored: saves live in browser storage, edits vanish on reload, and "Ask Counselle" hands the agent a prompt about a record it can't look up.

Non-goals:

- **No scraping or import.** Admins enter launch data by hand (owner decision). No crawler, CSV import or feed.
- **No auto-matching on sensitive criteria.** Ethnicity, gender and religion stay free text in `other_eligibility` and always read "Check this yourself" (owner decision).
- **No application tracking.** Students save; they don't track applied/won. "Add deadline to Tasks" keeps copying title, deadline and apply link into an ordinary task.
- **No server-side fit.** Fit is computed in the browser from the student's profile, as today. The server and the agent never decide eligibility.
- **No hard delete.** Records are archived, so saves and history survive.
- **No restore-from-history, no merge, no "overwrite theirs".** History is read-only; a conflict means reloading the other admin's version.
- **No logo upload.** A URL or the source site's icon, as built.
- **No search engine or pagination.** A few hundred records in one payload; revisit past ~1,000 (R6).

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| D1 | Saved tab = save only | Owner |
| D2 | Admin editor saves explicitly (save bar + ⌘S), not autosave; `DESIGN.md` §17.3 records the exception | Owner |
| D3 | Launch data is entered by admins by hand; production starts empty | Owner |
| D4 | Sensitive criteria are text only, never matched, never inferred | Owner |
| D5 | Tables live in `counselle.*`, written through the app DSN, created by yoyo migration `0022_scholarships.sql`, never `cds_library` | Plan |
| D6 | Wire shapes are snake_case like every other `counselle` API (`frontend/src/api/sat/types.ts:1-8`). The frontend types are renamed to the wire shape; no camelCase mapping layer | House convention |
| D7 | DB columns are flat; the API nests `award`, `deadline`, `requirements`. `app/scholarships/rows.py` is the one place that maps a row to a model and back | Plan |
| D8 | Eligibility rules and essays are `jsonb`, validated by a Pydantic discriminated union at the API edge (§3.2) | Plan |
| D9 | Optimistic concurrency uses an integer `version`, checked under `SELECT … FOR UPDATE` | Plan |
| D10 | The server decides publishability. The editor's checklist is live feedback using the **same check ids**; a 422 returns the failing ids and the editor marks those rows | Plan |
| D11 | Every admin write appends one row to `scholarship_revisions` in the same transaction. History is read-only in the UI | Plan |
| D12 | The agent tool reports the stored rules and dates, never a fit verdict. Fit logic and rule wording exist once, in TypeScript | Plan (§7) |
| D13 | A fixed deadline that has passed is a checklist **warning**, not a publish failure: the student page already files it under "Closed this cycle", and an admin must be able to record a recurring scholarship before next year's date is out | Plan |

## 3. Database

### 3.1 Migration `migrations/0022_scholarships.sql`

`-- depends: 0021_sat_practice`. `0021`'s own `depends:` names the three earlier heads, so it is the single head on this branch. P0 re-checks `ls migrations` on `main` and renumbers if another branch took `0022`.

Applied as `counselle_app`, which owns what it creates (as in `0021`), so no GRANT is needed. Text fields arrive trimmed from the API, so `<> ''` means "not blank". A CHECK passes when its expression is NULL, so every nullable column the publish CHECK reads is tested with `IS NOT NULL` explicitly.

```sql
CREATE TABLE counselle.scholarships (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','published','archived')),
  version              integer NOT NULL DEFAULT 1,

  name                 text NOT NULL DEFAULT '',
  sponsor              text NOT NULL DEFAULT '',
  summary              text NOT NULL DEFAULT '',
  apply_url            text NOT NULL DEFAULT '',
  source_url           text NOT NULL DEFAULT '',
  logo_url             text NOT NULL DEFAULT '',           -- '' = use the source site's icon

  award_kind           text NOT NULL DEFAULT 'fixed'
                       CHECK (award_kind IN ('fixed','range','varies','full_tuition','full_ride')),
  award_amount         integer CHECK (award_amount >= 0),  -- whole dollars
  award_min            integer CHECK (award_min >= 0),
  award_max            integer CHECK (award_max >= 0),
  renewable            boolean NOT NULL DEFAULT false,
  renewal_years        smallint CHECK (renewal_years BETWEEN 1 AND 8),
  awards_count         integer CHECK (awards_count >= 1),

  deadline_kind        text NOT NULL DEFAULT 'fixed' CHECK (deadline_kind IN ('fixed','rolling')),
  deadline_on          date,
  opens_on             date,
  recurs_annually      boolean NOT NULL DEFAULT false,

  basis                text[] NOT NULL DEFAULT '{}',
  fields               text[] NOT NULL DEFAULT '{}',       -- empty = any field
  eligibility          jsonb  NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(eligibility) = 'array'),
  other_eligibility    text[] NOT NULL DEFAULT '{}',

  essays               jsonb    NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(essays) = 'array'),
  recommendations      smallint NOT NULL DEFAULT 0 CHECK (recommendations BETWEEN 0 AND 10),
  needs_transcript     boolean  NOT NULL DEFAULT false,
  needs_financial_docs boolean  NOT NULL DEFAULT false,
  needs_interview      boolean  NOT NULL DEFAULT false,

  last_checked_on      date,                               -- null = never checked against the source
  created_by           uuid REFERENCES counselle.users(id) ON DELETE SET NULL,
  updated_by           uuid REFERENCES counselle.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- A published row can never make the student page show a missing amount,
  -- a missing date, a dead link or an unchecked record.
  CONSTRAINT scholarships_published_is_complete CHECK (status <> 'published' OR (
        name <> '' AND sponsor <> ''
    AND apply_url ~* '^https?://' AND source_url ~* '^https?://'
    AND last_checked_on IS NOT NULL
    AND (award_kind <> 'fixed' OR (award_amount IS NOT NULL AND award_amount >= 1))
    AND (award_kind <> 'range' OR (award_min IS NOT NULL AND award_max IS NOT NULL
                                   AND award_max >= 1 AND award_min <= award_max))
    AND (deadline_kind <> 'fixed' OR deadline_on IS NOT NULL)))
);

CREATE TABLE counselle.scholarship_saves (
  user_id        uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  scholarship_id uuid NOT NULL REFERENCES counselle.scholarships(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scholarship_id)
);

CREATE TABLE counselle.scholarship_revisions (
  id             bigserial PRIMARY KEY,
  scholarship_id uuid NOT NULL REFERENCES counselle.scholarships(id) ON DELETE CASCADE,
  version        integer NOT NULL,   -- the scholarship's version after this change
  action         text NOT NULL,      -- create | update | publish | unpublish | archive | restore | checked
  snapshot       jsonb NOT NULL,     -- editable fields + status after the change (§3.3)
  actor_id       uuid REFERENCES counselle.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scholarship_id, version)
);
```

`0022_scholarships.rollback.sql` drops revisions, saves, then scholarships.

No extra indexes: the published list is a few hundred rows sorted in SQL, the saves primary key covers "my saves", and the revisions unique key covers history. Smaller choice lists (basis values, citizenship and grade options, revision action) are validated by `Literal` types in app code like the rest of `counselle.*`. The three status/kind CHECKs are kept in SQL because the publish CHECK reads them.

Deleting a user (`api/routes/me.py` relies on FK cascades) removes their saves and leaves scholarships and revisions, with the actor columns set to null.

### 3.2 Why jsonb for rules and essays

Seven rule kinds, at most one per kind, matched only in code against the student's profile. A rules table adds a join and a second write path for a query nothing runs. Revisit only if eligibility ever has to be filtered in SQL across thousands of records. Essays are a short list always read whole.

### 3.3 Revision snapshots

A snapshot is the record's **editable fields plus `status`**: the `ScholarshipDraftIn` shape plus `status`, with no `version`, timestamps or emails. Each snapshot then diffs cleanly against the one before it, and no email outlives a deleted account. The history route returns snapshots as plain JSON objects (`dict[str, Any]`), so an old snapshot never fails to parse after a later model change.

## 4. Domain core (`domain/scholarships/`, pure)

| File | Contents |
|---|---|
| `types.py` | Pydantic value models shared by `app/` and the agent tool. Literals: `AwardKind`, `DeadlineKind`, `Basis`, `CitizenshipOption`, `GradeOption`, `ScholarshipStatus`. Models: `Award` (`kind, amount, min, max, renewable, years, awards_count`), `Deadline` (`kind, date, opens_on, recurs_annually`), the `EligibilityRule` discriminated union on `kind` (`citizenship`/`state`/`grade` with `any_of`, `gpa_min` with `value`, `first_gen`, `financial_need`, `major` with `any_of`), `EssayRequirement` (`prompt, words`), `Requirements` (`essays, recommendations, transcript, financial_documents, interview`). Validation rules and limits are in the table below. |
| `publish.py` | `PublishCheck = Literal["basics","apply_url","award","rules_complete","deadline","source_url","fresh"]`, `STALE_AFTER_DAYS = 180`, and `publish_problems(draft, today) -> list[PublishCheck]`, implementing the rule table below. Also `deadline_passed(deadline, today) -> bool` and `is_stale(last_checked_on, today) -> bool`, which the agent tool uses. |

Validation in `types.py`. Every string is trimmed and every list de-duplicated. A violation is a 422 at the edge, whether the record is a draft or published.

| Field | Rule |
|---|---|
| `name`, `sponsor` | ≤ 200 chars |
| `summary` | ≤ 200 chars (the editor's limit) |
| `apply_url`, `source_url`, `logo_url` | `''` or an `http(s)://` URL with a host, no whitespace, ≤ 2048 chars. This is the guard against `javascript:`/`data:` links rendered into `href`/`src` for every student |
| `award` | amounts 0–10,000,000; `years` 1–8 and only when `renewable`; `awards_count` ≥ 1 or null |
| `eligibility` | ≤ 7 rules, at most one per kind; `state.any_of` ⊂ the 50 states + DC (`US_STATE_CODES`, one tuple); `major.any_of` items ≤ 100 chars, ≤ 60 items; `gpa_min.value` in (0, 4.0] |
| `fields` | ≤ 50 items, each ≤ 100 chars |
| `other_eligibility` | ≤ 10 items, each ≤ 300 chars |
| `requirements.essays` | ≤ 10, `prompt` ≤ 1000 chars, `words` 1–5000 or null; `recommendations` 0–10 |

`last_checked_on` must not be later than tomorrow (UTC). That check needs a clock, so it lives in `service.py` with an injected `today`, not in `types.py`, and the one-day slack keeps an admin east of UTC from being refused for clicking "Checked today".

Publish rules: `publish_problems` returns these ids, and the frontend checklist uses the same keys and labels.

| Id | Fails when | Label (frontend) |
|---|---|---|
| `basics` | `name` or `sponsor` is blank | Name and sponsor |
| `apply_url` | `apply_url` isn't an `http(s)` URL | Apply link is a web address |
| `award` | fixed: `amount` null or < 1. range: either bound null, `max` < 1, or `min` > `max` | Award amount is set |
| `rules_complete` | any `citizenship`/`state`/`grade`/`major` rule has an empty `any_of` | Every eligibility rule has a choice |
| `deadline` | fixed deadline with no date | Deadline set, or rolling |
| `source_url` | `source_url` isn't an `http(s)` URL | Source link is a web address |
| `fresh` | `last_checked_on` null or older than 180 days | `Checked in the last ${STALE_AFTER_DAYS} days` (built from the constant, so the number lives in one place) |

The frontend adds one **warning** row that never blocks publishing: "Deadline has passed" (D13).

## 5. App layer (`app/scholarships/`)

SQL lives in the service modules, as in `app/sat/` and `app/workspace/`. There is no repository layer.

| File | Contents |
|---|---|
| `errors.py` | `ScholarshipError`; `ScholarshipNotFoundError` (404); `ScholarshipValidationError` (422, optional `problems: list[PublishCheck]`); `ScholarshipConflictError` (409, `current_version`). Its own family, like `app/sat/errors.py`. |
| `models.py` | `ScholarshipDraftIn`: every editable field, including `last_checked_on: date \| None`, nested `award`/`deadline`/`requirements`. `ScholarshipCreateIn`: draft + `status`. `ScholarshipUpdateIn`: draft + `status` + `expected_version: int`. `StatusChangeIn`: `status` + `expected_version: int \| None`. `ScholarshipPublic`: draft fields + `id`, `created_at`, no `status`. `ScholarshipList`: `items: list[ScholarshipPublic]`, a wrapper so `etag_response` gets a `BaseModel`. `AdminScholarship`: `ScholarshipPublic` + `status`, `version`, `updated_at`, `updated_by_email: str \| None`. `RevisionOut`: `version, action, actor_email \| None, created_at, changed: list[str], snapshot: dict[str, Any]`. `SavedIds`: `ids: list[UUID]`. `extra="forbid"` on every input model. |
| `rows.py` | `record_from_row` / `columns_from_draft`: the only row ↔ model mapping (D7). |
| `service.py` | `list_published`, `published_vintage`, `list_all`, `get`, `create`, `update`, `change_status`, `mark_checked`, `revisions`. Details below. |
| `service_saves.py` | `saved_ids(pool, user_id)`: ids of saves whose scholarship is published. `save`: 404 unless published, then `INSERT … ON CONFLICT DO NOTHING`. `unsave`: idempotent. A save of a record later unpublished or archived is kept but not returned, so it comes back if the record is republished. |

**Every write in `service.py`** runs in one `async with pool.acquire() as conn, conn.transaction():` block (pattern from `app/sat/service_progress.py`):

1. `SELECT … FROM counselle.scholarships WHERE id = $1 FOR UPDATE`. If no row, raise `ScholarshipNotFoundError`. A PUT never upserts.
2. If `expected_version` is given and differs from the row's version, raise `ScholarshipConflictError(current_version)`.
3. Apply the transition rules in the table below.
4. Validate `last_checked_on` ≤ today + 1. If the result is published, run `publish_problems(result, today)`, where `today = datetime.now(UTC).date()` everywhere in this module. If any fail, raise `ScholarshipValidationError(problems)`.
5. `UPDATE … SET …, version = version + 1, updated_at = clock_timestamp(), updated_by = $actor`. Using `clock_timestamp()`, not the transaction-start `now()`, means a slow transaction can't commit an `updated_at` older than the current max and leave the ETag vintage unchanged.
6. `INSERT` the revision with the new version, `action_for(prev, new)` and the snapshot.

`create` skips steps 1–2 and writes version 1 with action `create`.

A `CheckViolationError` from the publish CHECK, which only fires if the domain check has a bug, maps to a plain 422 with no `problems`.

Status transitions. `action_for(prev_status, new_status)` is the one function behind every action label:

| From → to | Allowed via | Action |
|---|---|---|
| same → same | PUT (content edit) | `update` |
| same → same | `/status` | **no-op**: return the record unchanged, no version bump, no revision |
| draft → published | PUT or `/status` | `publish` |
| published → draft | PUT or `/status` | `unpublish` |
| draft/published → archived | `/status` only | `archive` |
| archived → draft | `/status` | `restore` |
| archived → published | `/status` (archive undo) | `restore` |
| any content edit while archived | PUT rejected with 422 "Restore this scholarship before editing it." | — |
| a status move the table allows only via `/status` | PUT rejected with 422 "Use the status action for this." | — |

`mark_checked(id, actor)` sets `last_checked_on = today` and nothing else. It bumps the version, logs action `checked`, and is allowed on any status except archived.

`revisions(id)` returns the newest 100, newest first. `changed` is the list of top-level snapshot keys that differ from the previous revision's snapshot; the first revision gets `[]`.

`published_vintage()` is one query: `count(*)`, `coalesce(max(updated_at)::text, '')` and `coalesce(sum(version), 0)` over published rows, joined into one string. It is never `None`, so an empty table still gets an ETag (`"0::0"`). Every status change and edit bumps `updated_at` and a version, so publish, unpublish and archive all change it.

"Today" is the server's UTC date, at most a day off an admin's local date. That changes nothing at a 180-day threshold, only shifts the passed-deadline warning by a day, and the `last_checked_on` rule allows a day of slack for it.

## 6. API

### 6.1 Error envelope extension (`api/deps.py`)

`EnvelopeError` gains `extra: dict[str, Any] | None = None`, and `envelope_error_handler` merges it into the `error` object. This is the only way extra data reaches the client:

- 422 publish failure: `{"error": {"message": "This scholarship isn't ready to publish.", "trace_id": "…", "problems": ["award","fresh"]}}`
- 409 conflict: `{"error": {"message": "Someone else changed this scholarship.", "trace_id": "…", "current_version": 7}}`

`map_scholarship_errors` lives in `api/routes/scholarships.py` (precedent `map_sat_errors`) and the admin router imports it.

### 6.2 Student routes, `api/routes/scholarships.py`, prefix `/scholarships`, `current_active_user`

| Route | Behaviour |
|---|---|
| `GET /v1/scholarships` | `ScholarshipList` of every published record, sorted by `deadline_on NULLS LAST, name`, through `etag_response(…, vintage=published_vintage, cache_control="private, no-cache")`, so a refetch is a cheap 304. |
| `GET /v1/scholarships/saved` | `SavedIds`. |
| `PUT /v1/scholarships/{id}/save` | 204, idempotent; 404 if not published; `workspace_write_rate_limit`. |
| `DELETE /v1/scholarships/{id}/save` | 204, idempotent; `workspace_write_rate_limit`. |

`user_id` only ever comes from `Depends(current_active_user)`.

### 6.3 Admin routes, `api/routes/scholarships_admin.py`, prefix `/admin/scholarships`, router-level `Depends(current_superuser)`

Signed-out callers get 401 and non-superusers 403, both before any 404 (same as `admin_facts.py`).

| Route | Behaviour |
|---|---|
| `GET /v1/admin/scholarships` | `list[AdminScholarship]`, every status, newest `updated_at` first. |
| `GET /v1/admin/scholarships/{id}` | `AdminScholarship`. |
| `POST /v1/admin/scholarships` | `ScholarshipCreateIn` → 201 `AdminScholarship`. |
| `PUT /v1/admin/scholarships/{id}` | `ScholarshipUpdateIn` → `AdminScholarship`. Full replacement of the editable fields plus status, so "Save and publish" is one PUT. |
| `POST /v1/admin/scholarships/{id}/status` | `StatusChangeIn` → `AdminScholarship`. Row-menu and ⋯-menu actions and archive undo. |
| `POST /v1/admin/scholarships/{id}/checked` | → `AdminScholarship`. "Mark checked today". |
| `GET /v1/admin/scholarships/{id}/revisions` | `list[RevisionOut]`. |

Every write uses `require_json` (except `/checked`, which has no body) and `workspace_write_rate_limit`. Both routers are mounted in `api/main.py` beside `sat.router` and `admin_facts.router`.

No new settings: `STALE_AFTER_DAYS` is part of the honesty rule, not a deploy knob, and the rate limit reuses `workspace_writes_per_minute`.

## 7. Agent tool (read-only)

This lets "Ask Counselle" talk about a record the agent can actually look up, and lets a student ask "what scholarships are there for…?" in chat. Per D12 it reports facts and never a fit verdict, so no second copy of the fit logic exists to drift.

- **Tool.** `search_scholarships(query: str | None = None, saved_only: bool = False, scholarship_id: str | None = None, include_closed: bool = False, limit: int = 8)` in `app/scholarships/agent_tools.py`, exposed through one factory, `build_scholarship_tools(app_pool, user_id, overflow)`.
- **Where it's mounted.** In `app/agent_node.py` next to `build_workspace_tools`, only when a `user_id` and `app_pool` exist, and never constructed for `Surface.ESSAY` (ADR 0013). The addition is a few lines, because `agent_node.py` is already over the size cap.
- **Overflow and registration.**
  - Results go through `process_tool_result(payload, ctx.tool_overflow, tool_name=…)` like `app/workspace/agent_tools_schools.py`.
  - Add a `config/assets/step_labels.yaml` row with `kind: workspace`, like `search_schools`. It isn't in `WORKSPACE_READ_TOOLS`, so it gets no preview chips, which is fine.
  - Add `"search_scholarships": "auth"` to `_GATED_BY` in `app/tool_specs.py`, so a call on a turn where the tool isn't mounted (essay surface, signed out) is suppressed like the other workspace tools.
- **Scope.** Reads published records only. `saved_only` reads the turn user's saves, by the authenticated `user_id`, never a model-supplied one.
- **What each row carries.** All of it is computed in code:
  - id, name, sponsor and the award in words;
  - the deadline as a date or "rolling", plus `closed: bool` from `deadline_passed` and `days_until_deadline`;
  - `rules`: the stored structured rules as-is (`{"kind": "state", "any_of": ["TX"]}`, `{"kind": "gpa_min", "value": 3.0}`). The model phrases them; there is no second copy of the frontend's rule wording to keep in sync;
  - `student_must_check`: the `other_eligibility` lines, verbatim;
  - `last_checked_on` with `stale: bool` from `is_stale`;
  - `how_to_say_it`, a code-built sentence the docstring tells the model to follow, e.g. "Counselle has not checked these rules against the student's profile. List them and let the student confirm. Deadline passed on 2026-03-01."
- **Matching and order.** `query` is an `ILIKE` over `name`, `sponsor`, `summary`, and the two `text[]` columns `fields` and `other_eligibility` via `array_to_string(…, ' ')`; rows come back ordered by `deadline_on NULLS LAST, name`. The result carries `total_matching` and `truncated`, and when `truncated` is true `how_to_say_it` says how many rows were left out, so the model never presents 8 of 200 as the whole list.
- **Closed records.** Excluded unless `include_closed` is true, a `scholarship_id` was asked for, or `saved_only` is set (a student's closed saves are still their saves). They always carry `closed: true`. When closed rows were excluded, the result carries `closed_omitted: N` and `how_to_say_it` mentions it.
- **Model-supplied input.** `query` is parameterized with `%` and `_` escaped before it goes into `ILIKE`. A `scholarship_id` that isn't a valid UUID is treated as not found rather than raising.
- **Records that aren't published.** An unknown or unpublished `scholarship_id` returns `{"found": false, "note": "This scholarship is no longer listed."}`.
- **The docstring's honesty contract.**
  - Never tell a student they qualify or are eligible; list the rules.
  - Never infer ethnicity, gender, religion or any other attribute from profile text.
  - Never present a closed scholarship as open.
  - The words "eligible" and "qualify" never appear in the **code-built** strings (`how_to_say_it`, `note`). Admin-entered text (`summary`, `student_must_check`) is passed through verbatim even when it says "Must be eligible for a Pell Grant", because rewording a sponsor's rule would itself be dishonest.
- **"Ask Counselle" button.** The draft prompt built in `ScholarshipsRoute.tsx` gains the scholarship id, so the model calls the tool with `scholarship_id`.

## 8. Frontend

### 8.1 Data layer (`frontend/src/api/scholarships/`, `frontend/src/api/http/`)

**`types.ts`, renamed to the wire shape (D6).** These are the only camelCase fields today:

| Today | Wire |
|---|---|
| `applyUrl`, `sourceUrl`, `logoUrl` | `apply_url`, `source_url`, `logo_url` |
| `award.awardsCount` (`award.years` unchanged) | `award.awards_count` |
| `deadline.opensOn`, `deadline.recursAnnually` | `deadline.opens_on`, `deadline.recurs_annually` |
| rule `anyOf` | rule `any_of` |
| `otherEligibility` | `other_eligibility` |
| `requirements.financialDocuments` | `requirements.financial_documents` |
| `lastCheckedOn` (string) | `last_checked_on` (string on public records, string \| null on admin records and drafts) |
| `createdAt` | `created_at` |
| `updatedAt`, `updatedBy` (name) | `updated_at`, `updated_by_email` (string \| null; admin only) |

**Type split.**

- `ScholarshipPublic` is what students get, with no `status`. Its `last_checked_on` is `string`, because the publish CHECK forbids null on a published record.
- `AdminScholarship` is `Omit<ScholarshipPublic, "last_checked_on"> & { last_checked_on: string | null; status; version; updated_at; updated_by_email }`.
- `ScholarshipDraft` is the editable fields plus `status`, written as an explicit field list rather than an `Omit` of the record, so a new server field can never leak into `sameDraft`.
- `RevisionOut` and `PublishCheck` are added too.

**Who reads which type.**

- `ScholarshipView = Omit<ScholarshipPublic, "last_checked_on"> & { last_checked_on: string | null }` is what `ScholarshipDetail` (and its freshness footer), `isStale` and `previewRecord` work with, so the admin preview, the history preview and the archived view can show a never-checked record. A `ScholarshipPublic` is assignable to it.
- `ScholarshipRow`, `ScholarshipList` and the filters take the strict `ScholarshipPublic`.
- `AdminScholarshipsPage`, `ScholarshipEditorPage` and the admin hooks take `AdminScholarship`.
- `previewRecord` returns a `ScholarshipView` and drops the fake `updatedBy: "You"`.

**Mechanics.** The header comment becomes "hand-maintained mirror of `app/scholarships/models.py`". The rename is its own commit, and `tsc` lists every call site.

**`api/http/errors.ts`.** `TransportError` gains `body?: unknown`, the parsed error envelope. A response body can be read only once, so `envelopeMessage` becomes `readEnvelope`, which parses once and returns the body, and `errorFromResponse` derives `message` from it and sets `body`. 409 already maps to `kind: "conflict"` and 422 to `"invalid_edit"`. `errors.test.ts` gains a 409 and a 422 case.

**`client.ts` (new).** One function per route, on `requestJson`/`requestVoid`.

**`errors.ts` (new), following `api/sat/errors.ts`.**

- `toastScholarshipError(error)`.
- `publishProblems(error): PublishCheck[]` reads `body.error.problems`.
- `conflictVersion(error): number | null` reads `body.error.current_version`.

**`hooks.ts`. The hook names stay; the queries become real.**

- **Student list and saves.**
  - `useScholarships` returns `items`.
  - `useSavedScholarshipIds` drops `staleTime: Infinity`.
  - `useToggleSavedScholarship` is optimistic: `cancelQueries` → snapshot → flip → PUT/DELETE. On error it rolls back and toasts. On settle it invalidates `saved`.
- **Saving a record.** `useSaveScholarship({ id, draft, expected_version })` takes the version from the editor's loaded `AdminScholarship`. On success it writes `detail(id)` with `setQueryData` before the caller navigates, and invalidates the admin and student lists.
- **Status and checked.**
  - `useSetScholarshipStatus({ id, status, expected_version? })` keeps the optimistic admin-list update. On error it rolls back and toasts, including a 422's message, so a failed archive-undo is never silent. On success it writes the returned record.
  - `useMarkChecked(id)` is new.
- **History.** `useScholarshipRevisions(id)` is new. It is enabled only while the History sheet is open.

**Deleted.** `mock-db.ts`, `fixtures.ts` and the browser-storage key `counselle:scholarships:saved`. The feature never shipped, so there is nothing to migrate.

**Test records.** Tests that need records build them with a small local helper.

### 8.2 Student surface (built; changes only)

- **Nothing published yet.** A new `NothingPublishedEmpty` in `ScholarshipEmpty.tsx`: "No scholarships yet" with no filter suggestions. It renders when the loaded list is empty, before any filtering. The nav item stays visible; announcing the feature only after real data is in is an owner launch-checklist item, not code.
- **List errors.** These already render an error card with retry (`ScholarshipsRoute.tsx`). A failed saved-ids query shows a toast and keeps the list usable, instead of silently reading "no saves".
- **Failed save.** The star rolls back and a toast shows (hook above).
- **Deep link `?s=<uuid>`.**
  - Only once the list query has succeeded, an id not in the list clears `s` and toasts "That scholarship isn't available any more."
  - While loading or after a failed fetch, `s` is left alone.
- **"Add deadline to Tasks"** keeps its current behaviour: an ordinary task titled "Apply for <name>" with `deadline_on` and the apply link in notes (`ScholarshipsRoute.tsx`, reading the renamed `apply_url`). `ScholarshipDetail`'s `ActionRow` already hides it for closed records. The task survives if the record is later archived; that's intended, because the student's plan is theirs.
- **"Ask Counselle"** now includes the scholarship id in the draft prompt (§7).

### 8.3 Admin surface (built; completing it)

- **Check ids and severities.**
  - `Check` becomes `{ key: PublishCheck | "deadline_passed", label, ok, severity: "required" | "warning" }`.
  - `publishChecks` in `editor-draft.ts` is rewritten to the rule table in §4. That means the stricter award rule, URL checks on both links and `fresh` failing when `last_checked_on` is null. `deadlineIsLive` is replaced by `deadline` plus the `deadline_passed` warning.
  - `ready` and `commit()` look only at `required` checks.
  - `PublishChecklist` in `EditorPreview.tsx` renders warning rows in the warning tone.
- **Last checked, and null.**
  - `emptyDraft` starts `last_checked_on: null`.
  - The existing "Checked today" button in `EditorForm.tsx` stays; its enabled test becomes `last_checked_on !== todayIso()`. The date input shows an empty value and the hint reads "Never checked" while null.
  - `daysSince` and `isStale` in `scholarship-format.ts` take `string | null`: null counts as stale and `daysSince(null)` returns null. Every comparison guards null first, because in JavaScript `null <= 180` is true: `fresh` is `last_checked_on !== null && daysSince(last_checked_on)! <= STALE_AFTER_DAYS`, and the same guard goes into `ScholarshipDetail`'s "N days ago" text and `EditorForm`'s `age === 0` test. The freshness footer in `ScholarshipDetail.tsx` (reached from the admin preview) reads "Never checked against the source".
  - The admin table cell and the `issuesFor` text in `AdminScholarshipsPage.tsx` read "Never checked" instead of a date or "NaN days".
- **422 from the server.** The rows named in `problems` are forced to failing until the next edit, the draft is kept, and the toast says "This scholarship isn't ready to publish." The server wins when the two disagree.
- **409 conflict.**
  - `commit`'s `onError` branches on `kind === "conflict"` and stores `conflictVersion` in editor state.
  - `SaveBar` gains a `conflict?: { onReload: () => void }` prop. While set it reads "Someone else changed this scholarship" and shows one action, "Load their version". That opens the existing confirm `Dialog` ("Your unsaved changes will be lost").
  - Confirming refetches the record, then resets the baseline and the draft from it.
  - While in conflict, Save and ⌘S are disabled, so a second PUT with the old version can't fire. Discard stays available.
  - Until then the draft stays on screen, so the admin can copy anything they need. The leave guard still applies.
  - A 409 from a ⋯-menu status call toasts and refetches the record.
- **⋯ menu.**
  - Unpublish, Archive and Restore call `useSetScholarshipStatus` with `expected_version`.
  - They're disabled while the draft is dirty, with the hint "Save or discard your changes first", so a status change can never silently publish edits.
  - Publish and "Save and publish" stay a PUT.
- **Mark checked today.** A row-menu item in the admin table and a ⋯-menu item in the editor (disabled while dirty), calling `useMarkChecked`.
- **Resync after a status change or mark-checked in the editor.** The editor's `baseline` and `draft` are local state, so both calls' `onSuccess` in the editor does `const d = toDraft(saved); setBaseline(d); setDraft(d)`. Otherwise the next Save, a full replacement carrying the new version, would silently put back the old `status` or `last_checked_on`. This is safe because both actions are disabled while dirty.
- **Needs attention** keeps its current meaning (`issuesFor` in `AdminScholarshipsPage.tsx`): any non-archived record that is stale, never checked, past its fixed deadline, or an incomplete draft. The only change is that null `last_checked_on` counts as stale.
- **History.**
  - A "History" item in the editor's ⋯ menu opens `HistorySheet.tsx`, listing revisions newest first: the action in words, the actor email or "Deleted user", relative time, and the changed field names.
  - Selecting a revision builds a preview with `previewRecord(snapshot, record)`, the same path `EditorPreview` uses, and shows it in the read-only `ScholarshipDetail` with `evaluateCriteria(…, EMPTY_FACTS)`.
  - Snapshots arrive as plain objects. A snapshot that's missing keys an older revision didn't have shows a "Can't preview this version" row instead of crashing the sheet.
  - The sheet is view-only.
- **Last edited by.** The table's updated column reads "2d ago · ana@…", or just "2d ago" when the email is null.
- **Archived records** open as the read-only `ScholarshipDetail` preview (`previewRecord(toDraft(record), record)`, `actions` omitted) instead of the form. "Restore as draft" sits in the page header's actions in `ScholarshipEditorPage`, where the ⋯ menu lives today, because `ScholarshipDetail`'s `actions` slot is for the student verbs. This avoids building a read-only mode into every custom form control.
- **Admin access.** It's granted only by `scripts/promote_admin.py`. `AdminGate` already redirects non-superusers, and the admin nav items are already hidden for them.

### 8.4 Dev seed

The 24 placeholder records move from `fixtures.ts` to `scripts/seed_scholarships.json`. Dates are stored as offsets (`deadline_in_days`, `opens_in_days`, `checked_days_ago`), so the "closing soon", "stale" and "closed" examples stay correct whenever the seed runs.

`scripts/seed_scholarships.py` resolves the offsets against today and creates each record through `app.scholarships.service.create` as the first superuser, so every record gets a revision and passes validation. With no superuser it exits with "Run scripts/promote_admin.py first." It refuses to run without `--dev`, and refuses unless the app DSN host is `localhost` or `127.0.0.1`. Production starts empty (D3).

## 9. Phases

Each phase ends with its gate green before the next starts.

| Phase | Work | Gate |
|---|---|---|
| **P0 Setup** | Rebase on `main`; confirm `0022` is free; commit the existing frontend as `feat(scholarships): student and admin UI on mock data`. | Frontend typecheck, lint and Vitest green. |
| **P1 Domain** | `domain/scholarships/{types,publish}.py` + tests. | `uv run pytest tests/domain/scholarships` green. |
| **P2 Database** | Migration + rollback; apply locally with `uv run yoyo apply --batch --database "${COUNSELLE_DB_APP_DSN}?schema=counselle" migrations/` (README). | apply → rollback → apply clean; a hand-written `INSERT` of a published row with a `javascript:` apply URL, and one with no amount, are both refused. |
| **P3 App + API** | `app/scholarships/{errors,models,rows,service,service_saves}.py`; `EnvelopeError.extra`; both routers mounted. | Hermetic route tests and live-DB service tests green; `ruff` and `mypy` clean. |
| **P4a Rename** | §8.1 types rename and split, null-tolerant `daysSince`/`isStale`, and a key-only rename of the checklist ids (rules unchanged), still on the mock. One commit. | Typecheck, lint and Vitest green; the student and admin pages render unchanged in a browser. |
| **P4b Real data** | §8.1 client, errors and hooks; `TransportError.body`; delete the mock; §8.2; seed script, run locally. | Frontend checks green; in a browser against the real API, the student page works end to end, and save/unsave survive a reload; Vitest behaviours 21–23 green. |
| **P5 Admin** | §8.3, including the `publishChecks` rule rewrite and `editor-draft.test.ts`. | Frontend checks green, including Vitest behaviours 5 and 24–28. A real browser runs: create → publish blocked by checklist → fix → publish → edit in two tabs → 409 → load theirs → archive → undo → mark checked → history. |
| **P6 Agent tool** | §7. | Tool unit tests green. Then two manual live chat turns (cost money, run by hand): "tell me about the <seeded sponsor> scholarship" returns its rules with no eligibility claim, and "which of my saved scholarships close soonest?" lists saves in deadline order, closed ones marked closed. A 5-case eval spot run shows no regression. |
| **P7 Close-out** | Docs (§13); the full §10 checks; review agents; PR. | Everything in §10 green. |

## 10. Verification

- **Backend.**
  - `uv run ruff check . && uv run mypy .`
  - `uv run pytest -m "not live_llm and not live_search and not live_db"`
  - `uv run pytest tests/app/scholarships -m live_db` against the local DB.
- **Frontend.**
  - `npm run typecheck`
  - `npx eslint --max-warnings 0 src/features/scholarships src/features/scholarships-admin src/api/scholarships src/api/http`
  - `npm test`
- **Browser.** A real browser at 390, 1100 and 1440 px against the real backend, both surfaces, running the P4b and P5 flows. Screenshots go in `artifacts/scholarships/`.

## 11. Behaviour list

Each behaviour has at least one test. "L" means a live-DB test, "H" a hermetic route test, "D" a domain test, "V" a Vitest test.

Validation and publishing:

1. (D) `publish_problems` returns each id in the §4 table for its failing case, and nothing for a complete record.
2. (D) A passed fixed deadline doesn't fail `deadline`.
3. (D) `javascript:`, `data:` and a bare word are rejected for each URL field; `''` is accepted for `logo_url`.
4. (D) Two rules of one kind, an unknown state code, a GPA outside (0, 4], and an over-limit string or list are each rejected; (L) a `last_checked_on` later than tomorrow (UTC) is rejected and tomorrow is accepted.
5. (V) The editor checklist marks the same rows as failing for the same drafts as behaviour 1, fails `fresh` for a never-checked draft, and shows the passed-deadline warning without blocking Publish.
6. (L) The publish CHECK refuses a direct `INSERT` of a published row with a non-http apply URL, a missing amount, or a null `last_checked_on`.

Student API:

7. (L) `GET /v1/scholarships` returns only published records, sorted by deadline then name.
8. (H) A repeat request with the returned ETag gets 304.
9. (L) After any publish, unpublish or edit, the vintage changes; an empty table still has one.
10. (L) Save is idempotent; saving a draft or archived record is a 404.
11. (L) Saved ids skip records that aren't published, and come back on republish.
12. (L) One user can't read or change another's saves; deleting a user removes their saves and leaves the scholarship and its revisions.

Admin API:

13. (H) Every admin route returns 401 signed out and 403 for a non-superuser.
14. (L) Create, update, every status change and mark-checked each append exactly one revision with the new version, the action from `action_for`, and the actor.
15. (L) A same-status `/status` call changes nothing and writes no revision.
16. (L) A stale `expected_version` returns 409 with `current_version` and changes nothing.
17. (L) Publishing an incomplete record, or editing a published record into an incomplete one, returns 422 with the failing ids and changes nothing.
18. (L) A PUT that edits an archived record, or makes a status move allowed only via `/status`, is a 422; archive undo to published runs the publish checks.
19. (L) A revision's `changed` lists exactly the snapshot keys that differ from the previous revision; the first is `[]`.
20. (H) The 409 and 422 envelopes carry `current_version` and `problems` inside `error`.

Frontend:

21. (V) A failed save toggle rolls back the star and toasts.
22. (V) A deep link to an id missing from a loaded list clears `?s=` and toasts; it does nothing while loading.
23. (V) An empty published list shows `NothingPublishedEmpty`, not the filtered empty state.
24. (V) A 409 keeps the draft and shows "Load their version"; confirming replaces the draft.
25. (V) A 422 marks exactly the rows named in `problems`.
26. (V) Status menu items are disabled while the draft is dirty, and after a status change or mark-checked the editor's draft and baseline equal the returned record.
27. (V) Save and ⌘S are disabled while in conflict.
28. (V) A record with null `last_checked_on` renders "Never checked" in the admin table, the editor and the preview, with no crash.

Agent:

29. (L) `search_scholarships` returns only published records, and `saved_only` returns only the turn user's saves.
30. (D) `deadline_passed` and `is_stale` are true for a passed fixed deadline and for a check older than 180 days; (L) the tool's rows carry them as `closed` and `stale`; closed rows are excluded (with `closed_omitted` set) unless asked for or `saved_only`; more matches than `limit` sets `truncated` and `total_matching`.
31. (L) The code-built strings (`how_to_say_it`, `note`) never contain "eligible" or "qualify", while an `other_eligibility` line containing "eligible" comes through verbatim.
32. (L) An unpublished `scholarship_id` returns `found: false` with the "no longer listed" note.

## 12. Open questions

None blocking. D13 settles the passed-deadline question, and §7 keeps the agent tool in scope on the narrower D12 terms. The owner can still move P6 to a follow-up PR without touching any other phase.

## 13. Docs

- `docs/ARCHITECTURE.md`: a scholarships section covering the tables, routes, and honesty boundary. Fit is computed only in the browser, the agent reports rules and never verdicts, and sensitive criteria are never matched.
- `docs/DATABASE_GUIDE.md`: a short note on the three `counselle.scholarship*` app tables.
- `docs/DEPLOY.md`: scholarship admin access is granted with `scripts/promote_admin.py`.
- `CLAUDE.md`: a one-paragraph status entry.
- `DESIGN.md`: §17.3 and §9.4 are already written; add the History sheet, the warning checklist row, and the conflict state of the save bar.
- `TODOS.md`: pagination past ~1,000 records (R6).
- The plan graduates to `specs/scholarships/` only after owner acceptance.

## 14. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The agent says something the page wouldn't. | D12: no fit verdict leaves the browser. The tool returns the stored rules, code-computed `closed` and `stale`, and a code-built `how_to_say_it`, with a test that no code-built string says "eligible" or "qualify". |
| R2 | The snake_case rename quietly breaks a screen. | It's its own commit (P4a) on the mock, with `tsc` as the checklist and a browser pass before any real data is wired. |
| R3 | Two admins overwrite each other. | The version check under row lock (D9), plus the conflict state. |
| R4 | Hand-entered data goes stale. | The `fresh` publish rule, null-until-checked, "Mark checked today", the Needs attention filter, the stale warning on the student page, and `stale` in the agent tool. |
| R5 | Another branch takes `0022`. | P0 re-checks on `main`, and we renumber before applying anywhere shared. |
| R6 | The single-payload list grows. | ETag/304 now; paginate past ~1,000 records (`TODOS.md`). The revisions route is capped at 100 full snapshots, a deliberate bound noted in the same `TODOS.md` entry. |
| R7 | A malicious or mistyped URL reaches students. | `http(s)`-only validation at the edge plus the DB CHECK on published apply/source URLs. Logos are only ever used in `<img src>` with `referrerPolicy="no-referrer"`. |

## 15. File manifest

**Created**

- `migrations/0022_scholarships.sql`, `migrations/0022_scholarships.rollback.sql`
- `domain/scholarships/__init__.py`, `types.py`, `publish.py`
- `app/scholarships/__init__.py`, `errors.py`, `models.py`, `rows.py`, `service.py`, `service_saves.py`, `agent_tools.py`
- `api/routes/scholarships.py`, `api/routes/scholarships_admin.py`
- `scripts/seed_scholarships.py`, `scripts/seed_scholarships.json` (data moved from `fixtures.ts`)
- `tests/domain/scholarships/__init__.py`, `test_types.py`, `test_publish.py`
- `tests/app/scholarships/__init__.py`, `conftest.py` (`app_pool` and `make_user` with a superuser flag, adapted from `tests/app/sat/conftest.py`), `test_service.py`, `test_service_saves.py`, `test_agent_tools.py`
- `tests/api/test_scholarships_routes.py`
- `frontend/src/api/scholarships/client.ts`, `errors.ts`
- `frontend/src/features/scholarships-admin/HistorySheet.tsx`, `editor-draft.test.ts`, `ScholarshipEditorPage.test.tsx` (behaviours 24–28), `AdminScholarshipsPage.test.tsx` (behaviour 28's table case)
- `frontend/src/api/scholarships/hooks.test.tsx` (behaviour 21), `frontend/src/features/scholarships/ScholarshipsRoute.test.tsx` (behaviours 22–23)

**Modified**

- `api/deps.py` (`EnvelopeError.extra`), `api/main.py` (mount two routers)
- `app/agent_node.py` (mount `build_scholarship_tools`), `app/tool_specs.py` (`_GATED_BY`), `config/assets/step_labels.yaml`
- `frontend/src/api/http/errors.ts` (`readEnvelope`, `TransportError.body`), `errors.test.ts`
- `frontend/src/api/scholarships/types.ts`, `hooks.ts`
- `frontend/src/features/scholarships/`: `ScholarshipsRoute.tsx`, `ScholarshipEmpty.tsx`, `ScholarshipDetail.tsx`, `scholarship-format.ts`, `eligibility.test.ts`, and every file that reads renamed fields
- `frontend/src/features/scholarships-admin/`: `editor-draft.ts`, `EditorPreview.tsx`, `SaveBar.tsx`, `ScholarshipEditorPage.tsx`, `AdminScholarshipsPage.tsx`, `EditorForm.tsx`, and every file that reads renamed fields
- `docs/ARCHITECTURE.md`, `docs/DATABASE_GUIDE.md`, `docs/DEPLOY.md`, `CLAUDE.md`, `DESIGN.md`, `TODOS.md`

**Deleted**

- `frontend/src/api/scholarships/mock-db.ts`, `frontend/src/api/scholarships/fixtures.ts`
