# School Essay Prompts — draft-only stage

Status: **design brief, awaiting confirmation** — not yet implemented.

## Current state (read from code)

Catalog prompts (official, from the data pipeline) already have exactly the
two-stage flow this feature wants — restricted to official CDS-sourced
prompts:

- `school_essay_prompts` table holds official, provenance-verified prompts
  per school/cycle (`app/workspace/models.py:870`, `SchoolEssayPrompt`).
- On the School page, each catalog prompt renders as a row with a
  **"Start writing"** button (`SchoolWorkspace.tsx:501`, `PromptRow`) that
  creates a real `Essay` row (`prompt_ref` pointing at the catalog prompt)
  and jumps straight into the editor.
- You can also **"Attach"** an existing unlinked essay to a catalog prompt,
  or **"Detach"** an essay back to a personal copy
  (`app/workspace/service_essays.py`, `_validate_prompt_link`).

User-added essays skip the "just a prompt" stage entirely:

- School page → "Added by you" card → **"Add essay"** immediately creates a
  blank `Essay` row and navigates to the editor (`SchoolWorkspace.tsx:600`).
- Essays page → "New essay" dialog lets you optionally link a school +
  catalog prompt, but creates the full `Essay` row on submit
  (`EssaysRoute.tsx:450`, `NewEssayDialog`).

**The gap:** no concept of a *student-authored prompt that isn't an essay
yet*. Every "add" action today commits to creating an `Essay` row
immediately (content, status, shows up in the Essays library). This feature
adds a third state: "I know I need to write something for this school,
here's the prompt text, but I'm not starting to write yet" — visible from
both pages, convertible to a real essay from either one.

## Decision: new lightweight entity

`school_essay_prompts` is catalog truth (HTTPS-sourced, provenance-verified,
immutable) and can't hold student-typed text. Reusing `Essay` with a new
lifecycle status was considered and rejected — it would leak "prompt-only"
rows into every essay-count/list query across the app (word count, essay
counts on the school card, the Essays page tabs), which is exactly the
"shouldn't be added to essays directly" leak this feature exists to avoid.

Building a new, isolated entity instead: `EssayPromptDraft`. Small, no
changes to the `Essay` or catalog models, mirrors the existing
catalog-prompt pattern but for user-authored prompts instead of official
ones.

## Confirmed answers

- **Entry points**: both School page and Essays page can add a draft
  prompt.
- **Conversion**: converting a prompt to an essay **consumes** the prompt
  (the draft row is deleted in the same transaction) — the resulting essay
  becomes the single source of truth, same as catalog prompts do today.
- **School requirement**: a draft prompt always requires a school
  (`application_id` is `NOT NULL`) — consistent with catalog prompts.

## Design Brief

**1. Feature Summary**
A lightweight "essay prompt" object that a student can add from either the
School page or the Essays page — just prompt text (+ optional word limit)
scoped to one application. It is not an essay: it won't appear in the
Essays library, count toward essay stats, or open an editor. It exists
purely as a placeholder intent until the student explicitly turns it into a
real essay, at which point the prompt is consumed and a normal `Essay` row
takes over — mirroring exactly how official catalog prompts already behave
today.

**2. Primary User Action**
Add a prompt with one line of text in under 5 seconds from wherever the
student is (School page or Essays page) — no forced navigation, no editor.
Later, convert it to a real essay in one click when ready to actually
write.

