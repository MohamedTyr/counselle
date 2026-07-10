# ADR 0030 — Essay content as a markdown projection, direct edits

**Status:** Accepted

## Context

The agent needed full control over the student's essays, mirroring the
task/school tools (ADR 0029): viewing, creating, updating metadata,
duplicating, archiving, and restoring essays as workspace objects. But an
essay also has a *document* — its content — stored as Tiptap/ProseMirror
JSON (`counselle.essays.content`), the format the mvp3-frontend editor reads
and writes directly. An LLM agent cannot reliably read or produce that JSON
schema: it is deeply nested, has no natural textual "diff" surface, and
asking a model to emit well-formed ProseMirror JSON for every edit invites
malformed output. The agent needed a document interface as easy to work with
as a text file, without ever seeing or producing the underlying JSON.

## Decision

- **Markdown projection, not raw JSON.** `app/workspace/essay_markdown.py`
  converts Tiptap JSON to markdown (`to_markdown`) and back (`to_tiptap`).
  `read_essay` shows the projection; `edit_essay` applies exact-string
  `old_text → new_text` replacements against it (the same mechanic Claude
  Code's own Edit tool uses, which models already execute reliably);
  `write_essay` replaces the whole projection. The agent never sees or
  produces Tiptap JSON.
- **Block-preserving edits.** `apply_edits` re-renders the doc as markdown,
  applies the string edits, re-parses only the edited result, and reuses the
  original JSON node — recursively, into list items and blockquote children,
  not just top-level blocks — for every node whose rendered markdown is
  unchanged. This is what lets student-set attrs (`textAlign`) and marks the
  parser can't produce (`underline`, `textStyle`/`fontFamily`) survive an
  agent edit elsewhere in the document, at the cost of losing those marks on
  a block the agent's edit actually touches (markdown has no representation
  for them, so a freshly-reparsed block can't carry them forward).
- **Direct edits, not a suggestions layer.** Agent essay writes apply
  immediately with `actor="counselle"` change events, exactly like the
  task/school tools — no separate propose/accept step. The `suggestions`
  jsonb column exists for a future Essay Studio propose/accept flow
  (specs/mvp3-essay-studio) but is out of scope here; `edit_essay`'s
  `{old_text, new_text}` edit shape is deliberately the same shape a
  suggestions layer would need, so that layer can wrap this mechanic later
  instead of replacing it.
- **Version tokens are mandatory for content writes.** `read_essay` returns
  `version` (the row's `updated_at`, echoed verbatim); `edit_essay` and
  `write_essay` require `expected_version`, passed through to the existing
  `EssayPatch.expected_updated_at` optimistic-concurrency guard
  (`service_essays._check_not_stale`). A stale token is a clean, retryable
  "re-read and rebuild your edit" error, never a silent clobber of text the
  student may be typing right now. That guard's `SELECT` now takes
  `FOR UPDATE` (previously a plain `SELECT`), closing a TOCTOU race where a
  concurrent autosave could commit between the staleness check and the
  write and still be overwritten once the row lock released — without it,
  `expected_updated_at` was advisory, not a guarantee.
- **No new service-layer code for content writes.** `essay_markdown` is a
  pure, no-I/O module; the content tools compose it with the existing
  `service_essays.update_essay(content=…, expected_updated_at=…)`.

## Alternatives

- **The agent reads/writes Tiptap JSON directly.** Rejected — no natural
  edit surface for an LLM, high risk of malformed schema output, and every
  edit would need to be a full-document JSON diff instead of a targeted
  text change.
- **A structured edit DSL over the JSON (e.g. node paths + operations)**.
  Rejected — more expressive than markdown for edge cases, but requires the
  model to reason about document structure it can't see; markdown's
  familiarity (the model already reads/writes it fluently) was worth the
  precision it gives up.
- **Route agent essay writes through a suggestions/propose-accept flow from
  day one.** Rejected — the Essay Studio's suggestions UI doesn't exist yet;
  building the propose/accept plumbing before there's a surface to accept
  suggestions on would be speculative. Direct writes with attributable
  change events (ADR 0029) and a stale-write guard cover the honesty and
  safety bar for now; the edit shape is chosen so a suggestions layer can
  wrap it later without a redesign.
- **Preserve all marks through every edit via a richer diff (e.g. per-run
  alignment inside an edited block).** Rejected as unnecessary complexity —
  block-level reuse already preserves everything on *untouched* blocks,
  which covers the common case (an agent edit usually touches one
  paragraph); losing an inline mark on the specific block being edited is
  an acceptable, documented trade-off.

## Consequences

Essay content tools inherit `service_essays.py`'s existing transaction,
change-log, and SSE-publish path automatically — no parallel write path to
keep in sync. The markdown projection is the single source of truth for what
the agent can express: any Tiptap node type or mark this module doesn't
model degrades to plain text (unknown nodes) or is silently dropped
(unknown marks) rather than crashing, so future editor extensions are safe
by default but invisible to the agent until `essay_markdown.py` is taught
about them. `FOR UPDATE` inside `update_essay`'s transaction means a content
write now briefly holds a row lock across the read-modify-write, which is
correct for the single-row, low-contention essay-update case this guards but
would need revisiting if essay writes ever became bulk or high-throughput.
