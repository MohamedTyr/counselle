# Implementation Plan: Agent Workspace Tools — Phase 3: Essays

Status: Draft for review
Date: 2026-07-10
Branch: feat/mvp3-frontend-prototype (same working branch as the task/school tools)

## Goal

Give the Counselle agent full control over the student's essays, split into two
layers that match how the agent thinks:

- **General control** — the essay library as a workspace object, exactly like
  tasks and schools: view, create, update metadata, duplicate, archive, restore.
- **Specialized control** — the essay *document* itself, presented to the agent
  as a markdown file. `read_essay` shows the essay as markdown; `edit_essay`
  applies exact-string `old_text → new_text` replacements (the Claude-Code Edit
  mechanic, which LLMs already execute reliably); `write_essay` replaces the
  full draft.

The agent never sees or produces Tiptap JSON. A projection module converts both
ways and preserves formatting the agent cannot express.

## Current state (verified 2026-07-10)

- `app/workspace/service_essays.py` is complete: list/get/create/update/
  duplicate/archive/restore with change log (`actor`), SSE events, server-side
  `word_count` derivation from Tiptap content, and optimistic concurrency
  (`expected_updated_at` on `EssayPatch` → `_check_not_stale`) built precisely
  for the "student autosaved between agent read and agent write" race.
