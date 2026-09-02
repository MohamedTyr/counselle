# Essay creation, simplified — erase the school essay prompt catalog

Branch: `worktree-scratch-1` (rename to `refactor/essay-creation` before the PR)
Status: plan, not yet implemented.

---

## 1. Problem

Creating an essay currently routes through a **published, provenance-verified per-school
supplemental prompt catalog** — three Postgres tables, immutability triggers, an
`applicability`/`audience`/`provenance` vocabulary, a separate `essay_prompt_drafts`
entity, and a create dialog with a four-way type select, a school select, a mode toggle,
and a prompt select whose options mix catalog prompts, tracked drafts, and "custom".

**Nothing ever writes to that catalog.** There is no admin route, no seed script, no
pipeline import. `INSERT INTO counselle.school_essay_prompts` appears only inside
`tests/app/test_school_workspace_live.py`. The whole surface was built ahead of a
curation tool that was never made, so in production every school shows *"No catalog data
for the 2025–26 application cycle"* — an empty, honest, useless card, wrapped in
machinery that costs a create dialog with five interacting controls.

The replacement is the model the student actually has in their head:

- **Personal statement** → pick one of the seven standard Common App prompts. No school.
- **Supplement** → type the prompt yourself (or leave it blank) and link it to a school.

That is the whole feature.

### Non-goals

- **`school_requirements` stays.** It shares `SchoolReference`, `Provenance`,
  `applicabilityLabels`, and `audienceDescription` with the prompt catalog, and it is
  what drives the school workspace's Requirements section (fees, testing policy,
  recommendation counts). It is a different feature and the request did not name it.
  **This is the single largest way this change can go wrong** — see §7.1.
- Not rewriting the essay editor, autosave, the library card, filters, or archive/undo.
- Not touching the agent's essay tools. They already treat `prompt` as free text
  (`agent_tools_essays_mutations.py:268-283`) and never mention the catalog — verified by
  full-repo grep. Zero LLM-contract change.
- Not narrowing the `EssayType` union — see §4.2.

---

## 2. The shape of the change

| | Before | After |
|---|---|---|
| DB tables | `school_prompt_groups`, `school_essay_prompts`, `essay_prompt_drafts` + 4 triggers | none |
| `essays` columns | `prompt`, `prompt_ref`, `word_limit` | `prompt`, `word_limit` |
| Routes | `/v1/essays`, `/v1/essay-prompt-drafts` (×4) | `/v1/essays` |
| Create dialog controls | mode toggle, type select (4), school select, prompt select (mixed source) | type segmented (2), then **one** branch |
| School workspace essay cards | School prompts · Prompts you're tracking · Added by you · Historical or unavailable | **Essays** (one card) |
| Prompt vocabulary | ordinal · applicability · audience · provenance · group · choice_min · state | prompt text, or nothing |

Net: three tables, four triggers, two files, ~700 lines of backend, ~600 lines of
frontend, and an entire honesty vocabulary — deleted. About 200 lines added.

---

## 3. The UX

Two surfaces, and they are deliberately **not** the same interaction, because the amount
of undecided information is different.

### 3.1 School workspace → Essays section — inline, no overlay

Context is already fixed: this school, this application, therefore Supplement. The only
open question is *"do you have the prompt text yet?"* That is one field. A dialog for one
field is the modal-as-first-thought failure the product register names, and a popover
adds an overlay to a decision that has no branches.

**Replace all four cards with one card titled "Essays"**, holding this application's
non-personal-statement essays as a §17.2 list (one raised panel, `--hairline` rules), and
a header **`[+ Add essay]`** button that toggles an inline composer row at the top of the
list:

```
┌─ Essays ─────────────────────────────────────── [+ Add essay] ─┐
│                                                                 │
│   Prompt (optional)                                             │  ← composer is the
│   ┌──────────────────────────────────────────────────────────┐  │    list's first row.
│   │ Paste or type the prompt — leave it blank if you don't   │  │    NO border, NO
│   │ have it yet                                               │  │    nested panel
│   └──────────────────────────────────────────────────────────┘  │    (rule 9).
│   Word limit (optional) [    ]              [Cancel] [Add essay] │
│  ──────────────────────────────────────────────────────────────│
│  Why Northwestern?                        Drafting · 180/300    │
│  ──────────────────────────────────────────────────────────────│
│  Untitled supplement                      Not started · No prompt│
└─────────────────────────────────────────────────────────────────┘
```

**The composer draws no border and no fill.** It is the first row of the list, separated
from the essays below by the same `--hairline` rule that separates them from each other.
A bordered sub-panel inside `Card` (which is itself `rounded-2xl` + border + shadow) is a
card inside a card — rule 9, and §17.2's "never both at once."