**3. Design Direction**
Restrained (per PRODUCT.md default — this is a `product`-register workspace
surface, not a marketing surface). No new color; reuse the existing
catalog-prompt row treatment (`Badge`, `Provenance`-style micro-copy minus
provenance since these aren't sourced) so the two prompt types read as
siblings, not competing patterns. No scene-sentence override needed — same
calm, dense, task-focused surface as the rest of the workspace.

**4. Scope**
Production-ready. Full breadth: both entry points (School page, Essays
page), plus the conversion action from both. Fully interactive, not a
prototype.

**5. Layout Strategy**
- **School page** (`SchoolWorkspace.tsx` → `EssaysSection`): add a third
  card, **"Prompts you're tracking"**, sitting between "School prompts"
  (catalog) and "Added by you" (existing free essays) — same visual
  language (row list, `Separator` between items) as the catalog
  `PromptRow`, but with a compact inline add-form at the top (single
  `InputGroup`, mirrors `QuickAddTask`'s pattern already used in
  Requirements) instead of a dialog.
- **Essays page** (`EssaysRoute.tsx`): add a **"Prompts"** tab alongside the
  existing filter tabs (all/by status), OR a distinct section above the
  essay grid — recommend a tab since `Tabs`/`filterOptions` infrastructure
  already exists and prompts are a different kind of card, not a filter of
  essays. Selecting it shows prompt rows, not essay cards. The "New essay"
  dialog's existing "Custom essay (no catalog prompt)" option gets a
  sibling: "Just save the prompt for now" — same dialog, one new
  radio-equivalent choice, since the school/prompt-picking UI is already
  90% built there.

**6. Key States**
- Empty (no draft prompts for this school / across all schools)
- Populated list (school page: ordered by `created_at`; essays page:
  grouped by school)
- Converting (button shows pending state briefly, then navigates to the new
  essay's editor)
- Prompt for an archived/removed application (should not be orphaned —
  cascades with the application, see open questions)

**7. Interaction Model**
- **Add**: type prompt text (+ optional word limit) → Enter or "Add" button
  → row appears immediately (optimistic), same as `QuickAddTask`.
- **Convert**: "Start writing" button on the row → creates the `Essay`
  (title defaulted the same way catalog prompts default titles today,
  prompt text carried over verbatim, word_limit carried over) → prompt
  draft is deleted server-side in the same transaction → navigate to the
  new essay's editor (matches catalog-prompt "Start writing" behavior for
  consistency).
- **Delete**: quiet trash icon on hover, no confirm dialog (nothing
  valuable is lost — it's a line of text), matches the low-ceremony feel of
  `QuickAddTask`.
- No edit-in-place needed for v1 — delete and re-add is cheap enough for a
  one-line prompt.

**8. Content Requirements**
- Placeholder text: "Add a prompt you know about — you can turn it into a
  full essay later"
- Empty state copy on School page card: "No tracked prompts yet. Add one
  below, or start writing directly from a catalog prompt above."
- No provenance line (these aren't sourced/verified — omitting the
  `Provenance` component here is itself a signal that this is
  student-entered, not catalog truth)

**9. Recommended References**
`layout.md` for the School-page card insertion, `interaction-design.md` for
the inline add-form + convert action states.

## Resolved technical decisions

Read against the actual codebase (migrations, `service_essays.py`,
`service_applications.py`, `changes.py`, the frontend hooks/events layer)
to make sure every piece below reuses an existing, proven pattern instead
of inventing a new one.

- **Agent-tool exposure**: skipped for v1 (YAGNI, per the design brief) —
  no `agent_tools_essay_prompt_drafts.py`. The service layer is still
  actor-aware (`actor: Actor`) from day one so this is a pure addition
  later, not a rewrite.
- **Two different "remove" operations, deliberately**: manual delete (trash
  icon) is a **soft archive** (`archived_at`), matching the undo-toast
  vocabulary already used for essays/tasks/applications everywhere else in
  the app. Conversion is a **soft archive with a `converted_to_essay_id`
  tombstone**, not a hard delete — see the Codex review correction below.
  The row still leaves the *active* list either way (same UI outcome as
  "consumed"), it just isn't physically destroyed.
- **Cascade with application**: mirrors `_archive_linked_essays` /
  `_restore_linked_essays` exactly (`app/workspace/service_applications.py:651-680`)
  — same `archived_via_application` column, same archive/restore-inside-one-transaction
  shape. This is what makes the existing "Undo" toast on school-archive
  (`SchoolWorkspace.tsx:1048` `archiveSchool`) correctly bring back tracked
  prompts too, instead of silently losing them.

## Second-opinion review (Codex, `gpt-5.6-sol`, xhigh reasoning)

Ran an independent design review against this plan + `AGENTS.md` before
writing any code. Verdict: **plan has issues** (0.99 confidence) — five P1s,
all confirmed against the actual codebase, not nitpicks. Corrected below;
the sections after this one reflect the fixed design, not the original.

1. **Hard-delete-on-convert violates ADR 0027.** `docs/adr/0027-workspace-service-and-change-events.md`
   states explicitly: *"Deletes are soft archives... Retention is
   keep-everything until a real purge requirement exists."* My original
   §3 planned a real `DELETE` on conversion. **Fixed**: conversion is now a
   soft archive with a `converted_to_essay_id` tombstone column (§1, §3
   below) — same "gone from active views" UX outcome, zero architecture
   violation, and the change log stays truthful.
2. **Lock-order deadlock.** `archive_application` locks the application row
   first (`_require_active_application`, `FOR UPDATE`,
   `service_applications.py:574-589`) then its children. My original §3
   locked the draft first, then the application — the reverse order.
   Two concurrent transactions taking locks in opposite orders is a
   textbook deadlock. **Fixed**: conversion now locks application first,
   matching the global convention (§3).
3. **Post-commit re-fetch race.** Re-reading the new essay via `get_essay()`
   after the transaction commits (mirroring `create_essay`'s existing
   pattern) leaves a window where a concurrent application-archive could
   archive the brand-new essay before the read, turning a successful
   conversion into a spurious 404. This race already exists in
   `create_essay` today (out of scope to fix there — smallest-diff rule),
   but the new endpoint doesn't have to inherit it. **Fixed**: `convert_essay_prompt_draft`
   returns the row produced by its own `INSERT ... RETURNING *` inside the
   transaction, enriched with school identity from data already loaded
   for the draft — no second connection acquisition after commit (§3).
4. **`NewEssayDialog`'s "save prompt" option can't actually submit.** The
   prompt-picker block only renders inside `{selectedApplicationId ? (...) : null}`
   (`EssaysRoute.tsx:275-372`), and `EssayPromptDraftCreate.prompt` is
   required text the dialog never collects today. **Fixed**: §7 now
   specifies the exact fields, state, and validation this mode needs.
5. **Prompts section invisible in the exact state it exists for.**
   `EssaysPage` returns its `<Empty>` "No essays yet" state
   (`EssaysRoute.tsx:547-565`) before ever rendering the grid — so a
   prompts section placed "above the essay grid" is unreachable precisely
   when a student has prompts but zero essays, which is the feature's
   primary use case. **Fixed**: §7 now renders the prompts section outside
   and above that branch, with independent loading/empty/error handling.

Also fixed the four P2s: DB-check/model-validation mismatch on blank
prompts (§2), rollback not purging `workspace_changes` rows (§1), cache
invalidation gaps on the *other* three mutations plus the existing
application archive/restore hooks (§5), and moving the concurrency test to
a real-Postgres `live_db` suite instead of a mocked unit test (§8). The
agent-tool cascade side effect (P2, archiving a school now silently
cascades to prompt drafts through the existing `archive_schools` tool) is
called out as a follow-up to verify, not blocking for v1 since no
prompt-draft agent tools ship yet.

## Technical Implementation Plan

### 1. Database — `migrations/0013_essay_prompt_drafts.sql`

New, isolated table. No changes to `essays` or `school_essay_prompts`.
`depends: 0012_drop_old_db_objects`.

```sql
-- Student-authored essay prompts that are not yet essays.
-- depends: 0012_drop_old_db_objects

CREATE TABLE counselle.essay_prompt_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES counselle.applications(id) ON DELETE CASCADE,
  prompt text NOT NULL CHECK (btrim(prompt) <> ''),
  word_limit integer CHECK (word_limit > 0),
  archived_via_application uuid REFERENCES counselle.applications(id) ON DELETE SET NULL,
  converted_to_essay_id uuid REFERENCES counselle.essays(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX essay_prompt_drafts_user_active_idx
  ON counselle.essay_prompt_drafts (user_id)
  WHERE archived_at IS NULL;
CREATE INDEX essay_prompt_drafts_application_idx
  ON counselle.essay_prompt_drafts (application_id);
```

`application_id` is `NOT NULL` (confirmed: always school-scoped) and
`ON DELETE CASCADE` for real deletes (applications are never hard-deleted
in practice, only archived — this FK is a safety net, same as `essays`).
`converted_to_essay_id` is the ADR-0027-compliant fix (see review above):
set exactly when conversion archives the draft, `NULL` for every other
archive reason (manual delete, cascade-with-application) — this is how the
service layer tells the three archive reasons apart without a separate
enum column.

Matching `0013_essay_prompt_drafts.rollback.sql` — mirrors the exact
hygiene 0010's rollback already established (`0010_profile_memory.rollback.sql:1-2`,
purge change-log rows for the object type before dropping what produced
them, so a rolled-back `ObjectType` union never fails to validate a
still-present row):

```sql
DELETE FROM counselle.workspace_changes WHERE object_type = 'essay_prompt_draft';
DROP TABLE counselle.essay_prompt_drafts;
```

### 2. Models — `app/workspace/models.py`

```python
PROMPT_DRAFT_TEXT_MAX_LENGTH = 2_000  # generous ceiling for a supplement prompt


def _reject_blank_prompt(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("prompt cannot be blank")
    return stripped


PromptDraftText = Annotated[
    str,
    AfterValidator(_reject_blank_prompt),
    Field(max_length=PROMPT_DRAFT_TEXT_MAX_LENGTH),
]


class EssayPromptDraft(_Model):
    id: UUID
    user_id: UUID
    application_id: UUID
    prompt: str
    word_limit: int | None = None
    archived_via_application: UUID | None = None
    converted_to_essay_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class EssayPromptDraftSummary(EssayPromptDraft):
    school_name: str
    school_city: str | None = None
    school_state: str | None = None
    school_website_url: str | None = None


class EssayPromptDraftCreate(_Model):
    application_id: UUID
    prompt: PromptDraftText
    word_limit: int | None = Field(default=None, gt=0)


class EssayPromptDraftConvert(_Model):
    """Title is caller-supplied, matching how every other essay-create path
    (catalog "Start writing", "Add essay") already builds its own title
    string client-side rather than having the backend guess one."""

    title: str = Field(min_length=1)
    essay_type: EssayType = "Supplement"
```

`PromptDraftText` strips and rejects blank input **before** it reaches the
database, so the DB's `CHECK (btrim(prompt) <> '')` becomes a true backstop
instead of the only line of defense — the Codex review flagged that
`Field(min_length=1)` alone lets whitespace-only text through, hits the
`CHECK` constraint, and surfaces as an unmapped `asyncpg.CheckViolationError`
→ opaque 500 (`map_workspace_errors` only catches `WorkspaceNotFoundError`/
`WorkspaceValidationError`, not raw Postgres errors). Same pattern as the
`_https_source_url` validator already in this file (`models.py:838-851`).

Three small additions to existing types:
- `ObjectType` gets `"essay_prompt_draft"` appended (`models.py:51-60`).
- `ApplicationDetail` gets `prompt_drafts: list[EssayPromptDraft] =
  Field(default_factory=list)` (`models.py:955-959`) — this is what lets
  the School page render tracked prompts without a second network call.
- Nothing new needed on `Essay`/`EssayCreate` — conversion writes a normal
  essay row exactly like today's "Added by you" path.

No new `ChangeOp` value — reuses `created` / `updated` (word-limit edits,
if ever added) / `archived` / `restored`, all already generic across
object types. Conversion's archive event and a manual-delete archive event
are told apart downstream purely by whether `converted_to_essay_id` is set
on the row, not by a different `op`.

### 3. Service layer — new `app/workspace/service_essay_prompt_drafts.py`

Mirrors `service_essays.py`'s shape and locking discipline exactly (small
file, < 200 lines, one clear responsibility):