- Essay content is Tiptap JSON (`EMPTY_TIPTAP_DOC` default). The mvp3-frontend
  editor is StarterKit v3 (heading 1–2, lists, blockquote, bold/italic/strike,
  hardBreak, horizontalRule, codeBlock — **plus link and underline, which v3
  bundles by default**; the toolbar doesn't expose underline but Ctrl+U does)
  plus `textAlign` and `textStyle/fontFamily` attrs that markdown cannot
  express. Underline, like fontFamily, survives only via block reuse — an
  agent edit inside an underlined block drops it (named limitation, ADR 0030).
- `comments` / `suggestions` jsonb columns exist but have no service or UI
  surface beyond counts. The mvp3-frontend essays pages are still
  fixture-wired; live wiring is separate work and does not block these tools.
- Task tools (`agent_tools.py` + `agent_tools_mutations.py`) and school tools
  (`agent_tools_schools*.py`) define the template: `ToolCtx`, direct service
  calls with `actor="counselle"`, fixed-key-order rows with nulls omitted,
  error payloads with `retryable` + `recovery` (ADR 0029).
- Mount point: `build_workspace_tools` (agent_node.py:571 mounts when
  `user_id and deps.app_pool and workspace_events`). Tool gating:
  `tool_specs.py` (`"auth"`). Timeline: `step_labels.yaml` `kind: workspace`.
  Prompt: `counselor.md` workspace playbooks.
- `markdown-it-py` is already in `uv.lock` (transitive); promote to an explicit
  dependency in `pyproject.toml` since we import it directly.

## Binding design decisions (locked with user 2026-07-10 — do not relitigate)

1. **Direct edits, not suggestions.** Agent essay writes apply immediately with
   `actor="counselle"` change events, consistent with task/school tools. The
   `suggestions` jsonb propose/accept flow belongs to the Essay Studio
   (specs/mvp3-essay-studio) and is out of scope; `edit_essay`'s edit payload
   shape is designed so a suggestions layer can wrap the same mechanic later.
2. **Markdown projection, block-preserving.** Reads render Tiptap → markdown.
   Content writes apply string edits to the projection, re-parse, and reuse the
   original JSON node for every block whose markdown is unchanged — so
   student-set `textAlign` / `fontFamily` attrs survive agent edits on other
   paragraphs. A 1-block→1-block replacement of the same node type copies the
   old block's `attrs` onto the new node.
3. **Version tokens are mandatory for content writes.** `read_essay` returns
   `version` (the row's `updated_at`, exact ISO string). `edit_essay` and
   `write_essay` require `expected_version` and pass it through as
   `expected_updated_at`; a stale token is a clean retryable-after-reread
   error, never a silent clobber. Metadata-only `update_essay` stays
   last-write-wins like task/school patches.
   **Service hardening required (review finding 2026-07-10):** the existing
   `_check_not_stale` guard has a TOCTOU hole — `_require_essay` is a plain
   `SELECT`, so under read committed a student autosave that commits between
   the stale check and `_update_essay_row`'s UPDATE is silently clobbered
   (the UPDATE blocks on the row lock, then applies over the new version).
   Fix in `service_essays.py`: add `FOR UPDATE` to the `_require_essay`
   select inside `update_essay`, so the check holds the row lock until the
   write commits. One-line change; without it the version token is advisory,
   not a guarantee.
4. **Edit-tool semantics.** `old_text` must match the projection exactly and
   uniquely; failures return "not found" or "found N matches — include more
   surrounding text" errors with recovery strings. Batches apply sequentially
   against the evolving projection, all-or-nothing, inside one transaction.
5. **Word limits warn, never block.** Exceeding `word_limit` saves and returns
   a warning with counts (students may exceed deliberately too).
6. **Server derives word_count.** Tools never send `word_count`; the service
   derivation from content is the single source of truth.
   **Service hardening required (review finding 2026-07-10):** only
   `update_essay` derives today — `create_essay` inserts `data.word_count`
   verbatim (default 0), so a `create_essays` call with `content_markdown`
   would land with a wrong count. Fix in `service_essays.py`: derive
   `word_count` from `data.content` inside `create_essay` and drop the
   caller-supplied field (remove `word_count` from `EssayCreate`, or ignore
   it). This also stops the student-facing API route from trusting client
   counts.
7. **Honesty posture is prompt-enforced, tool-supported.** The counselor.md
   essay playbook carries the PRD rules (never invent personal facts, interview
   before drafting, no meaning changes hidden in polish, confirm before
   overwriting a non-empty draft). Tools support it by making every change
   attributable and by refusing stale writes.

## Part A — Tool interface spec (implement verbatim)

Nine tools. Shared conventions from the task/school tools apply: results carry
`"status": "ok"` + `today`; errors use the shared `error()` shape; rows use
fixed key order with null/default fields omitted; every payload passes through
`process_tool_result`. Batch caps reuse the shared `BATCH_MIN`/`BATCH_MAX`
constants (1–20) and `batch_size_error` — do not introduce an essay-specific
cap; the shared error message is built from those constants.

### A.1 `view_essays` (read)

```
view_essays(
  status: Literal["active", "archived", "all"] = "active",
  application_id: str | None = None,
  limit: int = 25,
) -> {status, today, summary, essays: [row], footer}
```

Row: `{id, title, type, status, school?, words: "412/650" | "412", deadline?,
updated: "2026-07-08", preview?}` — `preview` is the existing
`tiptap_preview` 180-char snippet, omitted when empty. Sort: deadline asc
(undated last), then `updated_at` desc. Footer points at `read_essay` for full
content and reports rows beyond `limit`. Empty board footer suggests
`create_essays` linked to active applications (school lines from
`link_targets`-style rendering: active applications only, id · name · round ·
deadline).

Archived rows carry `state: "archived"` + `archived` date and the footer
offers `restore_essay`.

### A.2 `read_essay` (read — the document view)

```
read_essay(essay_id: str) -> {
  status, today,
  essay: {id, title, type, status, school?, prompt?, deadline?,
          words: "412/650" | "412"},
  version: "<updated_at ISO, echo verbatim>",
  content_markdown: str,
  footer,
}
```

- `content_markdown` is the projection (Part B). Empty doc → `""` plus footer
  "The essay is empty — draft it with write_essay."
- Footer (non-empty): "Echo version as expected_version when you edit. Use
  edit_essay for targeted changes, write_essay only for a full redraft the
  student asked for."
- Unknown/archived id → stale-essay error (A.9).

### A.3 `create_essays` (batch 1–20, all-or-nothing)

```
create_essays(essays: list[EssayDraft]) -> {status, today, summary, essays: [row], footer}

EssayDraft = {
  title: str,
  application_id: str | None,      # exact id from view_schools/link targets
  essay_type: EssayType = "Supplement",
  status: EssayStatus = "Not started",
  prompt: str | None,              # the school's essay question, verbatim
  word_limit: int | None,
  content_markdown: str | None,    # optional initial draft
}
```

- `content_markdown` parses through the projection module; parse never fails
  (any text is valid markdown), but a draft with content gets status
  "Drafting" unless the caller set something else explicitly.
- Duplicate guard: an active essay with the same case-insensitive title on the
  same application → per-batch error naming the existing essay id, recovery
  "update or read the existing essay instead" (all-or-nothing, like
  create_tasks).
- Invalid `application_id` → link error with recovery listing active schools.

### A.4 `update_essay` (single, metadata only)

```
update_essay(
  essay_id: str,
  title: str | None = None,
  application_id: str | None = None,   # "clear" unlinks
  essay_type: EssayType | None = None,
  status: EssayStatus | None = None,
  prompt: str | None = None,
  word_limit: int | str | None = None, # "clear" removes
  deadline: str | None = None,         # YYYY-MM-DD, "clear" removes
) -> {status, today, summary, essay: row}
```

Content is deliberately not a parameter — the docstring routes content work to
`edit_essay`/`write_essay`. No-field calls → retryable error. Date parsing via
`validate_date_only`.

### A.5 `edit_essay` (content, batch 1–20 edits, all-or-nothing)

```
edit_essay(
  essay_id: str,
  expected_version: str,           # from read_essay, verbatim
  edits: list[{old_text: str, new_text: str}],
) -> {status, today, summary, words: "438/650", version: "<new>", footer?, warning?}
```

- Applies to the markdown projection sequentially; each `old_text` must match
  exactly once *at its turn*. Failure anywhere → nothing is written; the error
  names the failing edit index and reason:
  - not found: include a short nearest-context hint when a case-insensitive or
    whitespace-normalized match exists ("did the text change? re-read the
    essay");
  - ambiguous: "found N occurrences — include more surrounding text to make it
    unique".
- Stale `expected_version` → A.9 stale-version error (retryable: re-read).
- Result `summary` counts edits applied; `warning` appears when over
  `word_limit`. Footer nudges status hygiene once: if essay status is still
  "Not started", suggest `update_essay(status="Drafting")`.
- `new_text: ""` deletes the matched text (document-level deletion is just an
  edit).

### A.6 `write_essay` (content, full replace)

```
write_essay(
  essay_id: str,
  expected_version: str,
  content_markdown: str,
) -> {status, today, summary, words, version, footer?, warning?}
```

Same version + word-limit semantics as `edit_essay`. Docstring: only for
drafting an empty essay or a full redraft the student explicitly asked for;
prefer `edit_essay` otherwise. Empty/whitespace-only `content_markdown` →
refuse (non-retryable error, recovery: "an essay is never blanked — archive
it with archive_essays if the student wants it gone").

### A.7 `duplicate_essay` (single)

```
duplicate_essay(essay_id: str) -> {status, today, summary, essay: row}
```

Wraps `service_essays.duplicate_essay` ("Copy of …"). Docstring frames it as
the safe-experiment tool: copy before a risky rework, then edit the copy.

### A.8 `archive_essays` (batch 1–20, per-item) / `restore_essay` (single)

Mirror `archive_tasks` / `restore_task` exactly: per-item results for archive
(unknown ids reported individually), all-or-nothing single restore. Restore
fails cleanly when the parent application is archived (service already
enforces this) with recovery "restore the school first with restore_school".

### A.9 Error payloads

Reuse `error()` from `agent_tools_shared`. New canned errors:

- `stale_essay_error(essay_id)` — "No active essay with id … Call view_essays
  to see current essays and their ids. Do not retry this same id."
- `stale_version_error()` — "The essay changed since you read it (the student
  may be typing right now). Call read_essay again and rebuild your edit
  against the current text." `retryable: true`.
- Edit-match errors (A.5) with per-index detail.

## Part B — Markdown projection (`app/workspace/essay_markdown.py`)

The one genuinely new component. Public surface:

```python
def to_markdown(doc: dict) -> str
def to_tiptap(markdown: str) -> dict
def apply_edits(doc: dict, edits: list[Edit]) -> EditResult
    # EditResult: new_doc, applied count | raises EssayEditError(index, reason, detail)
```

- **Serializer (`to_markdown`)** — hand-written recursive walk over the node
  set: paragraph, heading(1–6), bulletList/orderedList/listItem, blockquote,
  codeBlock, horizontalRule, hardBreak (`\` + newline), text with
  bold/italic/strike/code/link marks. Unknown node types degrade to their
  children's text (never crash on future editor extensions); unknown marks —
  including `underline` and `textStyle`, which the editor can produce — are
  dropped from the projection but preserved via block reuse. The serializer's
  test fixtures must include underline + textStyle marks to pin the
  degrade-don't-crash behavior.
- **Parser (`to_tiptap`)** — `markdown-it-py` (CommonMark preset +
  `strikethrough` rule), token stream → Tiptap nodes. Anything the grammar
  doesn't recognize is a paragraph of plain text — parsing is total.
- **Block preservation (`apply_edits`)** — render each top-level block to md;
  projection = blocks joined with `\n\n`; apply string edits; re-parse the new
  projection; align old/new block lists with `difflib.SequenceMatcher` over
  their md strings; equal blocks reuse the original JSON node object
  (attrs and unexpressible marks intact); 1→1 same-type replacements copy
  `attrs` from the old block.
- **Round-trip invariant (tested):** for any doc built from supported nodes,
  `to_markdown(to_tiptap(to_markdown(doc))) == to_markdown(doc)`, and blocks
  untouched by an edit are byte-identical JSON before/after `apply_edits`.

This module is pure (no I/O); the content tools compose it with
`service_essays.update_essay(content=…, expected_updated_at=…)` — **no new
service-layer code is needed for content writes.**

## Part C — Integration changes (file-by-file)

| File | Change |
|---|---|
| `pyproject.toml` | add explicit `markdown-it-py` dependency |
| `app/workspace/service_essays.py` | `FOR UPDATE` in `update_essay`'s `_require_essay` select (decision 3); derive `word_count` in `create_essay` (decision 6) |
| `app/workspace/models.py` | drop caller-supplied `word_count` from `EssayCreate` (decision 6) |
| `app/workspace/essay_markdown.py` | new — Part B |
| `app/workspace/agent_tools_essays.py` | new — `view_essays`, `read_essay`, row rendering |
| `app/workspace/agent_tools_essays_mutations.py` | new — `create_essays`, `update_essay`, `duplicate_essay`, `archive_essays`, `restore_essay` |
| `app/workspace/agent_tools_essays_content.py` | new — `edit_essay`, `write_essay`, shared version-guard helper |
| `app/workspace/agent_tools_shared.py` | `EssayDraft` model, `stale_essay_error`, `stale_version_error` |
| `app/workspace/agent_tools.py` | mount the nine tools in `build_workspace_tools` (module docstring update) |
| `app/tool_specs.py` | nine entries, all `"auth"` |
| `config/assets/step_labels.yaml` | nine `kind: workspace` labels ("Reading an essay", "Editing an essay", "Drafting an essay", "Adding {essays_phrase}", …) |
| `config/assets/prompts/counselor.md` | Essay workspace playbook (see below) |
| `docs/adr/0030-essay-markdown-projection.md` | new ADR: markdown projection + direct-edit decision |
| `tests/app/test_tool_specs.py`, `tests/app/test_steps.py` | extend the existing spec/label coverage |
| `tests/app/workspace/test_essay_markdown.py` | new — round-trip + block preservation + edit semantics |
| `evals/…` | essay-tool eval mirroring the schools eval set |

Prompt playbook (gated like the schools section on tool presence):

- read before you edit; never edit from memory of an earlier turn;
- `edit_essay` for targeted changes; `write_essay` only for an explicit
  full-redraft request or an empty essay;
- never invent personal facts, activities, hardship, or emotional meaning —
  when material is missing, ask the student for the real detail first;
- interview before drafting from scratch;
- don't hide meaning changes inside polish; describe what you changed;
- respect word limits; when cutting, say what was cut and why;
- keep status honest (Not started → Drafting when content lands);
- confirm before overwriting or archiving a draft with real content.

## Part D — Tests & evals

Honesty-critical (per AGENTS.md testing stance, these warrant real tests):

- `essay_markdown` round-trip property tests + attr-preservation on partial
  edits + edit failure modes (not-found, ambiguous, sequential batch).
- Content tools: stale-version rejection, all-or-nothing batch, word-limit
  warning, "Not started" status nudge.
- Spec/label parity tests extended (they already fail on unregistered tools).

Evals: one live eval mirroring the schools set — agent reads an essay, applies
a targeted student-requested edit, refuses to invent a personal detail.

## Phases (each gated on `uv run pytest -m "not live_llm and not live_search and not live_db"` + `ruff` + `mypy`)

1. `essay_markdown.py` + its tests (pure module, no wiring).
2. Read tools (`view_essays`, `read_essay`) + shared helpers.
3. General mutations (`create_essays`, `update_essay`, `duplicate_essay`,
   `archive_essays`, `restore_essay`) + create-side `word_count` derivation
   in `service_essays.create_essay` (decision 6 hardening).
4. Content tools (`edit_essay`, `write_essay`) + `FOR UPDATE` stale-check
   hardening in `service_essays.update_essay` (decision 3 hardening).
5. Wiring: mount, tool_specs, step_labels, counselor.md playbook, ADR 0030.
6. Eval + review pass + commit.

## Risks

- **Round-trip drift** — a serializer/parser asymmetry would make untouched
  blocks look "changed" and lose attrs, or make `old_text` from `read_essay`
  fail to match. Mitigated by the round-trip invariant tests and by deriving
  the edit projection with the same `to_markdown` used by `read_essay`.
- **Duplicate paragraph text** — identical blocks are fine for
  `SequenceMatcher`, but an `old_text` spanning one of two identical
  paragraphs is ambiguous by design; the error message teaches the fix.
- **Timestamp echo fidelity** — `expected_version` must round-trip through the
  model verbatim; ISO strings with microseconds survive `fromisoformat`.
  Tested explicitly.
- **Tool-count growth** (22 mounted workspace tools) — descriptions stay
  scoped; the schools rollout showed the model routes fine at 13; watch evals.

## Out of scope (explicitly)

- The `suggestions` propose/accept flow, comments, drafts/checkpoints/story
  bank (Essay Studio spec).
- Wiring the mvp3-frontend essays pages to the live API (separate task; the
  tools work against the real service regardless). **Contract note for that
  task:** the editor currently feeds `onUpdate` with `editor.getText()` and
  seeds content from fixture HTML strings — live wiring must persist
  `editor.getJSON()`, or the DB content stops being Tiptap JSON and the
  projection's assumptions break.
- Selected-text/range-anchored operations (Studio, needs editor selection).
- Any `comments` jsonb surface.