This is *not* the same component as the composer being deleted from `PromptDraftsCard`
(`SchoolWorkspace.tsx:622-652`), which is a single-row `InputGroup`: one `Input`, one
inline button, no textarea, no second field, no cancel. Ours is a two-field block with
its own actions. Build it as `EssayPromptComposer` (§6.2) and share it with §3.2 —
`InputGroup` is the wrong primitive here.

- **An empty prompt field *is* "no prompt."** No radio, no second button, no mode. One
  affordance that degrades.
- On submit: `POST /v1/essays` with `application_id`, `essay_type: "Supplement"`,
  `prompt: text.trim() || null`, `word_limit`, `title: "{school} supplement"` → navigate
  to `/app/essays/{id}`. Identical to today's `addEssay()`
  (`SchoolWorkspace.tsx:718-726`) plus the two optional fields.
- **Empty state** (§13.2): `[BookOpenText]` **"No essays yet"** / "Add a supplement for
  this school, with or without the prompt." / `[Add essay]`.
- The "Copy research request" and "Open Counselle" buttons from the old empty state
  (`SchoolWorkspace.tsx:776-785`) **move to the new empty state as secondary actions** —
  they were the genuinely useful part of that card and they still are. §13.2 allows one
  secondary; keep `[Copy research request]` (the higher-value one for "I don't have the
  prompt") and drop the Counselle link, which the sidebar already provides.
- The composer is `EssayPromptComposer` (§6.2), shared verbatim with §3.2's supplement
  branch — one prompt-entry pattern in the app (rule 21).

### 3.2 Essays page → "New essay" — one dialog, one branch

Here the information *is* undecided: type, school, prompt. Keeping the existing `Dialog`
is right, and it is what rule 19 asks for (extend, don't rewrite) — the change is
entirely what lives inside it.

```
┌─ New essay ────────────────────────────────────────── ✕ ─┐
│  Which kind of essay are you starting?                    │
│                                                            │
│  ┌──────────────────────┬───────────────────────────────┐ │
│  │ Personal statement   │        Supplement             │ │  ← SegmentedControl
│  └──────────────────────┴───────────────────────────────┘ │
│                                                            │
│  ── Personal statement branch ───────────────────────────  │
│  Choose a prompt                              650 words    │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ ○ 1  Some students have a background, identity,      │ │  ← RadioGroup in a
│  │      interest, or talent that is so meaningful…      │ │    ScrollArea,
│  │ ○ 2  The lessons we take from obstacles we encounter…│ │    max-h-[22rem]
│  │ ○ …                                                   │ │
│  │ ○ 7  Share an essay on any topic of your choice…     │ │
│  │ ●    I haven't chosen a prompt yet         ← default  │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ── Supplement branch ───────────────────────────────────  │
│  School                                                    │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 🔍 Search your schools…                               │ │  ← Command, scoped to
│  │    Northwestern University          Reach             │ │    useApplications()
│  │    Rice University                  Target            │ │
│  └──────────────────────────────────────────────────────┘ │
│  Prompt (optional)                                         │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Paste or type the prompt — leave it blank if you     │ │
│  │ don't have it yet                                     │ │
│  └──────────────────────────────────────────────────────┘ │
│  Word limit (optional)  [    ]                             │
│                                                            │
│                                    [Cancel]  [Create essay] │
└────────────────────────────────────────────────────────────┘
```

**Personal statement branch**
- `RadioGroup` (`components/ui/radio-group.tsx`), **not** a `Select`. A student has to
  *read* seven ~50-word prompts to pick one; a dropdown that shows one at a time and
  hides six turns a reading task into a scrolling task. Full text visible, in a
  `ScrollArea` capped at `max-h-[22rem]` so the dialog never outgrows the viewport.
  `RadioGroupItem` is a bare Radix primitive with no label layout — **copy the existing
  radio + multi-line-label composition from `ClarifyOptionRow`**
  (`features/ai-chat/components/clarify/ClarifyQuestion.tsx`) rather than inventing a
  second one (rule 21).
- The seventh Common App prompt already *is* "any topic of your choice," so there is no
  "write my own" option — it would duplicate prompt 7. There **is** an eighth radio,
  **"I haven't chosen a prompt yet"**, which creates the essay with `prompt: null`.
  Forcing a choice before the student has made one is friction, and the prompt is
  editable in the editor afterwards.
- **That eighth option is the default selection**, so the PS branch opens with a valid
  state and `[Create essay]` is never blocked. Pre-selecting prompt 1 instead would put a
  prompt in the student's mouth that they never chose — the §4.4 fabrication, reborn as a
  default. It also keeps `EssaysRoute.test.tsx:369-402` passing, which opens the dialog
  and clicks straight through to Create essay with no intermediate selection.
- Word limit is a static caption (**"650 words"**), not a field — the Common App limit is
  invariant. Selecting "I haven't chosen a prompt yet" still sets `word_limit: 650`,
  because that limit is true of every Common App personal statement regardless of prompt.
- No school picker. Title defaults to `"Personal statement"`.

**Supplement branch**
- School picker: `Command` / `CommandInput` / `CommandList`, the same composition
  `AddSchoolDialog.tsx:307-379` already uses — but scoped to `useApplications()`, the
  student's own list, since a supplement links to an application row that must already
  exist (`_validate_application`, `service_essays.py:560-576`, does not create one).
- **Zero schools in the list** — do not silently disable the segment. Render an inline
  §13.2 empty inside the school field: **"No schools yet"** / "A supplement links to one
  of the schools on your list." / `[Add school]`, which opens `AddSchoolDialog`. Rule 34:
  an absent value renders as words.
- Prompt `Textarea` + word-limit field, **the exact same composer component as §3.1** —
  one prompt-entry pattern in the app, not two (rule 21).
- Title defaults to `"{school} supplement"` — `defaultEssayTitle`
  (`EssaysRoute.tsx:118-126`) is already correct and needs no change. The catalog-ordinal
  branch to delete is in the **`createEssay` handler at `EssaysRoute.tsx:623-626`**, not
  inside `defaultEssayTitle`.

**Copy** (§13.4 — sentence case, second person, say the noun)

| Slot | Text |
|---|---|
| Dialog title | New essay |
| Dialog description | Pick the kind of essay you're starting. You can change any of this later. |
| Segmented label | `label="Essay type"` (the component's own required prop — it has no `aria-label`; `segmented-control.tsx:33-40`), options `Personal statement` / `Supplement` |
| PS group label | Choose a prompt |
| PS caption | 650 words |
| PS opt-out | I haven't chosen a prompt yet |
| School label | School |
| School search placeholder | Search your schools… |
| Prompt label | Prompt (optional) |
| Prompt placeholder | Paste or type the prompt — leave it blank if you don't have it yet |
| Word-limit label | Word limit (optional) |
| Submit | Create essay |
| Submit, pending | Creating… |

**Motion.** The branch swap gets **no transition.** The segmented thumb already carries
the state change, and a 150 ms crossfade on every toggle of a binary control is
decoration, not state (§12.1, product register). The dialog keeps its existing
enter/exit. This is a deliberate call, and worth a comment at the site so nobody
"fixes" it later.

**A11y**
- `SegmentedControl` and `RadioGroup` supply `radiogroup`/`radio` roles and arrow-key
  roving focus from Base UI / Radix — do not hand-roll (§16.1).
- On branch swap, move focus to the new branch's first control (the PS radio group, or
  the school `CommandInput`). Without this, focus is left on a control that no longer
  exists in the DOM and lands back on `<body>`.
- Dialog focus trap and Escape come from Radix, already in `dialog.tsx`.
- Disabled-submit reason goes in an `aria-live="polite"` `role="status"` region, the
  pattern already at `EssaysRoute.tsx:467-472`.
- **Press feedback is a 7% background mix, not `transform: scale(0.97)`.** DESIGN.md
  rule 31 ("hover is never a transform") and rule 22 govern here and override the
  generic design-engineering default.

---

## 4. Decisions, and what was rejected

### 4.1 The seven prompts live in the frontend

`frontend/src/features/essays/personal-statement-prompts.ts`, exporting
`{ id, ordinal, text }[]` plus `PERSONAL_STATEMENT_WORD_LIMIT = 650`.

*Rejected:* a `config/assets/personal_statement_prompts.yaml` asset served through
`GET /v1/config` (the `starter_prompts.yaml` pattern, `api/routes/config.py:103`). It is
the repo's convention for tunable content, and it would be the right answer **if the
agent needed these strings** — but it does not. The agent reads the essay's own `prompt`
field, which carries the chosen text copied at creation. Adding a YAML asset, a settings
loader, a `/v1/config` key, and a frontend fetch to serve seven strings that only one
dialog renders is speculative plumbing.

*Escape hatch:* the shape is a flat list of `{id, ordinal, text}`. If the agent ever
needs it, moving it to a config asset is a mechanical change to one import.

**Honesty requirement.** We are quoting a third party's prompts verbatim to a student, so
principle 3 applies:
- Verify all seven against commonapp.org **before merge** — do not transcribe from
  memory or from this plan.
- The file carries `// Source: https://www.commonapp.org/… · verified YYYY-MM-DD` and a
  `CYCLE` constant, because Common App has revised these before and will again.
- This file **supersedes** `commonAppPrompt` in `essay-content.ts:9-10` (see §4.4). One
  source of truth for prompt 1, not two.

### 4.2 `EssayType` keeps all four values; only the *creation UI* narrows to two

`EssayType = Literal["Personal statement", "Supplement", "Scholarship", "Optional"]`
(`models.py:50`) is Pydantic-only — `migrations/0007_workspace.sql:28` is plain
`essay_type text NOT NULL DEFAULT 'Supplement'`, no CHECK. Narrowing the Literal would
make any existing `Scholarship`/`Optional` row **fail to parse on read**, turning a UI
simplification into a 500 on the essays list.

And it is not only legacy rows: the **agent's own tool contract documents and creates
them today** (`agent_tools_essays_mutations.py:277-278`), and a live test exercises it
(`tests/app/test_workspace_services_live.py:742`). Narrowing the union would break the
LLM contract and a passing test, not just old data.

So: the dialog offers two, the union keeps four, the agent keeps all four, existing rows
keep working, and `essay-filters.ts` is untouched. If the owner wants those two types
gone for good, that is a data migration and its own change.

### 4.3 Inline for the school workspace, dialog for the essays page

Justified in §3. The short version: the school workspace has one undecided field, the
essays page has three plus a branch. Using the same container for both would either put
an overlay in front of a one-field action or cram a branching form into a card.

### 4.4 `getEssayPrompt` fabricates a prompt, and that has to stop

`essay-content.ts:45-55`:

```ts
if (essay.type === "Personal statement") return commonAppPrompt;
return `${essay.schoolName} ${essay.type.toLowerCase()}: respond directly to the prompt, …`;
```

When an essay has no prompt, the editor's `PromptMenu` renders **an invented one** —
Common App prompt 1 for any promptless personal statement (a prompt the student never
chose), and a generated instruction sentence for any promptless supplement, presented in
the same chrome as a real prompt. That is the "never lie to a student" carve-out, broken,
today.

It is in scope because this change makes **"no prompt" a deliberate, first-class choice**
— the fabrication goes from a rare edge case to something a student will hit on purpose.

Fix: `getEssayPrompt` returns `null` when there is no prompt, and `PromptMenu` renders
**"No prompt"** (rule 34 — an absent value renders as words) with an inline affordance to
add one. This is honesty-critical, so it gets a test (§8).

---

## 5. Backend

### 5.1 Migration `0015_drop_essay_prompt_catalog.sql`

Header `-- depends: 0014_response_mode`, with a `.rollback.sql` sibling
(`0011_school_workspace.sql:30-230` is the source for the rollback's DDL).

Order matters — `school_essay_prompts` FKs to `school_prompt_groups`:

1. **Backfill first, before anything is dropped:**
   ```sql
   UPDATE counselle.essays e
      SET prompt = p.prompt, word_limit = COALESCE(e.word_limit, p.word_limit)
     FROM counselle.school_essay_prompts p
    WHERE e.prompt_ref = p.id;
   ```
   Catalog-linked essays deliberately store `prompt = NULL` and read the text through the
   join (`service_essays.py:107-108`). Drop the column without this and those essays
   silently lose their prompt. Expected to affect zero rows in production; it is the
   difference between "expected zero" and "guaranteed zero".
2. `DROP INDEX counselle.essays_application_prompt_active_idx;`
3. `ALTER TABLE counselle.essays DROP COLUMN prompt_ref;`
4. Drop trigger + function `protect_published_essay_prompt_facts`.
5. Drop trigger + function `protect_published_prompt_group_facts`.
6. `DROP TABLE counselle.school_essay_prompts;`
7. `DROP TABLE counselle.school_prompt_groups;`

Leaves `school_requirements` and `protect_published_requirement_facts` **untouched**.

### 5.2 Migration `0016_drop_essay_prompt_drafts.sql` — the destructive one

Unlike the catalog tables, `essay_prompt_drafts` has a live write path
(`api/routes/essay_prompt_drafts.py`) that real students can reach. **Convert before
dropping** — a draft is a supplement essay missing only a title:

```sql
INSERT INTO counselle.essays (user_id, application_id, title, essay_type, status, prompt, word_limit)
SELECT d.user_id, d.application_id, 'Untitled supplement',
       'Supplement', 'Not started', d.prompt, d.word_limit
  FROM counselle.essay_prompt_drafts d
 WHERE d.archived_at IS NULL AND d.converted_to_essay_id IS NULL;

DELETE FROM counselle.workspace_changes WHERE object_type = 'essay_prompt_draft';
DROP TABLE counselle.essay_prompt_drafts;
```

**The title is a flat literal, deliberately.** `counselle.applications` has **no
`school_name` column** (`migrations/0007_workspace.sql:4-15`) — school names are resolved
at read time from the CDS catalog via `school_identities()`
(`app/workspace/service_utils.py`), so no `.sql` migration can produce a school-qualified
title. That is also why the real `convert_essay_prompt_draft`
(`service_essay_prompt_drafts.py:205-218`) takes `title` as a required caller-supplied
field (`models.py:486`) instead of deriving one. If school-qualified titles are wanted,
this step becomes a one-off Python script using `school_identities()` — not this
migration. Verify the `essays` NOT NULL column list against `0007_workspace.sql` before
running; `content` in particular must either have a default or be supplied.

This is the one step that destroys student-authored data if the conversion is wrong.
**Rehearse against a copy of the target database and report the row count before
running it.** Archived drafts are intentionally not converted — the student deleted them.

### 5.3 Delete

- `app/workspace/service_essay_prompt_drafts.py` (337 lines)
- `api/routes/essay_prompt_drafts.py` (111 lines)

### 5.4 Edit

| File | Change |
|---|---|
| `app/workspace/models.py` | Remove `EssayPromptDraft{,Summary,Create,Convert}` (455-487) and the draft-text block — `PROMPT_DRAFT_TEXT_MAX_LENGTH` (438), `_reject_blank_prompt` (441-445), `PromptDraftText` (**448-452**, through its closing `]`); remove `SchoolPromptGroup`/`SchoolEssayPrompt` (914-933); drop `prompt_ref` from `Essay`/`EssaySummary`/`EssayCreate`/`EssayPatch` (361, 386, 410, 421); drop `prompt_groups`/`prompts` from `SchoolReference` (1002-1003), **keep `requirements`/`test_policy`**; drop `prompt_drafts` from `ApplicationDetail` (1012); drop `"essay_prompt_draft"` from `ObjectType` (55) |
| `app/workspace/service_essays.py` | Drop the `CASE WHEN e.prompt_ref…` (31-32, 46-47, 60-61) **and** the `LEFT JOIN counselle.school_essay_prompts` lines, which are separate — **39, 54, 68** — plus the same pair in `duplicate_essay` (327-332); delete `_validate_prompt_link` (579-620) and its 5 call sites (104, 161, 271, 284, 413); drop `prompt_ref` from `_update_essay_row` (631, 649-650); **collapse `_essay_link_identity` (556-557) to `application_id` only, keeping the TOCTOU retry** — see §7.2 |
| `app/workspace/service_applications.py` | Delete `_validate_application_prompt_cycle` (643-667) + call site (252-255); delete `_archive/_restore_linked_prompt_drafts` (758-791) + 4 call sites (352, 399-404, 441, 479-484); drop the `prompt_draft_rows` query (534-543) and `prompt_drafts=` (548); simplify the essay SELECT (517-533) |
| `app/workspace/service_reference.py` | **Six edits, not three** — miss any of the last three and `get_school_reference` raises `NameError` on the first school-workspace load: delete the `group_rows`/`prompt_rows` queries (38-66); delete `_prompt_group`/`_prompt` (104-127); delete the two `SchoolReference` kwargs (88-89); **delete the `groups =` / `prompts =` comprehensions (79, 80)**; **rewrite `populated=` (85-87) to `bool(requirements or (test_policy and test_policy.available))`**; **drop the now-dangling `SchoolEssayPrompt, SchoolPromptGroup` imports (12-13)**. Keep `requirement_rows`, `_requirement`, `_compatible_test_policy` |
| `api/main.py` | Drop the `essay_prompt_drafts` import (50) and `include_router` (254) |
| `domain/mutation_receipts.py` | Drop `"prompt_link"` from `EssayFieldKey` (66) — declared, never emitted |

No agent-tool file changes. Verified: `prompt_ref`, `school_essay_prompts`, and
`essay_prompt_draft` appear in **zero** `agent_tools*.py` files.

---

## 6. Frontend

### 6.1 Delete

- `features/essays/PromptDraftRow.tsx`
- `api/workspace/hooks/essay-prompt-drafts.ts` (255 lines)
- `api/workspace/essay-prompt-drafts.ts`

### 6.2 Add

- `features/essays/personal-statement-prompts.ts` — the seven prompts + `650` (§4.1)
- `features/essays/EssayPromptComposer.tsx` — prompt `Textarea` + word-limit field, the
  one shared composer used by both §3.1 and §3.2's supplement branch
- `features/essays/NewEssayDialog.tsx` — extract the rewritten dialog out of
  `EssaysRoute.tsx`. It is currently 376 inline lines in a 917-line route file; the
  replacement is smaller but still belongs in its own module (files < 800 lines,
  organize by feature)

### 6.3 Edit

| File | Change |
|---|---|
| **`pages/school-detail-page.tsx`** | **Delete the `"prompts"` / `"prompt_groups"` checks from `hasValidReference` (lines 8-27).** Do this or every school workspace page renders an error instead — see §7.0 |
| `features/essays/EssaysRoute.tsx` | Replace `NewEssayDialog` (148-524) with the §3.2 flow; delete the catalog-ordinal title branch in `createEssay` (623-626); delete the "Prompts you're tracking" panel (729-761), `promptDraftsBySchool` (566-583), all five draft hooks, `promptDraftUndo`, `applicabilityLabels` (77-83), `describeAudience` (132-141), `draftPromptValuePrefix`/`customPromptValue`/`unselectedPromptValue`; trim `defaultEssayTitle` (118-126) to drop the ordinal branch |
| `features/schools/SchoolWorkspace.tsx` | Replace `EssaysSection`'s four cards (735-920) with the §3.1 single card; delete `PromptRow` (399-577) and `PromptDraftsCard` (579-686). **Keep `Provenance` (297-315), `applicabilityLabels` (141-147), `audienceDescription` (269-295)** — `RequirementsSection` still uses all three |
| `features/essays/essay-content.ts` | `getEssayPrompt` returns `null` instead of a fabricated prompt; delete `commonAppPrompt` (§4.4) |
| `features/essays/EssayEditorHeader.tsx` | `PromptMenu` renders "No prompt" + an add affordance when `getEssayPrompt` returns `null`. **Also fixes known debt #4** — line 16 maps `Drafting` to the dead `bg-info` class, so that dot currently renders with no fill |
| `api/workspace/types.ts` | Delete `SchoolEssayPrompt` (344-355), `SchoolPromptGroup` (337-342), `EssayPromptDraft*` (238-267); drop `prompts`/`prompt_groups` from `SchoolReference` (381-389); drop `prompt_drafts` from `ApplicationDetail` (323-329); drop `prompt_ref` from `EssaySummary`/`EssayCreate`/`EssayPatch` (183, 216, 228); drop `"essay_prompt_draft"` from `WorkspaceObjectType`. **Keep `RequirementApplicability`/`SchoolRequirement`** |
| `api/workspace/hook-utils.ts` | Delete `tempEssayPromptDraft` (143-169); drop `prompt_ref` from `tempEssay` (116-141) |
| `api/workspace/keys.ts` | Delete the `essayPromptDrafts` key group (19-22) |
| `api/workspace/hooks/applications.ts` | Drop the `essayPromptDrafts.list()` invalidations at **275 and 307** — easy to miss, they live in the applications module |
| `api/workspace/events.ts` | Drop `"essay_prompt_draft"` from `objectTypes` (17-24) and its `invalidateFromChange` case (89-96). **Add a `default:` branch to that switch** — see §7.3 |
| `test/render-app.tsx` | Remove `workspaceReferenceFixture.prompts`/`.prompt_groups` (94-95), both `prompt_drafts: []` (330, 804), both `/v1/essay-prompt-drafts` mock routes (337-339, 808-810) |

---

## 7. The five ways this goes wrong

### 7.0 A runtime guard silently gates the whole school page on the catalog

**Highest severity. Neither research pass caught this; the review pass did.**
`pages/school-detail-page.tsx:8-27`:

```ts
"prompts" in reference && Array.isArray(reference.prompts) &&
"prompt_groups" in reference && Array.isArray(reference.prompt_groups) &&
```

`hasValidReference` is a **runtime** shape check, not a type-level one. The moment §5.4
stops the backend sending `prompts`/`prompt_groups`, this returns `false` for every
school, and line 49 renders **"Could not load school workspace"** instead of the page —
for every school, permanently. TypeScript cannot catch it: the check uses `in`, so it
compiles fine against the trimmed type, and no test covers the guard.

Delete both clauses. Keep the `requirements`, `status`, and `populated` clauses.

### 7.1 Deleting the requirements catalog by association

`SchoolReference` bundles prompts *and* requirements. `Provenance`,
`applicabilityLabels`, and `audienceDescription` are used by both sections — and are
**duplicated, not shared**, between `SchoolWorkspace.tsx` and `EssaysRoute.tsx` with
slightly different wording. The correct outcome:

- `EssaysRoute.tsx` copies → **delete** (become fully dead)
- `SchoolWorkspace.tsx` copies → **keep** (Requirements still calls them)

A grep-and-delete pass on "applicability" or "provenance" removes the Requirements
section. Verify `RequirementsSection` still renders before committing.

(Precision note: `EssaysRoute.tsx` has no `Provenance` *component* — its provenance
rendering is inline JSX at 486-488. The genuinely duplicated symbols are
`applicabilityLabels` and `describeAudience`/`audienceDescription`.)

### 7.2 The TOCTOU guard is half prompt, half application

`_essay_link_identity` returns `(application_id, prompt_ref)` and `update_essay` /
`restore_essay` compare it to detect "essay links changed concurrently; refresh and
retry." Remove `prompt_ref` and the tuple is a 1-tuple — the temptation is to delete the
guard as vestigial. **Don't.** `application_id` is still user-mutable and still racy.
Collapse the tuple, keep the retry.

### 7.3 The SSE switch has no `default:` branch

`events.ts:89-96` handles `"essay_prompt_draft"` inside an exhaustive `switch` with no
fallthrough. Backend and frontend do not deploy atomically. If the backend still emits
`essay_prompt_draft.*` for a few minutes after the frontend ships, `parseWorkspaceEvent`
parses it fine and `invalidateFromChange` silently no-ops — a stale cache with no error.
Add a `default:` that invalidates broadly (or logs), and **deploy backend first**.

### 7.4 `npm run typecheck` will not catch this

Removing a field from a type the app no longer reads produces no error. Per the recorded
finding, only `npm run build` (`tsc -b`) catches undefined identifiers.
**`npm run build` is the gate, not `typecheck`.**

Related: `render-app.tsx` is shared by nearly every workspace and essay test. A partial
edit there breaks unrelated suites with confusing failures. Edit it completely in one go.

Also unverified and worth one grep before starting: whether `api/chat/types.ts`'s
mutation-receipt body union references `SchoolEssayPrompt` or `EssayPromptDraft`.
`EssayMutationWidget.tsx` itself is clean (it documents "Prompt contents never appear").

---

## 8. Tests

Per §18 and the no-reflexive-tests rule — a test earns its place.

**Delete** (the feature is gone): `tests/api/test_workspace_routes.py` draft-router cases
(25, 56, 287-301); `tests/app/test_workspace_services_live.py` draft-lifecycle tests
(1426, 1483, 1539, 1628); `tests/app/test_school_workspace_live.py` prompt-link tests
(252, 348, 410, 469, 504) — **keep the `school_requirements` tests in that file**;
`EssaysRoute.test.tsx`'s "creates a school essay linked to the selected catalog prompt"
(404-474) — verified to be the only catalog-specific test in that file.

**Split, do not delete** — two `SchoolWorkspace.test.tsx` tests assert catalog *and*
requirements behavior in the same block, and deleting them wholesale drops the very
Requirements coverage §7.1 exists to protect:
- **72-104** — also asserts `"Common items to verify"` and the absence of
  `"Published school requirements"`.
- **157-188** — also opens the "Application fee" accordion and asserts
  `"No tracking needed for a cataloged not-required item."` plus the absence of
  `"Tracking status for Application fee"` / `"Add task for Fee"`.

Keep the requirements halves; delete only the prompt assertions.

**Update** — assert catalog-agnostic behavior through markup that is changing:
`EssaysRoute.test.tsx`'s "shows distinct first-run and zero-filter-match empty states"
(369-402) — it opens the dialog and clicks straight to Create essay, which keeps working
because the PS branch defaults to "I haven't chosen a prompt yet" (§3.2).
`essays-model.test.ts` **imports `commonAppPrompt` (3-4) and asserts the fabrication at
310-320** — it will fail to import once §4.1/§4.4 land; rewrite its assertions to expect
`null`. `AddSchoolDialog.test.tsx` only needs `prompt_drafts: []` dropped from a fixture.

**Write two, both honesty-critical:**
1. `getEssayPrompt` returns `null` for a promptless essay of either type, and
   `PromptMenu` renders "No prompt" — §4.4, the fabrication fix.
2. Migration `0016`'s conversion preserves every active draft's `prompt` and
   `word_limit` as an essay — the one step that can destroy student data.

**Do not write:** a test per removed field, or a render test for the new dialog.

**Gates:** `uv run pytest -m "not live_llm and not live_search and not live_db"` ·
`uv run ruff check . && uv run mypy .` · `cd frontend && npm run build && npm test`.

---

## 9. Order of work

1. **Verify the seven Common App prompts** against commonapp.org. Nothing else starts
   until the strings are right. (§4.1)
2. Backend: models → services → routes → `api/main.py` → delete the two files. Keep
   `pytest`/`mypy` green.
3. Migration `0015` (catalog). Apply locally, confirm the essays list still loads.
4. Migration `0016` (drafts). **Report the pre-conversion row count and get sign-off
   before running it anywhere with real data.** (§5.2)
5. Frontend data layer: **`pages/school-detail-page.tsx` first (§7.0)**, then `types.ts`,
   `keys.ts`, `hook-utils.ts`, `events.ts`, `hooks/applications.ts`, delete the two draft
   modules, fix `render-app.tsx` completely.
6. `SchoolWorkspace.tsx` §3.1 — **load a school page in the browser** and verify both the
   new Essays card and the untouched Requirements section render. (§7.0, §7.1)
7. `personal-statement-prompts.ts` + `EssayPromptComposer.tsx` + `NewEssayDialog.tsx`,
   wire into `EssaysRoute.tsx`.
8. `getEssayPrompt` + `PromptMenu` honesty fix, with its test. (§4.4)
9. Test cleanup, then the full gate set. Check the dialog at 375 / 768 / 1440.
10. Delete `plans/school-essay-prompts-draft.md` and the catalog half of
    `plans/school-workspace.md` — scratch plans for a feature that no longer exists.
    Nothing in `docs/`, `specs/`, or the ADRs describes this catalog, so there is no
    permanent documentation to update. Confirm that with a grep before closing.

---

## Implementation note (added at close-out, after the six commits landed)

This plan shipped as written, with the following differences between what was planned and
what the six commits (`4b48934` → `3f78127`, on top of `main` tip `2217fbd`) actually did.
Verified against `git log 2217fbd..HEAD` and the current code, not assumed.

- **Migrations renumbered `0015`/`0016` → `0017`/`0018`.** §5.1/§5.2 named
  `0015_drop_essay_prompt_catalog.sql` and `0016_drop_essay_prompt_drafts.sql`. By the time
  this branch was rebased onto `main`, `main` already had migrations at `0015` (`cds_admin`)
  and `0016` (`cds_pending_edit_base_extraction`), so the two drop migrations shipped as
  `migrations/0017_drop_essay_prompt_catalog.sql` and
  `migrations/0018_drop_essay_prompt_drafts.sql`. Same content and ordering, different numbers.
- **§7.0's runtime guard didn't exist to patch.** The plan's highest-severity risk was a
  `hasValidReference` check in `pages/school-detail-page.tsx:8-27` that would silently break
  every school page once `prompts`/`prompt_groups` stopped being sent. By implementation time,
  `main` had already refactored that page — `pages/school-detail-page.tsx` is now a one-line
  re-export of `SchoolDetailRoute` (`frontend/src/features/schools/SchoolDetailRoute.tsx`), and
  neither file contains a `prompts`/`prompt_groups` shape check. There was nothing to delete.
- **`SchoolWorkspace.tsx` had already been split.** §6.3/§7.1 targeted edits at
  `frontend/src/features/schools/SchoolWorkspace.tsx`. That file no longer exists as one module
  — `main` had split it into `SchoolEssaysSection.tsx`, `SchoolRequirementsSection.tsx`,
  `school-workspace-fields.tsx`, and `school-workspace-format.ts`. The §3.1 single-card Essays
  rewrite landed in `SchoolEssaysSection.tsx`; the `Provenance`/`applicabilityLabels`/
  `audienceDescription` code the plan said to keep for Requirements lives in
  `SchoolRequirementsSection.tsx` / `school-workspace-fields.tsx` and was untouched.
- **The "650 words" caption and personal-statement `word_limit` were deliberately dropped.**
  §3.2 specified a static "650 words" caption and `word_limit: 650` on every personal-statement
  essay, calling it "the Common App limit is invariant." When the seven prompts were verified
  against a primary Common App source (§9 step 1's own gate), that figure could not be
  confirmed for the personal essay itself — see the comment in
  `frontend/src/features/essays/personal-statement-prompts.ts` (the commonly cited "650 words"
  applies to a different field in Common App's own announcement, not confirmed as the personal
  essay's limit). Per the honesty carve-out (never state a value that isn't verified), the
  caption and the `word_limit` default were omitted rather than shipped on an unconfirmed
  number; personal-statement essays get `word_limit: null` like any other unspecified essay.
- **`PromptMenu` gained a full add/edit form beyond what §3/§4.4 described.** The plan's
  honesty fix for `getEssayPrompt`/`PromptMenu` (§4.4, §6.3) called for `PromptMenu` to render
  "No prompt" plus "an inline affordance to add one." Implementing that literally — with "no
  prompt" as the default state for every newly created essay per §3's design — left no path to
  ever add a prompt after creation, which is a regression against the old (fabricating) editor,
  not just a fix. `EssayEditorHeader.tsx` was extended with an actual editable-draft add/edit
  form inside `PromptMenu` (`usePromptMenuState`/`useEditableDraft`), so a student can attach or
  change a prompt from the editor at any time, not only at essay creation.
- **Migration `0018` added an archived-application guard the plan didn't have.** §5.2's
  conversion `INSERT ... SELECT` had no filter on the owning application's `archived_at`.
  Implementation added `AND a.archived_at IS NULL` (via a `NOT EXISTS` check against
  `counselle.applications`) so that drafts belonging to an archived application are not
  resurrected as essays by the migration — a student who archived a school shouldn't have a
  stray essay reappear for it. See the header comment in
  `migrations/0018_drop_essay_prompt_drafts.sql` for the full rationale, including why this
  matters given the application-archive cascade for drafts was removed in the same change.
- **Two runtime bugs were found and fixed that the plan did not anticipate**, both in SSE
  change-replay (`api/routes/workspace_events.py`, commit `4b48934`):
  1. `replay_changes`/`_event_from_row` previously raised a `ValidationError` on any row whose
     `object_type` no longer parses against the current `ObjectType` Literal. Historical
     `essay_prompt_draft` rows remain in `counselle.workspace_changes` until a later cleanup, so
     without a fix, any user with such history in their catch-up window would have their entire
     SSE replay batch aborted by one old row. Replay now skips rows with a retired/unknown
     `object_type` instead of raising.
  2. Replay pagination advanced on `len(replayed)` (events that survived the above filtering)
     rather than the number of rows actually read. Once retired-type rows were filtered instead
     of raising, a page consisting entirely of filtered-out rows would look like `0` events and
     be mistaken for "no more rows," truncating the replay early. Pagination now advances and
     terminates on rows read (`row_count`), not events emitted.
- Everything else — the migration content and order, the frontend delete/add file list, the
  `EssayType` union staying at four values, the dialog's two-branch shape, the shared
  `EssayPromptComposer`, and the test cleanup in §8 — landed as planned.