- `list_essay_prompt_drafts(app_pool, catalog, *, user_id) -> list[EssayPromptDraftSummary]`
  — flat list across all schools for the Essays-page "Prompts" tab. Joins
  `applications` for `application_id`'s `school_unitid`/`cycle_year`, then
  reuses `school_identities()` from `service_utils.py` for name/city/state/
  website — the exact helper `service_essays.py` already uses, so school
  favicons/names render identically everywhere.
- `get_essay_prompt_draft(app_pool, catalog, *, user_id, draft_id) -> EssayPromptDraftSummary`
  — single-row enrichment helper, same role `get_essay` plays for essays.
  `create_essay_prompt_draft` and `restore_essay_prompt_draft` both call
  this before returning, so the API always hands back a school-enriched
  `EssayPromptDraftSummary` — **not** the bare `EssayPromptDraft` — which
  is what the frontend's optimistic-replace needs (Codex flagged that a
  bare row can't correctly replace a `EssayPromptDraftSummary`-shaped
  temp item in the list cache; see §5).
- `create_essay_prompt_draft(app_pool, catalog, event_bus, *, user_id, actor, data)`
  — reuses the same ownership/active-application guard
  `service_essays.py:560` (`_validate_application`) uses; copied rather
  than imported cross-module per the "extract on shared meaning, not
  coincidence" house rule — these two call sites changing together isn't
  guaranteed. Inserts row, records `object_type="essay_prompt_draft"`,
  `op="created"`, returns via `get_essay_prompt_draft`.
- `archive_essay_prompt_draft(app_pool, event_bus, *, user_id, actor, draft_id)`
  — soft delete (`archived_at = now()`, `converted_to_essay_id` stays
  `NULL`), for the manual trash-icon path. Same shape as `archive_essay`.
- `restore_essay_prompt_draft(app_pool, catalog, event_bus, *, user_id, actor, draft_id)`
  — for the Undo toast on manual delete only (never called on a converted
  row — see below). Re-validates the application is still active (same
  guard as `restore_essay`) so a prompt can't be undone back onto an
  archived school, and refuses (`WorkspaceValidationError`) if
  `converted_to_essay_id IS NOT NULL` — a converted prompt is not
  restorable as a prompt; its essay is what you'd restore instead.
- `convert_essay_prompt_draft(app_pool, catalog, event_bus, *, user_id, actor, draft_id, data: EssayPromptDraftConvert) -> Essay`
  — **single transaction**, corrected per the Codex review (original plan
  had a lock-order deadlock and a hard delete that violated ADR 0027):
  1. `SELECT id FROM counselle.applications WHERE id = (SELECT application_id
     FROM counselle.essay_prompt_drafts WHERE id = $1 AND user_id = $2)
     AND archived_at IS NULL FOR UPDATE` — **lock the application first**,
     matching `_require_active_application`'s lock order
     (`service_applications.py:574-589`) so this transaction and a
     concurrent `archive_application` always acquire locks in the same
     order and can never deadlock each other. Raise
     `WorkspaceNotFoundError` if the draft doesn't resolve to an active
     application.
  2. `SELECT ... FOR UPDATE` the draft row itself, scoped to `user_id`
     — closes the same TOCTOU race `_require_essay`'s `FOR UPDATE`
     comment describes (a double-click or duplicate tab converting the
     same draft twice before either commit lands). Raise
     `WorkspaceNotFoundError` if missing, already archived, or its
     `application_id` doesn't match the row locked in step 1.
  3. `INSERT INTO counselle.essays (...) RETURNING *` carrying
     `application_id`, `prompt = draft.prompt`, `word_limit =
     draft.word_limit`, `title = data.title`, `essay_type =
     data.essay_type`, `status = 'Not started'`, default empty Tiptap
     content. **No `prompt_ref`** — this essay is not linked to the
     immutable catalog table, exactly like today's "Added by you" essays.
  4. `UPDATE counselle.essay_prompt_drafts SET archived_at = now(),
     updated_at = now(), converted_to_essay_id = $new_essay_id WHERE id =
     $1` — **soft archive, not delete** (the ADR-0027 fix). The row stays
     for audit/history; every active-list query already filters
     `archived_at IS NULL` so it disappears from the UI identically to a
     hard delete.
  5. Record two change events in the same transaction: `essay.created`
     (object_id = new essay) and `essay_prompt_draft.archived` (object_id
     = the draft, now bearing `converted_to_essay_id`).
  6. Return `Essay.model_validate(dict(essay_row))` — the row already
     produced by step 3's `RETURNING *`, enriched with school identity
     from the same `SchoolIdentity` lookup the transaction already has
     from validating the application. **No post-commit `get_essay()`
     re-fetch** — the Codex review pointed out that re-reading after
     commit leaves a window where a concurrent `archive_application` could
     archive the brand-new essay before the read, turning a successful
     conversion into a spurious 404. Returning the in-transaction row
     sidesteps that entirely for this new endpoint (the same latent race
     exists in today's `create_essay`, which does re-fetch after commit —
     out of scope to change there, per the smallest-diff rule, but not
     worth reintroducing here).

`get_application_detail` (`service_applications.py:467`) gets one more
query alongside the existing `task_rows`/`essay_rows` fetch: `SELECT *
FROM counselle.essay_prompt_drafts WHERE user_id = $1 AND application_id =
$2 AND archived_at IS NULL ORDER BY created_at`, mapped into
`prompt_drafts=[EssayPromptDraft.model_validate(dict(row)) for row in
draft_rows]`.

`archive_application` / `restore_application` each get one more
`_archive_linked_*` / `_restore_linked_*` helper + one more `_record_many`
call, copy-pasted from the essay ones with the table name swapped
(`service_applications.py:651-680`) — this is the mechanism that makes
cascade-with-undo work. The archive-cascade `UPDATE` must add `AND
converted_to_essay_id IS NULL` to its `WHERE` clause — a draft that was
already converted is archived-with-a-tombstone, not "active," so it must
never be picked up by the application-level cascade or have its
`archived_via_application` overwritten.

**Follow-up to verify, not blocking for v1**: `archive_schools` /
`restore_school` (`app/workspace/agent_tools_schools_mutations.py:443-500`)
call `archive_application`/`restore_application` with `actor="counselle"`.
Once this cascade lands, those agent tools silently start
archiving/restoring prompt drafts too. No prompt-draft agent tool ships in
this plan (confirmed YAGNI), but their tool descriptions and any test
assertions about "what gets archived" should be checked for accuracy
before merging, since the side effect is now real even without a dedicated
tool (Codex review, P2).

### 4. Routes — new `api/routes/essay_prompt_drafts.py`

Same shape as `api/routes/essays.py`, five endpoints:

```
GET    /essay-prompt-drafts                      list_essay_prompt_drafts
POST   /essay-prompt-drafts                       create_essay_prompt_draft
DELETE /essay-prompt-drafts/{draft_id}             archive_essay_prompt_draft (204)
POST   /essay-prompt-drafts/{draft_id}/restore      restore_essay_prompt_draft
POST   /essay-prompt-drafts/{draft_id}/convert      convert_essay_prompt_draft -> Essay
```

Every write route carries `Depends(require_json)` +
`Depends(workspace_write_rate_limit)` (create/convert) or just the rate
limiter (archive/restore delete-shaped calls), exactly like
`essays.py:37-153`. Errors go through the existing
`map_workspace_errors`/`EnvelopeError` machinery unchanged — no new error
types needed, `WorkspaceNotFoundError`/`WorkspaceValidationError` already
cover every failure mode here (missing draft, archived application).

Register in `api/main.py`: import `essay_prompt_drafts` alongside the
existing workspace route imports (`main.py:47`), then
`app.include_router(essay_prompt_drafts.router, prefix="/v1")` next to the
`essays.router` line (`main.py:184`).

### 5. Frontend — API client, types, hooks, SSE

- **`frontend/src/api/workspace/types.ts`**: add `EssayPromptDraft`,
  `EssayPromptDraftSummary`, `EssayPromptDraftCreate`, and
  `EssayPromptDraftConvert` types mirroring the Pydantic models 1:1 (same
  `snake_case` field names as the wire format — this codebase's `types.ts`
  is a direct wire mirror, camelCase only happens in `domain/*.ts`
  adapters). Add `prompt_drafts: EssayPromptDraft[]` to the
  `ApplicationDetail` type. Add `"essay_prompt_draft"` to whatever union
  backs `WorkspaceObjectType` (`types.ts:599`).
- **`frontend/src/api/workspace/essay-prompt-drafts.ts`** (new): five thin
  `requestJson`/`requestVoid` wrappers, copy of `essays.ts`'s shape
  (`listEssayPromptDrafts`, `createEssayPromptDraft`,
  `archiveEssayPromptDraft`, `restoreEssayPromptDraft`,
  `convertEssayPromptDraft`).
- **`frontend/src/api/workspace/keys.ts`**: add
  ```ts
  essayPromptDrafts: {
    all: () => [...workspaceKeys.all, "essayPromptDrafts"] as const,
    list: () => [...workspaceKeys.essayPromptDrafts.all(), "list"] as const,
  },
  ```
- **`frontend/src/api/workspace/hooks/essay-prompt-drafts.ts`** (new):
  `useEssayPromptDrafts()` (list), `useCreateEssayPromptDraft()`,
  `useArchiveEssayPromptDraft()`, `useRestoreEssayPromptDraft()`,
  `useConvertEssayPromptDraft()`. Two caches hold this data
  (`workspaceKeys.essayPromptDrafts.list()` for the Essays page,
  `workspaceKeys.applications.detail(applicationId).prompt_drafts` for the
  School page) and the Codex review's point stands: **every** mutation
  hook must write to both optimistically, not invalidate-and-hope, or one
  page visibly lags the other for the length of a round trip:
  - `useCreateEssayPromptDraft`: `onMutate` appends a temp
    `EssayPromptDraftSummary` (needs `application_id`'s school identity —
    read it out of the already-cached `applications.list()`/`applications.detail()`
    entry the same way `NewEssayDialog` already has it in scope, not a new
    fetch) to **both** `essayPromptDrafts.list()` and
    `applications.detail(applicationId)`'s `prompt_drafts` array;
    `onSuccess` replaces the temp id in both places with the real,
    server-enriched summary (mirrors `replaceTempById` in
    `hooks/essays.ts:81-86`).
  - `useArchiveEssayPromptDraft` / `useRestoreEssayPromptDraft`: same
    dual-cache `removeById`/`insertAtStart`-equivalent update, in both
    query keys, matching `useArchiveEssay`/`useRestoreEssay`'s shape.
  - `useConvertEssayPromptDraft`: `onSuccess` removes the draft from both
    caches **and** appends the returned `Essay` (as an `EssaySummary`) to
    `workspaceKeys.essays.list()` — Codex's finding here was correct: the
    original plan's §5 only touched the drafts list, so a converted
    prompt would vanish from the School/Essays prompt sections but the
    new essay wouldn't appear in the Essays library until the next
    unrelated refetch.
  - Every hook's `onSettled` still invalidates the same keys as a
    correctness backstop (network races, multi-tab), exactly like the
    existing essay hooks already do — optimistic updates are the
    *responsiveness* layer, invalidation is the *correctness* layer, keep
    both.
- **Existing `useArchiveApplication` / `useRestoreApplication` hooks**
  (wherever they live today, alongside `hooks/applications.ts`) need one
  more line each: invalidate `workspaceKeys.essayPromptDrafts.list()` in
  `onSettled`, exactly like they presumably already invalidate an
  essays-adjacent key for the essay cascade. Codex flagged this
  specifically — the backend cascade (§3/§4 above) now touches this table
  on application archive/restore, and the existing hooks have no reason to
  know that yet.
- **`frontend/src/api/workspace/events.ts`**: add `"essay_prompt_draft"` to
  the `objectTypes` array (`events.ts:17-23`) and a matching `case
  "essay_prompt_draft":` in `invalidateFromChange` (`events.ts:56-98`) that
  invalidates `workspaceKeys.essayPromptDrafts.list()` and
  `workspaceKeys.applications.all()` — mirrors the existing `essay` case
  exactly. This is what keeps a *second tab* (where the optimistic update
  above never ran, because the mutation happened in the first tab)
  correct: convert a prompt from the Essays page in tab A, and the School
  page open in tab B drops the row and shows the new essay via SSE without
  a manual refresh. Optimistic updates (above) cover the tab that made the
  change; this SSE case covers every other tab/device — both are required
  for "the two pages work together perfectly," not just one.

### 6. UI — School page (`frontend/src/features/schools/SchoolWorkspace.tsx`)

- New `PromptDraftRow` + `PromptDraftsCard` components inserted into
  `EssaysSection` between the existing "School prompts" `Card`
  (`SchoolWorkspace.tsx:617-691`) and "Added by you" `Card`
  (`SchoolWorkspace.tsx:692-739`) — visually a third, structurally
  identical `Card`/`CardHeader`/`CardContent` block, titled **"Prompts
  you're tracking."**
- Inline add form at the top of the card: single `InputGroup` (prompt
  text) — copy `QuickAddTask`'s exact structure (`SchoolWorkspace.tsx:342-388`):
  `InputGroupInput` + Enter-to-submit + `InputGroupButton`. Word limit is a
  secondary, collapsed/optional field (a small `Input type="number"` next
  to it, or a "+ word limit" toggle) — keep the primary path a single text
  field and Enter, per the brief's "under 5 seconds" primary action.
- Each row: prompt text, word limit badge if set, "Start writing" button
  (calls `useConvertEssayPromptDraft`, passes a generated title —
  `` `${application.school_name} supplement` `` matching
  `defaultEssayTitle`'s convention in `EssaysRoute.tsx:112` — then
  navigates to `/app/essays/${created.id}`, exactly like `PromptRow.startWriting`
  does today at `SchoolWorkspace.tsx:410-421`), and a quiet trash icon
  (calls `useArchiveEssayPromptDraft`, triggers the same `UndoToast`
  pattern already wired at the bottom of `EssaysPage` — reuse
  `UndoToast`/`useUndoableDelete`'s `UNDO_WINDOW_MS` constant rather than
  a bespoke timeout).
- Empty state: plain text row, no `Empty`/`EmptyMedia` ceremony (this is a
  secondary card, not a primary empty state like the catalog-prompts one).

### 7. UI — Essays page (`frontend/src/features/essays/EssaysRoute.tsx`)

- Add a **"Prompts"** entry to `filterOptions`/`Tabs` is the wrong shape —
  `filterOptions`/`filterEssays` operate on `Essay[]`, and prompt drafts
  are a structurally different object (no content, no word count, no
  status). A separate `Tabs`-adjacent toggle is unnecessary complexity for
  what's really just one more section. Simplest correct shape: a
  **"Prompts you're tracking"** section using `useEssayPromptDrafts()`
  grouped by school, each row identical to the School-page `PromptDraftRow`
  (extract it as one shared component,
  `frontend/src/features/essays/PromptDraftRow.tsx` or a shared location
  imported by both pages — the row's three states — text, convert, delete
  — are byte-for-byte identical on both pages).
- **Placement — corrected per the Codex review.** The original plan put
  this section "above the essay grid," but `EssaysPage`'s render tree
  short-circuits to the `hasNoEssays` `<Empty>` block
  (`EssaysRoute.tsx:547-565`) *before* the grid renders at all — so a
  section placed "above the grid" is unreachable exactly when a student
  has tracked prompts but zero essays yet, which is this feature's central
  scenario (add a prompt on the School page, haven't started writing,
  visit Essays page — with the original placement they'd see "No essays
  yet" and never learn the tracked prompt is visible here too). Fixed
  structure: call `useEssayPromptDrafts()` and render the prompts section
  **above and outside** the `essaysQuery.isLoading ? ... : essaysQuery.isError
  ? ... : hasNoEssays ? ... : (...)` chain entirely, with its own
  independent loading/empty/error handling (loading: skeleton row or
  nothing, per how lightweight this section is; error: silent — don't let
  a prompts-fetch failure block the essay library from rendering; empty:
  render nothing, not an `<Empty>` block — this is a secondary section,
  its absence needs no explanation).
- `NewEssayDialog`'s prompt `Select` — inside the existing
  `{selectedApplicationId ? (...) : null}` block
  (`EssaysRoute.tsx:275-372`), which already gates all prompt-picking UI on
  a school being selected first — gets one more item group: alongside
  `customPromptValue` ("Custom essay (no catalog prompt)"), add items for
  the selected application's existing draft prompts
  (`useApplication(selectedApplicationId).data?.prompt_drafts`), labeled
  with their text. Picking one calls `convertEssayPromptDraft` instead of
  `createEssay` on submit. This is what makes "add prompt from School
  page, later finish it from Essays page" actually smooth instead of
  requiring the student to remember which page has it.
- **"Just save the prompt for now" — corrected per the Codex review** with
  the actual fields it needs (the original plan named this option but
  never gave it anywhere to collect the required prompt text, since
  `EssayPromptDraftCreate.prompt` is mandatory and the dialog's existing
  fields don't produce it):
  - A new dialog mode, toggled by a segmented control or two buttons in
    the footer ("Create essay" / "Save prompt for now") rather than
    folding it into the existing type `Select`, since it changes which
    fields are relevant, not which essay type is selected.
  - Requires a school to be selected first (`selectedApplicationId` set) —
    draft prompts are always school-scoped (confirmed answer). If no
    school is selected, disable "Save prompt for now" with the same
    `aria-describedby` help-text pattern already used for prompt
    unavailability (`EssaysRoute.tsx:284`): "Select a school first — draft
    prompts always belong to one application."
  - In this mode: hide the essay-type `Select` (drafts have no type yet —
    that's decided on conversion) and the catalog-prompt `Select`
    (picking a catalog prompt means "start writing that one," which is
    already the existing "Start writing" flow, not this one). Show a
    required `Textarea` for the prompt text and an optional number
    `Input` for the word limit — the two fields `EssayPromptDraftCreate`
    actually needs.
  - Submit calls `createEssayPromptDraft({ application_id, prompt,
    word_limit })`, closes the dialog, and — unlike essay creation — does
    **not** navigate anywhere (`onOpenEssay` is not called; there is no
    essay yet). A toast confirms the save, matching how other quiet
    non-navigating writes in this app confirm (e.g. `useUpdateApplication`'s
    implicit save-on-blur pattern needs no toast, but a modal close with no
    visible result would feel broken, so this one gets an explicit
    "Prompt saved" toast).

### 8. Tests (scoped to this project's actual testing bar, not a generic 80% rule)

Per `AGENTS.md`: *"No TDD, and no reflexive tests — a test has to earn its
place... Skip everything else."* This feature is plain student-typed text,
not an honesty-critical path (no citations, no value-reading, no packet
data) — so the bar stays low and targeted:

- **Corrected per the Codex review**: the original plan put the
  double-conversion assertion in a mocked/unit-level file, but a scripted
  fake connection can't exercise real row locking, blocking, or deadlock
  behavior — it can only assert that the SQL text contains `FOR UPDATE`,
  which proves nothing about whether the lock actually prevents the race.
  The concurrency-sensitive cases belong in the **live** suite, which
  already exists for exactly this reason
  (`tests/app/test_workspace_services_live.py` /
  `test_school_workspace_live.py`, real Postgres, `live_db`-marked):
  - **One `live_db` test** for `convert_essay_prompt_draft`: open two real
    connections/transactions, fire concurrent conversions of the same
    draft, assert exactly one succeeds and one gets `WorkspaceNotFoundError`
    (the second transaction's `FOR UPDATE` blocks until the first commits,
    then sees `archived_at IS NOT NULL` and correctly fails) — this is the
    one assertion in the whole feature that a mock literally cannot make.
  - **One `live_db` test** for the lock-order fix: concurrently convert a
    draft while archiving its application, assert both complete without a
    Postgres deadlock error (this is the regression test for the exact bug
    the review caught — a test that would have failed against the
    original plan's draft-first lock order).
  - **One `live_db` or plain unit test** (whichever the existing
    `service_applications` test file already uses for the
    essay/task cascade) for the archive/restore cascade: archiving an
    application archives its non-converted draft prompts, restoring brings
    them back, and a *converted* draft (has `converted_to_essay_id`) is
    left alone by both — this is the "Undo shouldn't lose data" invariant
    called out above, worth a regression pin, and the converted-row
    exclusion is new enough behavior to be worth its own assertion.
- Route-level tests: extend `tests/api/test_workspace_routes.py` with the
  five new endpoints at the same shallow depth as the existing essay route
  tests there (auth required, 404 on missing/foreign draft) — no new test
  file needed if the existing one already parametrizes by resource.
- No frontend component tests beyond what already exists
  (`EssaysRoute.test.tsx` presumably gets one new case for the "save
  prompt for now" path if that file already exercises `NewEssayDialog`;
  check before adding one, don't duplicate coverage that's already
  implicit in existing render tests).

### 9. Build order (dependency-respecting)

1. Migration (`0013_essay_prompt_drafts.sql` + rollback) → apply locally.
2. `models.py` additions (`EssayPromptDraft*`, `ObjectType`,
   `ApplicationDetail.prompt_drafts`).
3. `service_essay_prompt_drafts.py` + the two `service_applications.py`
   cascade helpers + `get_application_detail`'s extra query.
4. `api/routes/essay_prompt_drafts.py` + `main.py` registration.
5. Backend tests (§8) — run before touching the frontend, since the
   conversion transaction is the highest-risk piece and is cheapest to
   verify in isolation.
6. Frontend `types.ts` → `essay-prompt-drafts.ts` client → `keys.ts` →
   `hooks/essay-prompt-drafts.ts` → `events.ts` wiring.
7. Shared `PromptDraftRow` component.
8. `SchoolWorkspace.tsx` integration.
9. `EssaysRoute.tsx` integration (section + `NewEssayDialog` additions).
10. Manual QA pass: add a prompt on School page → confirm it appears on
    Essays page → convert from Essays page → confirm School page reflects
    it live (tests the SSE wiring end-to-end, which no unit test covers).

### Mistakes this plan is specifically designed to avoid

- **Conflating catalog and student-authored prompts** — never touching
  `school_essay_prompts` or its provenance triggers; the new table has no
  `state`/`source`/`verified_at` columns at all, so there is no code path
  that could accidentally treat student text as verified catalog fact.
- **Leaking prompt-drafts into essay counts** — a completely separate
  table and query path means `EssaysSummary`, word-count rollups, and the
  School page's essay progress meter never need an `is_draft` branch
  anywhere.
- **TOCTOU double-conversion** — explicit `FOR UPDATE` lock on the draft
  row before insert+archive, matching the documented rationale already in
  `_require_essay` for the identical race, verified with a real-Postgres
  `live_db` test rather than a mock that can't observe blocking.
- **Lock-order deadlock** (caught by the Codex review, not the original
  plan) — conversion locks the application before the draft, the same
  order `archive_application` already uses, so the two can never deadlock
  each other under concurrency.
- **Violating ADR 0027's "deletes are soft archives, keep-everything"
  rule** (caught by the Codex review, not the original plan) — conversion
  soft-archives the draft with a `converted_to_essay_id` tombstone instead
  of a hard `DELETE`; same UI outcome, zero architecture violation.
- **Undo losing data on cascade** — reusing the exact
  `archived_via_application` + paired archive/restore-in-one-transaction
  shape that already makes essay/task undo safe, with converted rows
  explicitly excluded from the cascade so a converted prompt's tombstone
  is never resurrected by an application restore.
- **Stale cache on one page after mutating from the other** — both the
  optimistic dual-cache writes (the tab that made the change) and the
  `events.ts` SSE switch case (every other tab) are specified in §5 as the
  crux of "the two pages work together perfectly," not an afterthought.
- **A UI section that's unreachable in the state it exists for** (caught
  by the Codex review, not the original plan) — the Essays-page prompts
  section renders outside the `hasNoEssays` branch, so it's visible
  precisely when a student has prompts but no essays yet.
- **A dialog option with no way to submit** (caught by the Codex review,
  not the original plan) — "Save prompt for now" now has an actual prompt
  `Textarea` and word-limit field, not just a footer-button relabel.

## Review history

1. Initial design brief — discovery + UX shape, confirmed by the user.
2. Technical implementation plan — full backend/frontend design, grounded
   in the actual codebase (migrations, service layer, hooks, SSE wiring).
3. **Codex second opinion** (`gpt-5.6-sol`, xhigh reasoning, general focus,
   `AGENTS.md` included) — verdict "plan has issues" (0.99 confidence), 5
   P1 + 5 P2 findings. All 5 P1s verified against the actual code
   (`docs/adr/0027-workspace-service-and-change-events.md`,
   `service_applications.py`'s lock order, `EssaysRoute.tsx`'s render
   branches, `NewEssayDialog`'s conditional fields) and corrected in place
   above, not appended as caveats. 4 of 5 P2s also corrected (blank-prompt
   validation, rollback hygiene, cache completeness, live-DB concurrency
   tests); the 5th (agent-tool cascade side effect) is logged as a
   verify-before-merge follow-up since no prompt-draft agent tool ships in
   this plan.

Plan is implementation-ready pending final user confirmation of this
revision.
