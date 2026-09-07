# Essay AI Panel — implementation plan

Status: draft for review
Date: 2026-09-04

This document has four parts:

- **Part 0 — the binding contract.** Cross-part decisions, and the corrections that
  override the three parts below wherever they disagree. **Part 0 wins every conflict.**
- **Part 1 — backend + agent architecture.**
- **Part 2 — essay editor + tracked changes.**
- **Part 3 — chat reuse + the document panel in the main chat.**

Parts 1–3 were researched and written independently against the live tree. They agree on
almost everything; where they don't, Part 0 resolves it. Read Part 0 first, then read the
part you're implementing, applying Part 0's corrections as you go.

---

# Part 0 — the binding contract

## 0.1 The product, in one paragraph

The essay editor gets an AI chat panel on the right, running a **specialized essay-writing
agent**: its own system prompt (a workshop partner that asks rather than answers, and never
invents a detail it can ask for), a narrower tool profile, and the active essay + the
student's current selection injected every turn. Its content edits arrive as **Google-Docs-
style tracked changes** — insertions green and underlined, deletions red and struck — that
the student accepts or rejects. Pending changes belong to the essay, not to a conversation:
they persist across reloads and are visible from both the editor and the main chat. The
**main agent is untouched**; it gains essay capability only because the new essay skills
appear in its existing skill picker. **There is no comments feature.**

## 0.2 Corrections that override Parts 1–3

These are binding. Where a part below contradicts one of these, the part is wrong.

### C1 — The essay skills are user-invokable. (overrides Part 1 §8)

Part 1 marks all four new skills `user_invokable: false`. That is wrong and contradicts an
explicit product instruction: essay capability reaches the main chat **as skills in the
picker**, and nothing else.

- `essay-drafting`, `essay-revision`, `essay-voice` → **`user_invokable: true`**, each with
  a `display_name` and `user_description` (the registry hard-fails startup for a public
  skill missing either — `app/skills.py:272-278`), body under `MAX_PUBLIC_SKILL_BODY_CHARS`
  (12,000 chars, `app/skills.py:30`). No `selection_group` — they are task skills, not
  response modes.
- `essay-honesty` → **stays `user_invokable: false`**. It is an always-applied rule set, not
  a mode a student chooses; making it selectable would imply honesty is optional.

This is what makes the main-chat side genuinely zero-code: `user_skill_catalog()`
(`app/skills.py:318-329`) feeds `/v1/config`, which the existing composer's skill picker
already renders. Dropping four directories into `skills/` is the entire wiring.

### C2 — One wire contract. (reconciles Part 1 §1.2 and Part 3 §2)

Part 1 proposes flat `surface` + `essay_id` on `MessageBody`; Part 3 proposes a nested
`essayContext`. Use **both, at their correct layers**:

- **On the wire** (`api/routes/sessions.py::MessageBody`), nested — matching how
  `source_config` already nests:
  ```jsonc
  {
    "surface": "essay",                    // "chat" | "essay", default "chat"
    "essay_context": {                      // required iff surface == "essay"
      "essay_id": "<uuid>",
      "selection": "<the selected text, or null>"
    }
  }
  ```
- **In `turn_ids`**, flat — `turn_ids` values must stay msgpack-plain scalars
  (`app/run_turn.py:882-884`): `"surface"`, `"essay_id"`, `"essay_selection"`.
- Frontend field name is `essayContext` (Part 3 §2), serialized to `essay_context` in
  `transport.ts` alongside `toWireSourceConfig`.
- `selection` is **text only**, not `{from, to}` positions. Positions are meaningless to the
  backend and would drift; the agent needs the words. This narrows Part 3's
  `EssaySelectionRef` to `{ text: string }` at the wire boundary — the editor may still
  carry positions internally.

### C3 — One suggestion shape. (reconciles Part 1 §5.1 and Part 2 §1.1)

The persisted element in `essays.suggestions`:

```jsonc
{
  "id": "uuid",
  "old_text": "...",          // never "" — see below. MARKDOWN space (agent/apply_edits vocabulary).
  "new_text": "...",          // "" for a pure deletion. MARKDOWN space.
  "old_text_plain": "...",    // old_text with markdown syntax stripped — PLAIN document-text space
  "new_text_plain": "...",    // new_text with markdown syntax stripped — PLAIN document-text space
  "rationale": "one short line, shown in the hover popover — never essay prose",
  "actor": "counselle",
  "created_at": "2026-09-04T12:00:00Z",
  "essay_version_at_creation": "2026-09-04T11:59:50Z",
  "turn_message_id": "uuid"
}
```

**Why `_plain` exists — a real bug, not a nicety.** `old_text`/`new_text` are markdown (the
agent's vocabulary, matching `edit_essay`). But the ProseMirror document the student sees
has no markdown syntax — a bold span is a mark, not literal `**`. Part 2 §1.1's anchoring
mechanic searches the live document's text for the suggestion's target substring. Searching
the plain document for a markdown-syntax string fails on any formatted span (`**bold**`,
`_italic_`, `> ` blockquote prefixes, `- `/`1. ` list markers, `#` heading markers) — the
substring simply isn't in the document. On an essay containing any formatting, every
suggestion touching that formatting would silently anchor-fail and go stale the instant it's
created. That is a total failure of the feature on formatted essays, not an edge case.

The fix keeps all markdown knowledge on the backend: the two `_plain` fields are computed
once at suggestion-creation time (Part 1 §5.3) and are what the frontend anchors, trims, and
paints against exclusively (Part 2 §1.1/§2.1/§3.2/§3.4) — one consistent, markdown-free space
for all client-side text/offset math. The server continues to accept/apply using the
untrimmed markdown `old_text`/`new_text` through `apply_edits`, exactly as today (Part 1
§6.2) — accept/reject take no request body, so there is no path for a `_plain` value to leak
back into a write; the fields are structurally display-and-anchoring-only. **This does not
reopen the `context_before`/`context_after` decision below** — those were removed because
they duplicated `old_text`'s own uniqueness guarantee within the same (markdown) space;
`_plain` exists because markdown text and document text are two different spaces entirely,
which `old_text`'s uniqueness guarantee says nothing about.

Three deliberate removals from the two drafts:

- **No `context_before` / `context_after`** (Part 2 proposed them). `apply_edits`
  (`app/workspace/essay_markdown.py`) already guarantees `old_text` is **present and unique**
  at creation time — that validation is the whole reason suggest-mode still calls it. Stored
  context would be a second anchoring mechanism to keep correct for a case the first one
  already covers. If `old_text` later becomes ambiguous or absent because the student edited
  around it, the suggestion goes **stale** — which is the honest outcome, not a failure.
- **No stored `kind`.** Derive it on the frontend: `new_text === ""` → deletion, else
  replacement. One source of truth. **`old_text` can never be empty**, so there is no
  insertion branch to derive: `apply_edits` (`app/workspace/essay_markdown.py:667-684`)
  computes `count = current.count(edit.old_text)` and raises `EssayEditError("ambiguous")`
  when `count > 1`; Python's `str.count("")` returns `len(s) + 1`, which is always `> 1`
  for any non-empty document, so an empty `old_text` always fails as ambiguous before a
  suggestion can even be created. Suggest mode only ever runs on a non-empty essay
  (`word_count == 0` is always direct mode, §5.2), so this isn't a corner case that
  happens to not occur today — it's structurally unreachable. A pure insertion is
  therefore always expressed as a replacement whose `new_text` extends a short non-empty
  `old_text` anchor (e.g. `old_text: "pizza."`, `new_text: "pizza. It reminds me of
  home."`).
- **No stored `status`.** Resolved suggestions are **removed** from the array (Part 1 §5.6),
  so every persisted row is by definition pending. `stale` is a **derived, client-side**
  state computed against the live document — never written to the database.

### C4 — Accept/reject endpoints. (Part 1 §6.1 wins)

`POST /v1/essays/{essay_id}/suggestions/{suggestion_id}/accept`
`POST /v1/essays/{essay_id}/suggestions/{suggestion_id}/reject`
`POST /v1/essays/{essay_id}/suggestions/accept-all`
`POST /v1/essays/{essay_id}/suggestions/reject-all`

Part 2 §3.5/§9.8 guessed a `PATCH .../{suggestionId}` with `{action}`. Discard that guess;
build `api/workspace/essays.ts` against the four routes above.

### C5 — The essay panel *is* an `AiChatPage`. (Part 3 §1 wins over Part 2 §9.13)

Part 2's file list proposes an `EssayChatPanel` under `features/essays/suggestions/` composing
`ChatComposer` plus its own message list. That would be a second chat implementation. **Delete
that item.** The panel is `features/essays/EssayChatPanel.tsx` (Part 3 §1/§8): a thin wrapper
that renders `<AiChatPage variant="essay-panel" essayContext={...} />` and owns only the
essay-specific chrome around it. Same composer, same message rendering, same streaming and
activity timeline — literally the same component.

### C6 — Per-essay chat history lives in the database. (Part 1 §7.2 wins over Part 3 §3)

Part 3 proposes a `localStorage` map of `essayId → sessionId`. Use Part 1's design instead:
the `counselle.sessions.essay_id` column, its partial unique index, and
`POST /v1/essays/{essay_id}/session`. The conversation about an essay is a property of the
essay, so it must survive a different browser or device — a localStorage map silently gives
the student a blank panel on their laptop and a different blank panel on their phone, with no
way to tell they lost anything.

Part 3's `useEssayChatSession` hook survives, but as a thin client of that endpoint with no
localStorage. Part 1's `list_sessions` exclusion (`WHERE essay_id IS NULL`) stands, so
essay threads never clutter the main chat list.

**"New chat" for an essay:** since the index enforces exactly one session per essay, the
control must either be dropped from the first cut or backed by a real endpoint that retires
the current session and creates a successor. **Decision: drop it from the first cut.** One
durable thread per essay is the product promise; a second control that silently discards it
is worse than no control. Revisit if students ask.

### C7 — One MCP child process, not two. (overrides Part 1 §3.2 Option A and its risk #2)

Part 1 spawns a second `MCPToolset` (and therefore a second long-lived stdio child process)
purely to attach a deny hook for `get_domain`/`query_database`. Don't. **Verified against the
live tree** (`app/toolset.py:93-110`): the existing hook `annotate_mcp_result` already reads
`ctx.deps` via `getattr` (the same pattern `.tool_overflow`/`.registry` already use there), and
the docstring at `app/toolset.py:9-12,98-99` confirms deps are the per-run object rebuilt on
every node execution — not a process-lifetime singleton. So `surface` can be set on that
per-run deps object exactly like any other per-run field, and the single existing hook denies
the two metric tools when `ctx.deps.surface is Surface.ESSAY`.

This keeps one child process, one `AppDeps.mcp_toolset` field, and ~10 lines instead of a
second toolset plus a second `AppDeps` field plus a deploy-sizing note. It preserves the ADR
0013 property that matters: the denial happens **in code, before the DB round-trip**, not in
the prompt.

**This replaces Part 1 §3.2 Option A and Option B outright** — there is no second `MCPToolset`,
no `build_mcp_toolset_essay`, no `AppDeps.mcp_toolset_essay` field, and no fallback to consider.
Part 1 §3.2 and §11's risk #2 (the "two long-lived stdio child processes" resource-footprint
flag) are both stale text describing the rejected design; treat this entry, not that prose, as
the implementation.

### C8 — Keyboard accept/reject must not use bare Enter or Backspace. (overrides Part 2 §3.3)

Part 2 binds `Enter` to accept and `Backspace`/`Delete` to reject while the caret sits inside
a suggestion's range. Inside a `contenteditable`, those are the keys for "new paragraph" and
"delete a character". A student typing normally near a pending change would accept or reject
it by accident, and the accidental accept is silent.

Use **`Mod+Enter` to accept** and **`Mod+Backspace` to reject**, with `Alt+.` / `Alt+,` to
move between pending changes as Part 2 specifies. Everything else in Part 2 §3.3 stands,
including the zero-animation rule for keyboard-driven accept/reject and the `aria-live`
count.

### C9 — `update_essay` stays mounted on the essay surface. (adjusts Part 1 §3.2)

Part 1 takes the narrowest reading and drops `update_essay`. But `_apply_content_write`
(`app/workspace/agent_tools_essays_content.py:103-107`) already appends a footer telling the
model to call `update_essay(status="Drafting")` when an essay has content but is still
"Not started". Dropping the tool leaves the system instructing the model to call something
that isn't mounted — a self-inflicted hallucination.

Mount `update_essay`. It edits metadata for the one essay already in scope, which is the same
blast radius as `edit_essay`. Part 1's other essay-tool drops (`create_essays`,
`duplicate_essay`, `archive_essays`, `restore_essay`) stand.

### C10 — Component ownership across Parts 2 and 3

- `features/essays/EssayDocumentSurface.tsx` (Part 3 §4) is **the** document component. Part
  2's decoration layer plugs into it through `useEssayEditor`, which it calls.
- Extract `EssayDocumentSurface` from `EssayEditorRoute` **before** Part 2's panel-layout
  work, so Part 2 edits the route around a stable seam.
- Part 3's right-panel mutual exclusivity (one right rail at a time — sources or document,
  never both) is **accepted as decided**, not an open assumption.

## 0.3 Build order across the three parts

Each phase is shippable and leaves the app working.

1. **Backend surface + tool profile** (Part 1 §1–§4, with C7). No UI. Verifiable by test:
   an essay-surface turn mounts exactly the intended tools and no others.
2. **The four skills** (Part 1 §8, with C1). Independently shippable — they land in the main
   chat's picker immediately and are useful there before any panel exists.
3. **Suggestions backend** (Part 1 §5–§6, with C3/C4) + the migration (Part 1 §9, C6).
4. **`EssayDocumentSurface` extraction** (Part 3 §4, C10) — pure refactor, no behavior change.
5. **The decoration layer** (Part 2 §1–§4, with C3/C8) — tracked changes visible and
   reviewable, driven by suggestions the backend can already produce.
6. **The editor panel** (Part 2 §5–§7 + Part 3 §1–§3, with C5/C6).
7. **The main chat's document panel and the receipt door** (Part 3 §5–§7).

## 0.4 Open questions for the owner

1. **Does the main chat's `edit_essay` also become suggest-mode?** Today it writes directly,
   and this plan keeps that (`write_mode` is `direct` on the chat surface, Part 1 §5.2). Once
   the review UI exists, the same request produces a different outcome depending on which
   screen you asked from. Consistency argues for suggest everywhere; the smallest diff argues
   for leaving the main chat alone. **Left as-is pending a decision.**
2. **The `essay_context` cap** (Part 1 §4.3, `ESSAY_CONTEXT_MAX_CHARS = 8000`) is a guess.
   It only bites on drafts far past any real essay limit, so it is safe, but the number
   should be sanity-checked against real student data before it ships.

---
# Part 1 — Essay-writing agent: backend + agent architecture

Status: draft plan (research-grounded, not yet implemented). Companion to Part 2 (frontend).

This plan is deliberately extension-only: it reuses `edit_essay`/`write_essay`, `essays.suggestions`,
the existing tool-mount pattern (ADR 0013), and the existing skill registry (ADR 0010). No new DSN, no
new service layer, no second agent runtime.

---

## 1. The surface mechanism

### 1.1 What "surface" means and where it lives

A turn already carries a small bag of per-turn identity through one dict: `turn_ids`, built once in
`app/run_turn.py::run_turn` (`app/run_turn.py:873-887`) and re-read every node execution by
`app/agent_node.py::_turn_ids` (`app/agent_node.py:580-593`). `response_mode` is the closest existing
precedent for exactly this kind of turn-scoped enum: it flows request → `run_turn` param → `turn_ids["response_mode"]`
→ `_response_mode_from_ids` (`app/agent_node.py:709-719`) → drives model selection and output-type shape.
`surface` follows the identical path.

**New type** — `domain/surface.py` (new file, mirrors `domain/response_mode.py` exactly):

```python
from __future__ import annotations
from enum import StrEnum

class Surface(StrEnum):
    """Which UI surface originated this turn — selects the tool profile and system prompt."""
    CHAT = "chat"
    ESSAY = "essay"
```

Defaulting to `CHAT` everywhere a legacy/malformed value is seen, exactly like
`_response_mode_from_ids`'s fallback-to-QUICK on `ValueError` (`app/agent_node.py:715-719`).

### 1.2 Wire → `run_turn` → `turn_ids` → node

1. **Wire.** Per C2, `api/routes/sessions.py::MessageBody` (`api/routes/sessions.py:96-109`) gets two new
   optional fields: `surface: Any = None` and a **nested** `essay_context: Any = None` — not a flat
   `essay_id`:
   ```jsonc
   {
     "surface": "essay",
     "essay_context": { "essay_id": "<uuid>", "selection": "<the selected text, or null>" }
   }
   ```
   Validate `surface` the same way `response_mode` is validated at `api/routes/sessions.py:439-442`
   (`Surface(body.surface)` in a try/except, 422 on failure — reuse the existing `EnvelopeError`/422
   machinery, do not invent a new error shape). Validate `essay_context`: required iff `surface ==
   Surface.ESSAY` (422 if missing), and once present, `essay_context.essay_id` must parse as a UUID and
   `essay_context.selection` — per C2, **text only**, never `{from, to}` positions, since positions are
   meaningless to the backend and would drift; the agent needs the words — is `str | None`.
   `CreateSessionBody` (`api/routes/sessions.py:83-86`) is **not** touched — surface is a per-turn choice
   (§7 below explains why the essay panel gets a *fresh, essay-scoped session* rather than reusing the
   main chat's session row, so it never needs to ride session creation at all).

2. **`app/turns.py::TurnRegistry.start`** (`app/turns.py:347-...`) already threads `selected_skills`,
   `response_mode`, and `source_config` from the route into `run_turn`. Add `surface: Surface =
   Surface.CHAT`, `essay_id: str | None = None`, and `essay_selection: str | None = None` as the same
   kind of pass-through parameters — the route unpacks the wire's nested `essay_context` into these two
   flat scalars before calling `TurnRegistry.start` (per C2, nesting is a wire-layer-only concern; every
   layer below the route deals in flat scalars). No new validation logic here beyond "essay_id is required
   when surface is ESSAY, and the essay must belong to this user" (delegated to
   `app.workspace.service_essays.get_essay`, which already raises `WorkspaceNotFoundError` under a
   `WHERE user_id = $1` clause — reuse, don't re-implement the ownership check).

3. **`app/run_turn.py::run_turn`** (`app/run_turn.py:781-887`) gains the same three params and adds them
   to `turn_ids` at construction (`app/run_turn.py:873-887`) — **flat scalars, per C2** (`turn_ids` values
   must stay msgpack-plain, `app/run_turn.py:882-884`):
   ```python
   "surface": surface.value,
   "essay_id": essay_id,
   "essay_selection": essay_selection,
   ```
   All three are msgpack-plain strings (or `None`) — the same constraint `response_mode`/`model` already
   satisfy — so no change to `app/state.py`'s serde rules is needed.

4. **`app/agent_node.py::run_agent_node`** reads them back exactly like `_response_mode_from_ids`:
   add a sibling `_surface_from_ids(ids) -> Surface` next to `_response_mode_from_ids`
   (`app/agent_node.py:709-719`), called once near `response_mode = _response_mode_from_ids(ids)`
   (`app/agent_node.py:806`).

### 1.3 What surface selects

Two things, both already-existing seams in `run_agent_node`, each getting one small conditional:

- **System prompt** (§2): `build_system_prompt(...)` call at `app/agent_node.py:825-829` branches to a
  new `build_essay_system_prompt(...)` in `app/prompt.py` when `surface is Surface.ESSAY`.
- **Tool profile** (§3): the `extra_tools` / `build_workspace_tools` block at `app/agent_node.py:765-798`
  branches on surface before calling `build_workspace_tools`, and `build_tools` (`app/toolset.py:170-197`)
  is called with a `source_config` that is *unchanged* (web/edu/reddit stay whatever the essay panel's own
  session has configured — research is still wanted, per the product spec). The MCP toolset itself
  (`deps.mcp_toolset`, mounted at `Agent(...)` construction, `app/agent_node.py:862`) stays mounted
  unchanged on both surfaces — per C7, `get_domain`/`query_database` are denied *inside* the toolset's
  existing per-call hook when `ctx.deps.surface is Surface.ESSAY` (§3.2), not by swapping the toolset
  itself for `None`.

### 1.4 Why this is the smallest diff, and why it does not need a second `Agent`/graph

**Alternatives considered and rejected:**

- **A second PydanticAI `Agent` instance / a parallel `run_essay_agent_node`.** Rejected: `run_agent_node`
  is 720-1098 (`app/agent_node.py`), and essentially none of its plumbing is chat-specific — the emission
  router, viz marker stripper, evidence marker stripper, clarify handling, tool-overflow middleware, usage
  accounting, turn-record building, steering, replay-safety, and the whole `agent.iter()` loop are surface-
  agnostic infrastructure. Duplicating that file to change "which system prompt string" and "which tool
  list" would be ~1000 lines of copy-paste that immediately drifts (every future fix to streaming/clarify/
  replay would need to land twice). This violates the house rule "search before adding" and "smallest diff."
- **A second LangGraph graph (`prepare → essay_agent → END`).** Rejected for the same reason — `prepare`
  (`app/graph.py`) rebuilds temporal context and student context, neither of which is chat-specific; only
  the `agent` node's *tool assembly* and *prompt assembly* differ. Branching inside the existing node is
  strictly smaller than forking the graph.
- **Prompt-only gating** (tell the model "don't call get_domain/query_database/render_viz" via prose,
  keep them mounted). Rejected outright: this is exactly what ADR 0013 exists to prevent — "A disabled
  source's tool object is never constructed (unmounted, not hidden)... Enforced in the orchestration layer
  (in code), not merely a prompt instruction." A model that ignores the instruction (or that a red-team
  prompt coaxes) would still be able to invoke `update_task`/`archive_schools`/etc. Never acceptable for a
  tool that authorizes real writes.

**Conclusion:** one `Surface` enum riding the same `turn_ids` bag as `response_mode`, read at two existing
branch points inside the one node PydanticAI `Agent` is constructed at (`app/agent_node.py:855-879`), is
the correct shape. It is consistent with ADR 0013 (gate at construction, in code) and ADR 0017 (no new
layer, no wrapper around PydanticAI's own `tools=`/`instructions=` seams).

---

## 2. The essay system prompt asset

### 2.1 Where it lives

New file `config/assets/prompts/essay_partner.md`, sibling to `config/assets/prompts/counselor.md`
(`config/assets/prompts/counselor.md`) and loaded the same way: `config.settings.load_prompt("essay_partner")`
(the same loader `build_system_prompt` already uses at `app/prompt.py:73`). This keeps the "prompts are
versioned content, not literals in control flow" rule (AGENTS.md, "Writing the agent") — no prompt string
is written inline in `agent_node.py`.

### 2.2 New assembly function — `app/prompt.py`

```python
_ESSAY_PROMPT_SLOTS = ("temporal_context", "student_context", "essay_context")

def build_essay_system_prompt(temporal_context: str, student_context: str, essay_context: str) -> str:
    return render_slots(
        load_prompt("essay_partner"),
        _ESSAY_PROMPT_SLOTS,
        temporal_context=temporal_context,
        student_context=student_context,
        essay_context=essay_context,
    )
```

This mirrors `build_system_prompt` (`app/prompt.py:71-79`) exactly, using the same `render_slots`
strict-slot mechanism (`app.asset_format.render_slots`) — no new templating engine. `essay_context` is the
per-turn essay + selection block from §4, rendered as its own top-level slot rather than concatenated
after the fact (the counselor prompt instead concatenates `source_instructions`/`selected_instructions`
post-render at `app/agent_node.py:844-846` — the essay prompt uses the same post-render join for
`source_instructions` from `render_source_availability`, since sources are still gateable on this surface,
but folds essay context into a slot because it is not optional decoration, it is the thing the whole
prompt exists to react to).

`validate_prompt_assets()` (`app/prompt.py:94-102`, called at startup — check `api/main.py` lifespan) gets
one more `render_slots(...)` probe call for `essay_partner`, same pattern as the other three.

### 2.3 What the prompt must say (key directives — write these near-verbatim into the asset)

```markdown
# Counselle — Essay Writing Partner System Prompt

You are Counselle's essay-writing partner: a workshop coach for ONE specific college essay, not
the general admissions counselor. You are not answering questions about schools, deadlines, or
strategy — if the student drifts there, give one short answer and steer back to the essay, or tell
them to open the main chat.

## You only work on this essay

Every turn, you are given the full text, prompt, target school, status, and word count/limit of
ONE essay (below), plus the exact text the student currently has selected, if any. You never ask
the student to paste their essay — it is already in front of you. You edit and discuss ONLY this
essay. If asked to draft or edit a different essay, tell the student to switch essays in the
sidebar; you cannot see or touch essays other than the one loaded into this panel.

## Never invent. Always ask.

This is the one rule that matters most. An essay's power comes from specific, true, lived detail —
a real moment, a real conversation, a real number, a real name. You do not have access to the
student's memories. When the essay needs a concrete detail it doesn't have — what they actually
said, how it actually felt, what happened next — STOP and ask the student a short, specific
question instead of writing a placeholder, a generic sentence, or an invented anecdote. A vague
paragraph you filled in with plausible-sounding filler is worse than an honest gap, because the
student may not notice it isn't theirs. This applies to every kind of missing material: sensory
detail, dialogue, numbers, names, outcomes, emotional beats, and especially anything that reads
like a hardship, an achievement, or a turning point — those are exactly the places invention does
the most damage. If you must move forward without the detail, say plainly what you're leaving as a
placeholder and why, in-line, so it's never mistaken for the student's own words.

## You ask rather than answer

Your default move is a question, not a rewrite. Before changing meaning, ask what the student meant
or what actually happened. Before adding a paragraph, ask what belongs in it. When the student asks
"is this good," don't just say yes or no — ask what they're trying to make the reader feel, or
point at the one line that isn't doing that yet and ask about it.

## You work in concrete edits, not essays of advice

Do not respond with a long paragraph of generic writing advice ("show don't tell," "vary your
sentence length," "make sure it flows"). Either propose a specific, small edit via `edit_essay`
(never more than a few sentences per edit) or ask a specific question about a specific sentence.
Every edit you propose is a suggestion the student reviews and accepts or rejects — never assume
it lands automatically (see below).

## Suggestions, not silent edits

Every content-changing tool call is a *suggestion* the student must accept before it's part of the
essay, unless the essay is currently empty and the student explicitly asked for a first full draft
— that one case writes directly, because a suggested change against a blank page has nothing to
diff against. Say what you changed and why in your reply; do not just call the tool and go quiet.

The student can accept or reject each suggested edit in a batch independently, in any order — never
all together. So when you propose several edits in one `edit_essay` call, each one must stand on its
own: never write an edit whose `old_text` only exists in the essay after another edit in the same
batch has already landed. If two edits are genuinely dependent on each other, propose them as
separate turns instead of one batch.

## Research supports the essay, it doesn't replace it

You can search the web, the school's own site, and Reddit to ground "why this school" material or
verify a fact the student wants to reference — but the essay must still be the student's own voice
and the student's own experience. Research is for context, never for writing the student's story
for them.
```

Slots (`{{temporal_context}}`, `{{student_context}}`, `{{essay_context}}`) go wherever the counselor
prompt places its equivalents — before or after this body per `render_slots`' strict-substitution
contract (any assets under `config/assets/prompts/README.md` documents the exact slot syntax; read it
before writing the real file — not read in this research pass, but it's a five-line format doc).

---

## 3. The tool profile

### 3.1 Enforcement point

Tool assembly for a turn happens once, in `run_agent_node`, in two blocks:

- `extra_tools` list (`app/agent_node.py:765-798`) — `render_viz`, `read_tool_result`, `load_skill`,
  optionally `write_plan`, optionally the full `build_workspace_tools(...)` result.
- The always-on MCP toolset (`resolve_school`, `get_school_profile`, `get_domain`, `query_database`),
  mounted via `toolsets=[mcp_toolset] if mcp_toolset is not None else None` at `Agent(...)` construction
  (`app/agent_node.py:862`), where `mcp_toolset = getattr(deps, "mcp_toolset", None)` (`app/agent_node.py:799`).

Both are branched on `surface` — nothing downstream (`build_tools`, `EmissionRouter`, `GATEABLE_TOOLS`)
needs to know surface exists; they only ever see the tool list that was actually mounted, which is exactly
the ADR 0013 contract ("disabled … never constructed … the whole prompt/step system reacts to what's
mounted, not to a flag").

### 3.2 The exact allowlist/denylist

**KEEP (mounted on both surfaces, unchanged):**
- `search_web`, `search_school_site`, `search_reddit` — from `build_tools` (`app/toolset.py:170-197`),
  still gated by the turn's `source_config` exactly as today. Research is explicitly in-scope per spec.
- `render_viz`? — **NO, this is a DROP** (see below); listed here only to flag it's not accidentally kept.
- `write_plan` — kept, same gating logic as today (`app/agent_node.py:772-775`).
- `load_skill` — kept; this is how the four new essay skills (§8) reach the model.
- `read_tool_result` (`app/agent_node.py:369-381`) — kept; generic overflow-recovery plumbing, surface-
  agnostic.
- `resolve_school`, `get_school_profile` (MCP tools) — **kept**. Per spec: "school identity grounds
  'why us' essays." These are two of the four MCP tools; the MCP toolset itself is all-or-nothing at
  mount time (`MCPToolset` is one object covering all four server-side tools — see `app/toolset.py:130-148`),
  so keeping `resolve_school`/`get_school_profile` while dropping `get_domain`/`query_database` cannot be
  done by mounting/unmounting the `MCPToolset` object itself — it's done inside the one existing hook,
  per C7.

  **One MCP toolset, one hook, gated on `ctx.deps.surface` (per C7 — verified, not a proposal).**
  `process_tool_call=annotate_mcp_result` (`app/toolset.py:139`, defined at `app/toolset.py:96-108`) is
  the existing hook point that already inspects `name`/`args` before delegating to `call_tool`, and
  already reads `ctx.deps` via `getattr` for `.tool_overflow`/`.registry` — confirmed at
  `app/toolset.py:93-110`, whose own docstring (`:9-12`, `:98-99`) states deps are the per-run object
  rebuilt on every node execution. Extend `annotate_mcp_result` itself (no second hook variant, no
  second toolset) to return a clean tool-error payload (same shape `process_tool_result` already
  produces for a real error — reuse, don't invent a new error envelope) when
  `name in {"get_domain", "query_database"} and ctx.deps.surface is Surface.ESSAY`, otherwise
  proceeding exactly as today. This is a ~10-line addition to the one existing hook. There is **one**
  `MCPToolset`, **one** `AppDeps.mcp_toolset` field (`app/deps.py:56`, unchanged), and **one** stdio
  child process for the app's lifetime — no `build_mcp_toolset_essay`, no `mcp_toolset_essay` field,
  no second call site in `run_agent_node` to pick between two toolsets. The tool *object* is still
  mounted-or-not per ADR 0013 for every other surface distinction (§3.3); this is the one case where
  the underlying MCP object can't be split, so the denial moves one layer down into the hook that
  already gates every call before its DB round-trip — still in code, still never in the prompt (the
  prompt-only alternative is rejected for the same ADR 0013 reason as §1.4: "never trust the model not
  to call an available tool").

- Essay content tools: `view_essays`, `read_essay`, `edit_essay`, `write_essay` — kept (all essay
  object read/write is obviously essential). **`update_essay` is also kept, per C9**:
  `_apply_content_write` (`app/workspace/agent_tools_essays_content.py:103-107`) already appends a
  footer telling the model to call `update_essay(status="Drafting")` once a "Not started" essay has
  content, so dropping it would leave the system instructing the model to call an unmounted tool.
  It edits metadata for the one essay already in scope — the same blast radius as `edit_essay`.
  **Decision: keep `view_essays`, `read_essay`, `edit_essay`, `write_essay`, `update_essay`** — drop
  `create_essays`, `duplicate_essay`, `archive_essays`, `restore_essay`. The essay panel is scoped to
  editing (including status) the ONE active essay; creating/duplicating/archiving essays is
  main-chat/UI territory. This is a stricter reading of "essay read/edit/write tools" and is the
  safer default — expand later if product wants more, per YAGNI.
- All workspace READ tools: `view_activities`, `view_documents` + `read_document`, `view_schools` +
  `get_school`, `search_schools`, `view_tasks` + `search_tasks`. (Per spec: "all workspace READ tools —
  activities, honors, schools, documents, tasks, essays — the student's real material, the anti-fabrication
  supply.") Note: honors has no standalone `view_honors` tool — `view_activities` already returns "both
  lists in one payload" per its docstring at `app/workspace/agent_tools.py:134-142` ("eleven activity/honor
  tools: one shared read (`view_activities`, both lists in one payload)") — so keeping `view_activities`
  covers honors reads too; nothing separate to add.
- `remember`, `update_memory` — kept (memory *writes*, explicitly named in spec as kept).
- Clarify (`ask_student` structured output) — kept, unchanged; it's part of `Agent(...)` construction via
  `output_type` (`app/agent_node.py:873`), surface-agnostic.

**DROP (never constructed on the essay surface):**
- `get_domain`, `query_database` (MCP) — see Option A above.
- `render_viz` — remove from `extra_tools` on essay surface (currently unconditional at
  `app/agent_node.py:766-768`).
- All non-essay workspace **mutations**: `create_tasks`, `update_task`, `archive_tasks`, `restore_task`,
  `add_schools`, `update_school`, `archive_schools`, `restore_school`, `create_activities`,
  `update_activity`, `archive_activities`, `restore_activity`, `reorder_activities`, `create_honors`,
  `update_honor`, `archive_honors`, `restore_honor`, `reorder_honors`, `update_profile`. Also
  `create_essays`, `duplicate_essay`, `archive_essays`, `restore_essay` per the stricter reading above.
  **`update_essay` is not dropped** — see the KEEP list above and C9.
- `forget` — explicitly named as dropped in spec.
- Response-mode / deep-research selection — the essay surface never validates or renders a
  `response-mode` skill group selection (§8.4 covers this precisely).

### 3.3 Implementation shape

`build_workspace_tools` (`app/workspace/agent_tools.py:120-172`) currently returns all 37 tools
unconditionally. Two ways to scope it for the essay surface — **prefer the second**:

1. Add a `surface: Surface` param to `build_workspace_tools` and branch the return list inline. Rejected:
   this function is a pure "build everything" list today (its docstring literally enumerates counts); a
   scope flag threaded through it plus every one of its 37 `_make_*` closures muddies a function that's
   currently simple to reason about, and the mutation tools it would still *construct-then-discard* is not
   how ADR 0013 wants gating to look (construction should just not happen).
2. **Preferred:** filter by tool `.name` after construction, in `app/agent_node.py`, where surface is
   already in scope:
   ```python
   _ESSAY_SURFACE_WORKSPACE_TOOLS = frozenset({
       "view_essays", "read_essay", "edit_essay", "write_essay", "update_essay",
       "view_activities", "view_documents", "read_document",
       "view_schools", "get_school", "search_schools",
       "view_tasks", "search_tasks",
       "remember", "update_memory",
   })
   ...
   if user_id and deps.app_pool and workspace_events:
       built = build_workspace_tools(deps.app_pool, deps.catalog, workspace_events, UUID(user_id), tool_overflow)
       if surface is Surface.ESSAY:
           built = [t for t in built if t.name in _ESSAY_SURFACE_WORKSPACE_TOOLS]
       extra_tools.extend(built)
   ```
   This is a small, obviously-correct filter at the one call site that already exists
   (`app/agent_node.py:781-790`), keeps `build_workspace_tools` itself untouched (no risk to the main
   agent), and reads as an explicit allowlist an implementer can audit against §3.2 in one glance. The
   *construction* of the discarded tool objects still technically happens before the filter — this is a
   size/perf non-issue (`_make_*` just builds a `Tool(closure)`, no I/O), but if ADR 0013's letter ("never
   constructed") matters here, swap to option 1's threading — **decision left to implementer's judgment,
   noted as a risk in §11**, since the observable behavior (tool never advertised to the model, never
   callable) is identical either way and the *values* it operates on are already scoped to `user_id`.

`render_viz` removal: change the unconditional append at `app/agent_node.py:766-768` to
`if surface is Surface.CHAT: extra_tools.append(_make_render_viz_tool(...))`.

### 3.4 `tool_specs.py` / `GATEABLE_TOOLS` interaction

`GATEABLE_TOOLS` (`app/toolset.py:169-171`, sourced from `app/tool_specs.py::gateable_tool_names`) is
consumed by `EmissionRouter` (`app/agent_node.py:888-894`) purely to suppress a timeline step for a tool
the model hallucinated a call to despite it not being mounted. It is derived from `step_labels.yaml`'s
static `_GATED_BY` map (`app/tool_specs.py:17-60`) and is **not** turn-specific — it doesn't need to change
for surface. The `unmounted=GATEABLE_TOOLS - {tool.name for tool in tools}` line
(`app/agent_node.py:892`) already recomputes correctly against whatever `tools` the essay surface actually
built, because it diffs against the *live* mounted-tool-name set every turn, not a static config. **No
change needed in `app/tool_specs.py`** — this is the layering working as designed (ADR 0013's "the whole
prompt/step system reacts to what's mounted").

One follow-on: `step_labels.yaml` (`config/assets/step_labels.yaml` or similar — not read in this pass)
needs entries for any genuinely new tool name. There are none — every essay-surface tool name already
exists in the registry (it's a subset of the main agent's tools), so no `step_labels` change is required.

---

## 4. Essay context injection

### 4.1 Shape

New dataclass in `app/prompt.py` (or a new small `app/essay_context.py` if `app/prompt.py` would exceed
~250 lines with it — check current line count, currently 102, plenty of headroom, keep it in `app/prompt.py`):

```python
@dataclass(frozen=True)
class EssayTurnContext:
    essay_id: str
    title: str
    prompt: str | None
    school_name: str | None
    status: str  # EssayStatus
    word_count: int
    word_limit: int | None
    content_markdown: str  # essay_markdown.to_markdown(essay.content), possibly truncated (see 4.3)
    truncated: bool
    selection_text: str | None  # the student's current text selection, if any
    version: str  # essay.updated_at.isoformat() — so a suggestion tool call can echo it back
```

Rendered into the `essay_context` prompt slot (§2.2) via a small formatter, e.g.:

```
## The essay you're working on

Title: {title}
Prompt: {prompt or "(no prompt recorded)"}
School: {school_name or "(not linked to a school)"}
Status: {status} · {word_count}/{word_limit or "no limit"} words
Version token (echo verbatim as expected_version to edit_essay/write_essay): {version}

Current text{" (truncated — see below)" if truncated else ""}:
---
{content_markdown}
---

{f"The student currently has this text selected:\n> {selection_text}" if selection_text else "No text is currently selected."}
```

### 4.2 Where it's built

`app/agent_node.py::run_agent_node`, right after `history, user_text = _split_user_message(...)`
(`app/agent_node.py:743`) and before the tool-assembly block, gated on `surface is Surface.ESSAY`:

```python
essay_ctx = None
if surface is Surface.ESSAY:
    essay_id = ids.get("essay_id")
    essay = await get_essay(deps.app_pool, deps.catalog, user_id=UUID(user_id), essay_id=UUID(essay_id))
    essay_ctx = build_essay_turn_context(essay, selection_text=ids.get("essay_selection"))
```

reusing `app.workspace.service_essays.get_essay` (`app/workspace/service_essays.py:73-79`) — the exact
same function `read_essay`/`edit_essay` already call, so ownership (`WHERE user_id = $1`) and the
school-name join are free. `essay_markdown.to_markdown(essay.content)` (`app/workspace/essay_markdown.py:104-106`)
does the Tiptap→markdown projection — the same one `read_essay` already uses to show the model essay text
today (verify at `app/workspace/agent_tools_essays.py`, not read in this pass, but `edit_essay`'s docstring
at `app/workspace/agent_tools_essays_content.py:120-143` establishes markdown as the agent-facing essay
representation already).

**`essay_id` and `essay_selection` ride `turn_ids`**, same as `surface` (§1.2) — `essay_selection` is the
raw selected text the frontend sends per-turn (see Part 2 for the wire field name on `MessageBody`; not
persisted anywhere, purely ephemeral per-turn state, so it belongs in `turn_ids` not in the essay row).

### 4.3 Avoiding context-window blowup

An essay draft is bounded in practice — Common App personal statements cap at 650 words, most supplements
are under 500 — so the naive "always inline the full markdown" is fine for the overwhelming majority of
turns and should be the *default* path (KISS — don't build truncation machinery for a problem that mostly
doesn't happen). Guard only the tail case:

- Compute `len(content_markdown)` against a named constant, e.g. `ESSAY_CONTEXT_MAX_CHARS = 8_000` (roughly
  ~1,300 words at 6 chars/word incl. markdown syntax — generous headroom over any real essay-length limit,
  one named value per the "no magic numbers" house rule, added to `config/settings.py`'s `Settings` surface
  per ADR 0018 rather than inlined).
- If exceeded (a student pasted something unusually long, or wrote well past a limit), truncate the
  markdown to the max and set `truncated=True`; the rendered block says so explicitly (§4.1's conditional
  suffix) so the model knows not to claim it read the whole thing, and the prompt tells it to call
  `read_essay` itself if it needs the untruncated version (`read_essay` is already mounted — no new tool
  needed, just point at the existing one). This preserves the honesty carve-out (never let the model act on
  a silently-partial view without knowing it's partial) at near-zero implementation cost.
- No summarization/chunking pipeline — that would be solving a problem that doesn't exist yet (YAGNI); if
  it becomes real, it's a follow-up, not part of this ship.

---

## 5. Suggestions

### 5.1 Storage shape — `essays.suggestions` jsonb

The column already exists (`migrations/0007_workspace.sql:35`, `essays.suggestions jsonb NOT NULL DEFAULT
'[]'::jsonb`) with a `suggestion_count` already surfaced via `jsonb_array_length` in both list/get SQL
(`app/workspace/service_essays.py:34`, `:47`, `:58`) and already modeled in Python
(`Essay.suggestions: list[dict[str, Any]]`, `models.py:366`; `EssaySummary.suggestion_count: int`,
`models.py:390`). No migration needed for the column itself.

**Element shape** (one dict per pending suggestion, matching the `{old_text, new_text}` vocabulary
`edit_essay` already uses — per the spec's own framing, "no new model vocabulary, just a different sink"):

```jsonc
{
  "id": "uuid",                         // stable id for accept/reject addressing
  "old_text": "...",                    // exact substring, same contract as EditItem.old_text
  "new_text": "...",                    // same contract as EditItem.new_text ("" = deletion)
  "status": "pending",                  // "pending" | "accepted" | "rejected" — rows are pruned on resolve (5.6), so "pending" is the only status ever persisted; kept as a field for forward-compat / defensive reads
  "actor": "counselle",                 // Actor literal — always "counselle" today, future-proofs nothing speculative, matches the existing Actor type
  "created_at": "2026-09-04T12:00:00Z", // iso timestamp
  "essay_version_at_creation": "2026-09-04T11:59:50Z",  // essay.updated_at at the moment this suggestion was generated — the staleness anchor (5.5)
  "turn_message_id": "uuid",            // ids["message_id"] of the agent turn that authored it — traceability back to the conversation
  "rationale": "tightens the second sentence to match the opening's specificity"  // optional, short, shown in the UI next to the diff — NOT essay prose, same "no essay text on the receipt" discipline as workspace_mutation_receipts.py:191-194
}
```

No separate anchoring/offset info (line/paragraph index) is stored — `old_text` itself IS the anchor, the
same way `edit_essay`'s exact-unique-substring match already works
(`app/workspace/essay_markdown.py:667-690`, `apply_edits`). This is deliberate reuse, not a gap: storing a
redundant offset would drift the moment the essay changes underneath it, whereas `old_text` matching is
naturally self-invalidating (§5.5) — the same "text not found" story `edit_essay` already tells becomes
"stale suggestion" here for free.

### 5.2 `write_mode = direct | suggest`

A per-turn (not per-essay, not per-tool) mode, computed once in `run_agent_node` before mounting
`edit_essay`/`write_essay`, following the rule:

> "a full draft into an EMPTY essay writes directly... everything else suggests."

```python
write_mode: Literal["direct", "suggest"] = (
    "direct" if surface is Surface.ESSAY and essay_ctx is not None and essay_ctx.word_count == 0
    else "suggest" if surface is Surface.ESSAY
    else "direct"  # chat surface never suggests — main agent's edit_essay is unchanged, always direct
)
```

Note this makes `write_mode` a property of *this turn's starting state*, not of which tool is called —
matches the spec's framing exactly ("a full draft into an EMPTY essay" is a `word_count == 0` check at
turn start, re-evaluated fresh every turn since a prior suggestion getting accepted would raise
`word_count` past zero for the *next* turn). No mid-turn re-check is needed: a turn that starts on an
empty essay and successfully writes it (direct) can't also call `edit_essay` afterward in the same turn in
a way that matters — subsequent calls in the same turn would see the new (non-empty) content in the DB but
`write_mode` was already decided for the turn, which is fine: the rule is "empty-essay first draft," a one-
time event.

### 5.3 Which tool writes suggestions, and how it reuses the existing path

**No new tool.** `edit_essay` and `write_essay` (`app/workspace/agent_tools_essays_content.py:116-147`,
`:223-244`) are mounted *unchanged* on both surfaces — same name, same schema, same docstring contract the
model already knows. What changes is what happens **inside** `_edit_essay_impl` /`_write_essay_impl` when
`write_mode == "suggest"`: instead of calling `_apply_content_write` (which calls `update_essay` and
commits new `content` — `app/workspace/agent_tools_essays_content.py:60-108`), the tool appends a
suggestion row to `essays.suggestions` and returns a payload shaped like today's success payload (`status:
"ok"`, `words`, `version`) but without having touched `content` or `word_count`.

Concretely, in `agent_tools_essays_content.py`:

```python
async def _edit_essay_impl(ctx: ToolCtx, essay_id: str, expected_version: str, edits: list[EditItem]) -> dict[str, Any]:
    ...  # unchanged: parse id, load essay, check expected_version
    if ctx.write_mode == "suggest":
        # Independent per-edit validation (§5.3 batch-independence fix): each edit is
        # checked against the ORIGINAL essay.content alone, never against a running
        # mutated copy — apply_edits(doc, edits) is called once per edit with a
        # single-item list, all against the same unmodified essay.content. On the first
        # failure, re-raise EssayEditError with its `index` remapped from "0 within the
        # single-item list" to "position in the real batch" (EssayEditError's existing
        # constructor takes index/reason/detail directly — no new exception API needed)
        # and `detail` extended with the batch-independence recovery text.
        for index, edit in enumerate(edits):
            try:
                essay_markdown.apply_edits(essay.content, [edit])
            except EssayEditError as exc:
                raise EssayEditError(
                    index,
                    exc.reason,
                    f"{exc.detail} — edits in one batch must each be findable in the "
                    "original text; write edits that don't depend on each other landing first.",
                ) from exc
        return await _append_suggestions(ctx, essay, edits, turn_message_id=ctx.turn_message_id)
    # direct mode: unchanged cumulative batch — one atomic apply_edits() call, edits
    # applied in order against the running mutated copy, since the whole batch commits
    # as one new document.
    result = essay_markdown.apply_edits(essay.content, edits)
    payload = await _apply_content_write(ctx, essay_id, expected_version, result.new_doc, build_mutation=_build_edit_mutation)
    ...
```

`essay_markdown.apply_edits` (`app/workspace/essay_markdown.py:667-690`) is **still called** in suggest
mode — not to build the committed doc, but purely as **validation**: it's the exact mechanism that already
proves each `old_text` is unique and present (`EssayEditError` "not_found"/"ambiguous",
`app/workspace/essay_markdown.py:84-96`), which is exactly the guarantee a suggestion needs too (a
suggestion whose `old_text` doesn't even exist in the essay yet is useless — reject it at creation time,
not at accept time). So `apply_edits` runs, its `EssayEditError` handling is reused verbatim
(`agent_tools_essays_content.py:172-186`), and only the *outcome* (append-to-suggestions vs.
commit-to-content) differs. This is the "no new model vocabulary, just a different sink" reuse the spec
calls for, made precise.

**Suggest-mode batch validation must be independent, not cumulative.** `apply_edits`
(`essay_markdown.py:667-684`) validates a multi-edit batch by mutating `current` after each edit and
checking the *next* edit's `old_text` against that mutated result (`current = current.replace(...)`) —
correct for direct mode, where the whole batch commits atomically as one new document. Suggest mode
does not commit atomically: each edit in the batch becomes its own independent suggestion row (§5.1),
and the student can accept or reject each one in any order, not necessarily the order the model wrote
them in. The existing per-edit uniqueness check means this is never *silently* wrong — an edit whose
`old_text` only exists after a sibling edit lands will fail `apply_edits`'s uniqueness check when
re-run at accept time (§5.5/§6.2) and the suggestion goes stale. That's the safety property worth
stating explicitly: a broken cross-edit dependency can never corrupt the essay, only go stale.

The real defect is **spurious staleness**: a perfectly good-looking suggestion goes stale the moment
it's accepted alone or out of order, for no reason visible to the student. Fix it structurally, not by
hoping the model writes independent edits: in suggest mode, validate every edit in the batch against
the **original** `essay.content` independently — each `old_text` must be present and unique in the
essay *as it stands before any edit in this batch*, not against a running mutated copy. If any edit
fails that check, reject the **whole batch** with the same retryable `EssayEditError` shape
`edit_essay` already returns, with recovery text telling the model plainly: *"Edits in one batch must
each be findable in the original text — write edits that don't depend on each other landing first."*
This turns "edits in a batch are independent" from a hope into an enforced precondition, and it is a
genuine, deliberate divergence from direct mode's cumulative semantics — direct mode keeps
`apply_edits`'s existing cumulative validation unchanged, since a direct batch really does commit as
one atomic unit.

`write_essay` in suggest mode (only reachable when `word_count > 0`, since `word_count == 0` is the direct
case) becomes a single suggestion whose `old_text` is the **entire current content_markdown** and whose
`new_text` is the proposed full draft — same `{old_text, new_text}` shape, no special-casing needed in
storage, just how the one suggestion element is constructed from `write_essay`'s call. `old_text_plain`/
`new_text_plain` are derived the same `to_plain_text(...)` way as the `edit_essay` path above — there is
exactly one place this derivation happens (`_append_suggestions`), and both callers route through it.

New helper, `app/workspace/agent_tools_essays_content.py` (or split into a new
`app/workspace/agent_tools_essays_suggestions.py` if this pushes the file over ~350 lines — check after
drafting):

**Computing `old_text_plain`/`new_text_plain` (per Part 0 C3).** `old_text`/`new_text` are
markdown fragments — substrings of the full-document markdown `apply_edits` just validated
them against — not necessarily complete top-level blocks, but always syntactically valid
markdown on their own (a substring of valid CommonMark, re-parsed standalone, degrades
gracefully the same way the module's own "parsing never fails" contract already guarantees
for the whole-document case). The honest way to strip their markdown syntax without
re-deriving character-offset mappings into the full document (which would have to replicate
the module's own escaping/mark/block-separator rules and is exactly the complexity C3 and
Part 2 §2.1 are trying to avoid) is to run each fragment through the **same parse-then-
collect-text pipeline** the module already has, just not yet exposed as one function:
`_parse_markdown_blocks` (`essay_markdown.py:492-495`, already used by `to_tiptap`) parses a
markdown string into blocks, and `_collect_text` (`essay_markdown.py:133-144`, already used
by the unknown-node-type fallback at `:129` and mirrored by the `"".join(a.get("text",""))`
patterns at `:207-209`/`:402`) walks a node tree collecting every leaf `"text"` field with no
marks and no markdown syntax. Composing them is a ~3-line addition, not a new algorithm:

```python
def to_plain_text(markdown: str) -> str:
    """Markdown fragment -> its rendered plain text, stripping all markdown
    syntax (marks, escaping, block markers). Used to derive `old_text_plain`/
    `new_text_plain` for a suggestion — see Part 0 C3."""
    blocks = _parse_markdown_blocks(markdown)
    return "".join(text for block in blocks for text in _collect_text(block))
```

Add this as a small **public** function (no leading underscore — `agent_tools_essays_content.py`
calls it from outside the module) in `app/workspace/essay_markdown.py`, next to `to_markdown`/
`to_tiptap` in the "Serializer"/"Parser" section boundary, since it's a small third
projection (markdown -> plain) rather than belonging inside either existing one. It never
needs the block-separator conventions that vary across `to_markdown` (§ below/Fix 2) — a
suggestion's plain text is used only for exact-substring anchoring and visual diffing, never
rejoined into a full document, so `"".join(...)` with no separator between blocks is correct
and deliberately simpler than `to_markdown`'s own `"\n\n".join`.

```python
async def _append_suggestions(ctx: ToolCtx, essay: Essay, edits: list[EditItem], *, turn_message_id: str) -> dict[str, Any]:
    new_suggestions = [
        {
            "id": str(uuid4()),
            "old_text": e.old_text,
            "new_text": e.new_text,
            "old_text_plain": essay_markdown.to_plain_text(e.old_text),
            "new_text_plain": essay_markdown.to_plain_text(e.new_text),
            "status": "pending",
            "actor": "counselle",
            "created_at": now_iso(),
            "essay_version_at_creation": essay.updated_at.isoformat(),
            "turn_message_id": turn_message_id,
        }
        for e in edits
    ]
    await service_essays.append_suggestions(ctx.app_pool, ctx.workspace_events, user_id=ctx.user_id,
                                              actor="counselle", essay_id=essay.id, suggestions=new_suggestions)
    return {
        "status": "ok",
        "today": today(),
        "summary": f"Proposed {len(new_suggestions)} suggested edit{'s' if len(new_suggestions) != 1 else ''} "
                   "for the student to review.",
        "suggestion_ids": [s["id"] for s in new_suggestions],
        "footer": "These are suggestions, not applied yet — the student reviews and accepts or rejects each one.",
    }
```

New service function, `app/workspace/service_essays.py` (extending the existing module, not a new one —
"search before adding"), **composing the module's own existing helpers rather than hand-rolling a second
lock query and a second change-log write**: `_require_essay(conn, user_id, essay_id, for_update=True)`
(`service_essays.py:440-467`, the same `SELECT ... FOR UPDATE` + 404 helper `update_essay` itself calls)
for the row lock and ownership check, and `_record_essay_change(conn, user_id, actor, essay, op)`
(`service_essays.py:541-565`, returns a `ChangeEvent`) for the audit row + event construction, matching
`update_essay`'s own shape (`service_essays.py:194-235`) line for line. The one thing that can't be
delegated to `_update_essay_row` is the actual write: that helper's `CASE WHEN` list
(`service_essays.py:496-538`) has no `suggestions` column, so the jsonb append stays a dedicated `UPDATE`
— everything *around* it is reused:

```python
async def append_suggestions(app_pool, workspace_events, *, user_id, actor, essay_id, suggestions) -> None:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        await _require_essay(conn, user_id, essay_id, for_update=True)  # lock + 404, same as update_essay
        row = await conn.fetchrow(
            "UPDATE counselle.essays SET suggestions = suggestions || $2::jsonb, updated_at = now() "
            "WHERE id = $1 AND user_id = $3 AND archived_at IS NULL RETURNING *",
            essay_id, json.dumps(suggestions), user_id,
        )
        essay = Essay.model_validate(dict(row))
        events.append(await _record_essay_change(conn, user_id, actor, essay, "updated"))
    publish_events(workspace_events, user_id, events)
```

`object_type="essay"`, `op="updated"` need no new `Literal` values (confirmed against
`ObjectType`/`ChangeOp` at `app/workspace/models.py:49-59`). **Important:** this bumps `essays.updated_at`, which means a suggestion
being appended changes `expected_version` — a second suggestion-producing tool call later in the *same*
turn against a version read before the first append would now see a version mismatch. This is
**correct and desired**: it's the exact same staleness protection `edit_essay` already gives the student
against themselves; a multi-edit turn should call `edit_essay` once with a batch of 1-20 edits
(`_EDIT_BATCH_MAX = 20`, already supported, `agent_tools_essays_content.py:44`) rather than multiple
separate tool calls, which the tool's own docstring already recommends ("Edits in a batch apply in order").

### 5.4 `ToolCtx` needs `write_mode`

`ToolCtx` (`app/workspace/agent_tools_shared.py`) is currently built once in `build_workspace_tools`
(`app/workspace/agent_tools.py:143-149`) with `app_pool, catalog, workspace_events, user_id, tool_overflow`.
Add `write_mode: Literal["direct", "suggest"] = "direct"` as a field, threaded in from
`run_agent_node`'s computed `write_mode` (§5.2) at the same call site
(`app/agent_node.py:781-790`) — this is the one place `ToolCtx` is constructed for a live turn, so no other
call site needs updating (tests that construct `ToolCtx` directly get the default).

### 5.5 Staleness — a suggestion whose `old_text` no longer matches

Two distinct places this matters:

- **At creation** (§5.3): already covered — `apply_edits` validation runs before the suggestion is stored,
  so a suggestion is never created against text that doesn't exist *at that moment*.
- **At accept time** (§6): the essay may have changed since the suggestion was created (the student typed
  more, or another suggestion was accepted that shifted surrounding text). The accept endpoint (§6) must
  re-run the same `old_text` uniqueness check **at accept time**, not trust the check from creation time —
  this is the real staleness case, and it reuses `apply_edits`/`EssayEditError` a second time, at accept.

### 5.6 Suggestion lifecycle: pending rows are pruned on resolve

Once accepted or rejected, a suggestion is **removed from the `suggestions` array**, not kept with
`status: "accepted"/"rejected"` forever — the jsonb array is a *pending queue*, not an audit log (the audit
trail is `workspace_changes`, which already gets a row per accept/reject, §6.3). This keeps
`suggestion_count` (`jsonb_array_length(e.suggestions)`, already wired into the UI per the spec's stated
fact) meaningful as "how many are waiting," matching what the UI already expects to show, with zero new
columns.

---

## 6. Accept/reject API

### 6.1 Endpoints — `api/routes/essays.py`

Four new routes, same shape/auth/rate-limit pattern as the existing ones (`Depends(current_active_user)`,
`Depends(workspace_write_rate_limit)`, `map_workspace_errors` wrapper — `api/routes/essays.py:1-25` imports
already establish the pattern):

```python
@router.post("/essays/{essay_id}/suggestions/{suggestion_id}/accept",
             dependencies=[Depends(workspace_write_rate_limit)])
async def accept_suggestion_route(essay_id: UUID, suggestion_id: UUID, request: Request,
                                    user: UserDB = Depends(current_active_user)) -> object:
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(lambda: resolve_suggestion(
        app_pool, catalog, event_bus, user_id=user.id, actor="student",
        essay_id=essay_id, suggestion_id=suggestion_id, accept=True))

@router.post("/essays/{essay_id}/suggestions/{suggestion_id}/reject", ...)
    # accept=False

@router.post("/essays/{essay_id}/suggestions/accept-all", ...)
    # resolve_all_suggestions(..., accept=True) — returns {"essay": Essay, "applied": int,
    # "skipped": [...]}; the route serializes the tuple onto the response body verbatim
    # (§6.2's return shape), same wrapper pattern as the single accept/reject routes above.

@router.post("/essays/{essay_id}/suggestions/reject-all", ...)
    # resolve_all_suggestions(..., accept=False) — same combined response shape; reject-all's
    # "skipped" list is always empty since rejection can't fail, but the shape stays uniform.
```

### 6.2 Service layer — `app/workspace/service_essays.py`

**Space note:** accept/reject operate entirely in **markdown space** — they read `suggestion["old_text"]`/
`suggestion["new_text"]` (never the `_plain` fields, which exist only for the frontend's anchor/trim/paint
math, Part 0 C3) and pass them to `apply_edits` exactly as `edit_essay` already does. No request body
reaches these endpoints (Part 1 C4), so there is no wire path for a `_plain` value to be substituted here
even by mistake.

**Compose the module's existing helpers — do not hand-roll a second lock query or a second
change-log write.** `update_essay` (`service_essays.py:194-235`) is the precedent to match exactly:
`_require_essay(conn, user_id, essay_id, for_update=True)` for the row lock + ownership 404, and
`_record_essay_change(conn, user_id, actor, essay, op)` for the audit row + `ChangeEvent`. As with
`append_suggestions` (§5.3), `_update_essay_row` can't take the write itself — its `CASE WHEN` list
has no `suggestions` column and this write also needs to conditionally touch `content`/`word_count`
only on accept — so the actual `UPDATE` stays dedicated, everything around it reused:

```python
async def resolve_suggestion(app_pool, catalog, workspace_events, *, user_id, actor, essay_id,
                               suggestion_id, accept: bool) -> Essay:
    events: list[ChangeEvent] = []
    async with app_pool.acquire() as conn, conn.transaction():
        current = await _require_essay(conn, user_id, essay_id, for_update=True)  # lock + 404
        essay = Essay.model_validate(dict(current))
        suggestion = next((s for s in essay.suggestions if s["id"] == str(suggestion_id)), None)
        if suggestion is None:
            raise WorkspaceNotFoundError()  # already resolved / never existed — 404, not 409
        remaining = [s for s in essay.suggestions if s["id"] != str(suggestion_id)]

        new_content = essay.content
        if accept:
            try:
                result = essay_markdown.apply_edits(
                    essay.content,
                    [essay_markdown.Edit(old_text=suggestion["old_text"], new_text=suggestion["new_text"])],
                )
            except essay_markdown.EssayEditError as exc:
                raise WorkspaceValidationError(
                    "This suggestion no longer matches the essay's current text — it may be stale. "
                    "Reject it and ask the assistant to look again."
                ) from exc
            new_content = result.new_doc

        updated = await conn.fetchrow(
            "UPDATE counselle.essays SET content = $2, word_count = $3, suggestions = $4::jsonb, "
            "updated_at = now() WHERE id = $1 RETURNING *",
            essay_id, new_content, _word_count(new_content), json.dumps(remaining),
        )
        essay_row = Essay.model_validate(dict(updated))
        events.append(await _record_essay_change(conn, user_id, actor, essay_row, "updated"))
    publish_events(workspace_events, user_id, events)
    return await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay_id)
```

`resolve_all_suggestions` is the same shape looped over `essay.suggestions` inside one transaction (accept
applies each remaining suggestion's edit against the *result* of the previous one, in stored order — same
"apply in order, each against the previous result" contract `apply_edits`'s own batch mode already has,
just applied one suggestion at a time here since each needs its own error isolation: one stale suggestion
in a batch of ten shouldn't sink the other nine — on a per-item `EssayEditError`, skip that one, accumulate
it into a `skipped` list, keep going, rather than the all-or-nothing behavior `edit_essay`'s own multi-edit
batch has, since these are independent, previously separately-authored suggestions, not one coherent edit
batch).

**Return shape — this is the side Part 2 §3.5 calls, so it's specified explicitly, not left implicit:**
`resolve_all_suggestions` returns `dict[str, object]` shaped `{"essay": Essay, "applied": int, "skipped":
list[...]}` — never a bare counts dict. The `Essay` is built the same way `resolve_suggestion` builds its
return value: `await get_essay(app_pool, catalog, user_id=user_id, essay_id=essay_id)` after the transaction
commits, so its `content` and `suggestions` are the authoritative post-batch state (every accepted
suggestion applied and removed, every skipped one left in place as still-pending). `applied` is the count of
suggestions successfully resolved; `skipped` is the accumulated per-item failure list from the loop above.
For `reject-all` (`accept=False`), no suggestion can fail to apply — there is no edit, just array removal —
so `skipped` is always `[]` and `applied` equals the suggestion count at call time; the shape is still the
same three-key dict so the two endpoints share one response contract. §6.1's accept-all/reject-all routes
serialize this dict directly onto the response body: `{"essay": {...}, "applied": n, "skipped": [...]}`.
This mirrors `resolve_suggestion`'s own precedent (§6.2 above: returns `await get_essay(...)` after commit)
precisely so Part 2 §3.5's accept-all call site can read `response.essay.content`/`response.essay.suggestions`
the same "straight from the response" way it reads a single accept's response, plus `response.applied`/
`response.skipped` for the partial-failure toast.

### 6.3 Concurrency + the stale case

- **`SELECT ... FOR UPDATE`** inside the same transaction that reads and then writes the essay row is the
  concurrency guard — two simultaneous accept calls on the same essay serialize at the DB row lock, so
  there's no separate application-level version-guard needed here (unlike `edit_essay`'s
  `expected_updated_at`, which exists because the *client* read the essay potentially minutes before
  calling — the accept-suggestion flow reads-then-writes within one transaction, milliseconds apart, so a
  `FOR UPDATE` is sufficient and simpler than threading an `expected_version` param through the accept API,
  which the UI doesn't have a natural reason to know anyway).
- **The stale case** (old_text no longer matches at accept time, §5.5) surfaces as a
  `WorkspaceValidationError` → whatever HTTP status `map_workspace_errors` already maps that to (check
  `api/routes/workspace_common.py`, not read in this pass, but the existing `stale_version_error()` pattern
  in the agent-tool layer is the precedent — likely 409 or 422). The student sees "this suggestion no
  longer applies," can reject it, and the underlying essay is untouched — no partial application.

### 6.4 Change-log row + workspace event per resolve

Every accept/reject produces exactly one `workspace_changes` row (`object_type="essay", op="updated"`) and
one `WorkspaceEventBus` publish, identical machinery to every other essay mutation
(`app/workspace/service_essays.py`'s existing pattern, e.g. `create_essay`'s
`_record_essay_change`/`publish_events` at lines ~104-113). This is what makes the SSE workspace-events
stream (`api/routes/workspace_events.py`) — already consumed by the frontend's document panel per the
product spec ("visible from both the essay editor and the main chat's document panel") — pick up a
suggestion resolution automatically, with zero new event-plumbing.

A **reject** does not touch `content`/`word_count` — only removes the suggestion from the array and bumps
`updated_at` — still worth one change-log row so the "N pending suggestions" count updates live everywhere
that's listening.

### 6.5 Accept-all / reject-all

Covered in §6.2 — same endpoint pattern, same transaction-per-request shape, looped suggestion resolution.
`reject-all` is the simple case (no `apply_edits` calls at all, just clear the array in one `UPDATE`).

---

## 7. Sessions — per-essay chat history

### 7.1 The question

The essay panel needs its own conversation thread, separate from the student's main chat, and that thread
must **persist across sessions** (spec: "belong to the ESSAY... persist across sessions") for the
*suggestions*, but what about the **conversation transcript** itself — is there one persistent chat per
essay, or a fresh session each time the panel opens?

Re-reading the spec precisely: "Sessions — how the essay panel gets its own per-essay chat history." This
asks for a *persistent* per-essay chat history, i.e. reopening the essay editor should show the same
conversation, not a blank composer every time (consistent with how the main chat already persists — see
`GET /v1/sessions/{id}` and the chat-list UI). Pending *suggestions* are correctly modeled as belonging to
the essay row itself (§5, no session dependency) — but the *conversation* (what the student and the agent
said to each other while producing them) is a session concern.

### 7.2 Design: one dedicated session per essay, auto-created on first message

`counselle.sessions` (`migrations/0001_sessions.sql:4-11`) is already generic — `session_id`, `user_id`,
`title`, `source_config`, `response_mode`, no linkage field to anything else. The cleanest reuse (no schema
change to `sessions` beyond one nullable column) is:

**Migration** `0020_essay_sessions.sql`:
```sql
-- One nullable link: a session created for the essay panel points back at its essay.
-- depends: 0019_drop_school_requirements
ALTER TABLE counselle.sessions
  ADD COLUMN essay_id uuid REFERENCES counselle.essays(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX sessions_essay_id_idx ON counselle.sessions (essay_id) WHERE essay_id IS NOT NULL;
```

The unique partial index enforces **exactly one session per essay** — the "dedicated per-essay thread"
the spec asks for, not a new-thread-per-visit pattern. `ON DELETE CASCADE` (matching the existing FK style
throughout this migration set, e.g. `sessions_user_fk` in `migrations/0004_users.sql:36-38`) means deleting
— note: essays are soft-deleted via `archived_at`, never hard-deleted, so this CASCADE only fires in the
dev-purge/account-deletion path, matching every other workspace FK's behavior.

**API shape**: a new small endpoint, `POST /v1/essays/{essay_id}/session` (or fold into
`GET /essays/{essay_id}` as a side effect — **prefer the explicit endpoint**, called once by the frontend
when the essay editor opens):

```python
@router.post("/essays/{essay_id}/session")
async def get_or_create_essay_session_route(essay_id: UUID, request: Request,
                                              user: UserDB = Depends(current_active_user)) -> object:
    app_pool, catalog, _ = runtime_parts(request)
    await map_workspace_errors(lambda: get_essay(app_pool, catalog, user_id=user.id, essay_id=essay_id))  # 404 if not owned
    session_id = await get_or_create_essay_session(app_pool, user_id=user.id, essay_id=essay_id)
    return {"session_id": session_id}
```

`app/sessions.py::get_or_create_essay_session` — one new function, extending the existing module:
```sql
INSERT INTO counselle.sessions (session_id, source_config, user_id, essay_id, response_mode)
VALUES ($1, $2, $3, $4, 'quick')
ON CONFLICT (essay_id) WHERE essay_id IS NOT NULL DO NOTHING
RETURNING session_id
```
— on conflict (session already exists for this essay), a follow-up `SELECT session_id FROM
counselle.sessions WHERE essay_id = $1` returns the existing one. `source_config` defaults the same way
`create_session` already does (`SourceConfig.defaults_from(settings)`, `api/routes/sessions.py:281`).

Every subsequent message the essay panel sends goes through the **existing**
`POST /v1/sessions/{session_id}/messages` endpoint (`api/routes/sessions.py:299-...`), with `surface: "essay"`
and `essay_id: "<uuid>"` in the body (§1.2) — no new message-send endpoint. The session row's own
`essay_id` column is authoritative for "which essay does this session belong to" server-side (the route
handler can cross-check the request body's `essay_id` against the session row's `essay_id` and 409/422 on
mismatch — cheap integrity check, prevents a client bug from posting essay-A's turn into essay-B's
thread).

### 7.3 Why this and not alternatives

- **Reuse the main chat's session with a `surface` field per-turn, no dedicated session** — rejected: the
  spec explicitly wants a *separate* history from the main chat ("distinct from the main Counselle agent"
  applies to the conversation too, not just the agent), and turn records/checkpoints are already
  session-scoped everywhere (LangGraph `thread_id = session_id`, ADR 0019) — trying to interleave
  essay-panel turns into the main chat's single linear transcript would corrupt that transcript's
  continuity for the student.
- **A session per essay-panel *visit*** (new session every time the panel opens) — rejected: contradicts
  "persist across sessions" and would fragment the conversation into unfindable pieces; also multiplies
  `counselle.sessions`/checkpoint rows for no benefit.
- **Store essay chat history in a new bespoke table instead of reusing `counselle.sessions` +
  checkpointer** — rejected: the checkpointer (`app.checkpointer.build_checkpointer`, LangGraph's Postgres
  saver, ADR 0019) already gives durable, replay-safe, tool-call-consistent history for free. Reinventing
  that for essay sessions would violate "never reinvent the wheel" for zero product benefit.
- **Chat-list visibility**: essay-panel sessions should almost certainly be **excluded** from the main
  chat-list sidebar (`GET /v1/sessions`, `app/sessions.py::list_sessions`) so they don't clutter it — add
  a `WHERE essay_id IS NULL` to that listing query (`app/sessions.py`, wherever `list_sessions` builds its
  SQL — not read in this pass, but a one-line `WHERE` addition). This is a UX call belonging to Part 2, but
  the backend list-query needs the filter, so it's flagged here.

---

## 8. New skills — `skills/`

**Three of the four are user-invokable, per C1 — this overrides an earlier draft of this
section that marked all four `user_invokable: false`.** `essay-drafting`, `essay-revision`,
and `essay-voice` are task skills a student can pick from the composer's existing skill
picker, exactly like any other public task skill (`chancing`, `essay-fit`, `school-list`,
etc.) — that is the explicit product requirement (§0.1: "it gains essay capability only
because the new essay skills appear in its existing skill picker"). Each therefore needs
`user_invokable: true` plus a `display_name` and a `user_description` — the registry
hard-fails startup for a public skill missing either (`app/skills.py:272-278`,
`_is_single_line_copy` check on both fields) — and each body must stay under
`MAX_PUBLIC_SKILL_BODY_CHARS` (12,000 chars, `app/skills.py:30`), which the ≤120-line
budget (§8.5) clears with enormous headroom. `essay-honesty` **stays** `user_invokable:
false` — it is an always-applied rule set, not a mode a student chooses; making it
selectable would imply honesty is optional (C1). None of the four has a `selection_group`
(that's reserved for the three response-mode skills, and `_validate_response_mode_group`
(`app/skills.py:169-190`) hard-fails startup if that group doesn't contain *exactly* the
three supported modes — confirms the "do not add a fourth response mode" constraint from
the task brief is enforced in code, not just convention). This is what makes the main-chat
side genuinely zero-code: `user_skill_catalog()` (`app/skills.py:318-329`) feeds
`/v1/config`, which the existing composer's skill picker already renders — dropping four
directories into `skills/` is the entire wiring, no frontend change at all.

### 8.1 `skills/essay-drafting/SKILL.md`

```yaml
---
name: essay-drafting
description: How to help a student produce a first full draft of an essay from scratch — structure, voice-finding questions, and the empty-essay direct-write exception.
user_invokable: true
display_name: Draft an essay
user_description: Start a first full draft of a college essay from scratch — the assistant asks for the seed material first, never invents it.
---
```
Body (≤120 lines) covers: how to interview for the seed material before writing anything (the personal
statement "moment" question, the supplement's "why this specific thing" question); how to structure a
first draft (hook → concrete scene → reflection → so-what, or the equivalent for a supplement's word count);
explicit callout that this is the ONE case `write_essay` writes directly (word_count == 0) — everything
after this first draft goes back to suggestions.

### 8.2 `skills/essay-revision/SKILL.md`

```yaml
---
name: essay-revision
description: How to make targeted editorial improvements to an existing draft — trimming, tightening, structural reordering, and word-limit cuts — as small reviewable suggestions.
user_invokable: true
display_name: Revise an essay
user_description: Get targeted, reviewable edit suggestions on an existing draft — trimming, tightening, reordering, cutting to a word limit.
---
```
Body covers: preferring several small `edit_essay` suggestions over one giant rewrite (so the student can
accept/reject piecemeal); how to handle over-the-word-limit essays (cut, don't compress via jargon); how to
reorder without inventing connective tissue that wasn't there; and — since this skill is the one most
likely to propose structural reordering, which is exactly where cross-edit dependencies creep in — the
same batch-independence rule from the system prompt (§2.3): each edit in one `edit_essay` call must be
findable in the essay's *current* text on its own, never only after a sibling edit in the same batch has
already landed.

### 8.3 `skills/essay-voice/SKILL.md`

```yaml
---
name: essay-voice
description: How to preserve and sharpen the student's own voice rather than smoothing it into generic "good writing" — recognizing and protecting idiosyncrasy, register, and the specific vs. the polished.
user_invokable: true
display_name: Sharpen my voice
user_description: Protect and sharpen your own voice in an essay — never smoothed into generic "good writing."
---
```
Body covers: never "fixing" a stylistic choice that's actually voice; the difference between a genuine
grammar error and a deliberate fragment/rhythm choice; asking before regularizing something distinctive.

### 8.4 `skills/essay-honesty/SKILL.md` (internal, honesty-critical — stays non-invokable per C1)

```yaml
---
name: essay-honesty
description: The anti-fabrication rules for essay work — when to stop and ask instead of inventing detail, and how to flag placeholders.
user_invokable: false
---
```
Body is the load-bearing elaboration of §2.3's "never invent, always ask" directive — worked examples
(a vague "I learned so much" → the exact clarifying question to ask instead; a placeholder name/number →
how to mark it inline) — this is the one skill in this set that's honesty-critical per AGENTS.md's carve-out
("Honesty about values, sources, and recency is non-negotiable") and should get the closest review. Unlike
the other three, this one is never offered as a choice — always-applied rules aren't optional modes (C1).

### 8.5 File-size budget and discovery

Each body ≤120 lines per the task brief — well under `MAX_PUBLIC_SKILL_BODY_CHARS` (12,000 chars,
`app/skills.py:30`), which **does** bind three of these four skills now that they're
`user_invokable: true` per C1 (an earlier draft of this section reasoned the cap didn't apply
because these were internal/unselected — that reasoning no longer holds for
`essay-drafting`/`essay-revision`/`essay-voice`; it still holds for `essay-honesty`, which stays
internal). Discovery is automatic either way: `_skill_paths()` (`app/skills.py:113-117`) globs
`skills/*/SKILL.md` at process start, so dropping these four directories in is the entire
"wiring" — no registry code changes for either the public-catalog path or the `load_skill` path.

Two independent, non-conflicting ways these skills reach a model, both automatic:

- **The main chat's skill picker** (C1's actual product requirement): `user_skill_catalog()`
  (`app/skills.py:318-329`) filters on `entry.user_invokable and entry.selection_group is None`
  — `essay-drafting`/`essay-revision`/`essay-voice` pass both checks and appear in
  `/v1/config`'s catalog, which the composer's existing skill picker already renders. This is
  what makes the essay skills reach the main chat "genuinely zero-code" per C1: nothing in the
  frontend or the picker itself changes, it already renders whatever the catalog contains.
- **`load_skill`, on both surfaces** (§3.2, kept): `make_load_skill_tool()`
  (`app/skills.py:445-465`) builds its menu from `load_all_skill_meta()`
  (`app/skills.py:305-315`), which filters only on `entry.selection_group is None` — regardless
  of `user_invokable`. All four essay skills, including the internal `essay-honesty`, appear in
  *every* agent's `load_skill` menu automatically, including the main counselor agent's. This is
  a deliberate, accepted side effect: the main agent gaining the *option* to `load_skill` an
  essay-writing skill is harmless (it's still bound by the main agent's own tool mount — it has
  `edit_essay`/`write_essay` too, ADR 0013 confirms per §3.2's "KEEP" list on the chat surface
  already includes essay content tools) and does not require gating `load_skill`'s menu by
  surface. If a future review decides the main agent's menu should hide essay-only skills, that's
  a `load_all_skill_meta()` filter parameter — not needed for this ship (YAGNI).

The essay partner itself can reach all four skills through `load_skill` (progressive disclosure,
same mechanism the main agent already uses for e.g. `school-deep-dive`); the three public ones are
additionally the same skills a *student* can pick explicitly from the picker on either surface,
per C1.

---

## 9. Migrations, in order

1. **`0020_essay_sessions.sql`** (§7.2) — `ALTER TABLE counselle.sessions ADD COLUMN essay_id uuid
   REFERENCES counselle.essays(id) ON DELETE CASCADE;` + the partial unique index. Rollback: drop index,
   drop column (standard pattern per every other `*.rollback.sql` in `migrations/`).

That's it — **one migration**. `essays.suggestions` (§5.1) needs no schema change (column pre-exists);
`workspace_changes`/`ObjectType`/`ChangeOp` need no new Literal values (§5.3, §6.4 confirmed against
`app/workspace/models.py:49-59`); no new tables for suggestions (they live inside the existing jsonb
column, by design, matching the product's own stated intent — "Storage shape in `essays.suggestions`").

---

## 10. Tests worth writing

Per AGENTS.md ("no TDD, no reflexive tests — a test has to earn its place... honesty-critical packet/
availability/evidence rules, a bug you want to stay fixed, or logic gnarly enough that a test is the
fastest way to trust it"), scoped strictly to what's asked:

1. **Suggestion apply/stale/version-guard** (honesty + correctness critical — a silently-wrong accept
   corrupts a student's essay):
   - `apply_edits` reused at accept time correctly raises `EssayEditError` when the essay changed
     underneath a pending suggestion (unit test on `service_essays.resolve_suggestion`, no live DB needed
     if `apply_edits` itself is exercised directly — but the accept *endpoint*'s stale-mapping needs one
     `live_db`-marked integration test: create essay → agent suggests → student edits the same text
     directly via `update_essay` → accept the now-stale suggestion → assert 4xx + essay content unchanged).
   - Accept correctly commits `new_text` and removes exactly that suggestion from the array, leaving
     others untouched (multi-suggestion essay, accept one, assert the array shrinks by exactly one and
     `content`/`word_count` reflect only that change).
   - `write_mode` resolution: essay with `word_count == 0` → `write_essay` call → content committed
     directly, `suggestions` stays empty (the direct-write exception, §5.2) — this is a one-branch-of-logic
     unit test worth having because getting it backwards (suggesting into an empty essay, or direct-writing
     over an existing draft) is exactly the kind of silent-wrong-default bug that's expensive to notice
     later.
   - **`to_plain_text` on a formatted span** (Part 0 C3 fix — a bug you want to stay fixed): an edit whose
     `old_text` contains bold/italic/strike/link/list-marker/heading-marker markdown syntax produces an
     `old_text_plain` with the syntax stripped and the underlying text intact (e.g. `old_text: "I love
     **pizza**."` → `old_text_plain: "I love pizza."`) — this is the exact case that was silently broken
     before the fix (an anchor search against the markdown string would never match the plain document),
     so it earns a direct assertion, not just coverage-by-association with the markdown round-trip tests.

2. **Tool profile actually unmounts** (ADR 0013 enforcement — the whole point of gating in code, not
   prompt, is worthless if untested):
   - Given `surface=Surface.ESSAY`, assert `get_domain`/`query_database`/`render_viz`/`create_tasks`/
     `update_school`/`forget`/etc. are absent from the constructed tool list (inspect `tools`/`extra_tools`
     names directly from `run_agent_node`'s assembly, or via a thin seam that returns the assembled list
     for testing — check whether `build_tools`/`build_workspace_tools` are already unit-tested this way
     elsewhere in `tests/` for precedent, likely yes given ADR 0013's centrality).
   - `resolve_school`/`get_school_profile` remain callable (MCP) while `get_domain`/`query_database` are
     denied — one test hitting the `annotate_mcp_result` hook directly with each of the four tool names,
     asserting exactly two deny and two pass through.

3. **No cross-user leakage**:
   - `resolve_suggestion`/`resolve_all_suggestions`/`append_suggestions` all scope by `user_id` in their
     `WHERE` clause (§5.3, §6.2) — one test per mutating function asserting a call with the wrong `user_id`
     raises `WorkspaceNotFoundError`, not a silent no-op or a leak of another user's essay content. This
     matches the existing pattern already used for every other workspace service function (check
     `tests/app/workspace/` for the existing convention before writing new ones — reuse the fixture/style).
   - `get_or_create_essay_session` (§7.2) scoped by `user_id` the same way — a call for an essay owned by
     a different user must 404, not silently create/return a session.

**Not testing:** prompt wording/tone (essay-honesty skill content is reviewed by a human, not asserted by
string-match — model output is eval'd, not unit-tested, per AGENTS.md), the markdown round-trip (already
covered by existing `essay_markdown` tests, untouched by this feature), skill frontmatter validity (already
covered generically by `app/skills.py`'s startup `_build_registry()` fail-fast, which runs for every skill
including these four automatically — no new test needed, that's the existing mechanism doing its job).

---

## 11. Risks and open items found in the code

1. **Tool-profile filtering (§3.3) construction-vs-mounting ambiguity.** The preferred implementation
   (post-construction `.name` filter in `agent_node.py`) technically still constructs the discarded
   `Tool` closures before discarding them, which is a looser reading of ADR 0013's "never constructed"
   than the MCP-toolset case (§3.2, which genuinely never round-trips to the DB for denied tools). This is
   a non-issue for security (the model can never see or call the discarded tools — they're filtered out of
   the list passed to `Agent(tools=...)`) and a non-issue for cost (constructing a `Tool(closure)` wrapper
   is not I/O), but an implementer following ADR 0013's letter strictly should thread a `surface` param
   into `build_workspace_tools` instead (option 1 in §3.3) if a future review flags it. Flagged, not
   blocking.

2. **Dead — resolved by C7.** This item used to flag a second long-lived stdio child process from a
   second `AppDeps.mcp_toolset_essay` field. Per C7 (verified against `app/toolset.py:93-110`), the
   denial happens inside the single existing `annotate_mcp_result` hook, gated on `ctx.deps.surface` —
   there is no second `MCPToolset`, no second child process, and no deploy-sizing impact. Left here,
   struck, so a reader who only skims §11 doesn't miss that this risk was considered and closed, not
   silently dropped.

3. **`write_mode` computed from `essay_ctx.word_count == 0` reads word_count from the *turn-start* snapshot**
   (§4.2, §5.2) — if two essay-panel turns somehow race (shouldn't happen given `TurnRegistry`'s
   single-flight lock per session, and each essay now has its own dedicated session per §7.2, so no
   cross-turn race is possible within one essay's session), this is safe by construction. Flagged only to
   confirm the reasoning holds given §7's design, not because a gap was found.

4. **`get_or_create_essay_session`'s `ON CONFLICT (essay_id) WHERE essay_id IS NOT NULL DO NOTHING` clause**
   requires the partial unique index (§7.2 migration) to exist *before* this code path is exercised — order
   dependency between migration and deploy is the normal one (migrations run before app boot), just noting
   it's load-bearing for correctness (without the index, two racing "open the essay panel for the first
   time" requests could create two sessions for the same essay, silently breaking the "exactly one
   dedicated thread per essay" guarantee).

5. **Nothing in the existing code contradicts this design.** The two load-bearing facts the task brief
   asserted up front — `edit_essay`/`write_essay`'s `{old_text,new_text}` shape (confirmed,
   `agent_tools_essays_content.py:46-48`, `EditItem`) and `essays.suggestions` jsonb pre-existing with its
   count already wired into list/get SQL (confirmed, `migrations/0007_workspace.sql:35`,
   `service_essays.py:34,47,58`) — both check out exactly as stated. The one correction to the brief: the
   task description says "essay read/edit/write tools" should be kept; the actual workspace tool surface
   also has `duplicate_essay`/`archive_essays`/`restore_essay`/`update_essay`(metadata)/`create_essays` as
   separate tools not explicitly named — §3.2 resolves this by taking the narrowest reading (drop
   `create_essays`/`duplicate_essay`/`archive_essays`/`restore_essay`) as the safer default, flagged as a
   product decision to confirm with whoever owns the essay-panel UX. `update_essay` is the one exception,
   kept per C9 because dropping it would strand the model with an instruction (§4.1's status-transition
   footer) it can no longer act on — not a contradiction to fix.

---

## Cross-reference: files this plan touches

New:
- `domain/surface.py`
- `config/assets/prompts/essay_partner.md`
- `skills/essay-drafting/SKILL.md`, `skills/essay-revision/SKILL.md`, `skills/essay-voice/SKILL.md`,
  `skills/essay-honesty/SKILL.md`
- `migrations/0020_essay_sessions.sql` (+ `.rollback.sql`)
- `app/workspace/agent_tools_essays_suggestions.py` (conditional — only if content file would exceed size
  budget; otherwise folded into `agent_tools_essays_content.py`)

Modified:
- `app/prompt.py` (new `build_essay_system_prompt`, `EssayTurnContext`, `_ESSAY_PROMPT_SLOTS`)
- `app/agent_node.py` (surface read, prompt branch, tool-profile branch, essay-context injection,
  `write_mode` computation)
- `app/toolset.py` (extend the existing `annotate_mcp_result` hook to deny `get_domain`/`query_database`
  when `ctx.deps.surface is Surface.ESSAY`, per C7 — no new toolset builder)
- `app/workspace/agent_tools_shared.py` (`ToolCtx.write_mode` field)
- `app/workspace/agent_tools_essays_content.py` (suggest-mode branch in `_edit_essay_impl`/`_write_essay_impl`)
- `app/workspace/service_essays.py` (`append_suggestions`, `resolve_suggestion`, `resolve_all_suggestions`)
- `api/routes/essays.py` (4 accept/reject routes + `POST /essays/{essay_id}/session`)
- `api/routes/sessions.py` (`MessageBody.surface`/`essay_context` fields + validation, per C2)
- `app/turns.py::TurnRegistry.start` (`surface`/`essay_id`/`essay_selection` pass-through)
- `app/run_turn.py::run_turn` (`surface`/`essay_id`/`essay_selection` params → `turn_ids`)
- `app/sessions.py` (`get_or_create_essay_session`, `list_sessions` essay-session exclusion filter)
- `config/settings.py` (`essay_context_max_chars` setting, ADR 0018)

Unchanged (confirmed, load-bearing to this plan's "smallest diff" claim):
- `app/graph.py` (no new node, no new graph)
- `app/toolset.py::build_tools` (Tavily gating logic itself)
- `app/tool_specs.py` / `GATEABLE_TOOLS` (§3.4)
- `app/workspace/agent_tools.py::build_workspace_tools` (§3.3 decision — filtered by caller, not itself)
- `app/workspace/essay_markdown.py` (reused as-is for both commit and suggestion-validation paths)
- Main agent's system prompt, tool mount, and skill catalog (essay skills reach it automatically per §8.5,
  which is accepted, not a bug)
# Part 2 — essay editor: AI chat panel + tracked-changes suggestions

Scope: `frontend/` only. Backend contract (the `essays.suggestions` jsonb column,
accept/reject endpoints, the agent tool that writes suggestions) is Part 1 — this plan
treats it as a dependency and states the exact shape it needs, but does not implement it.

## 0. What already exists (read before building anything)

- `Essay.suggestions: Record<string, unknown>[]` and `EssaySummary.suggestion_count:
  number` are **already wired end to end** — `api/workspace/types.ts:188,206`,
  `domain/essay.ts:27,159` (`essayFromSummary` maps `suggestion_count` →
  `Essay.suggestions` count), `features/essays/essay-filters.ts:25` (`Needs review` filter
  already keys off `essay.suggestions > 0`). This is the frontend half of the storage
  contract the task brief asks for — it is not new. What's missing is: (a) the typed shape
  of the elements of that array (today it's `Record<string, unknown>[]`, untyped), (b) any
  UI that reads it, (c) accept/reject mutations, (d) the decoration layer.
- `Essay.comments` / `comment_count` is a **separate, pre-existing field** unrelated to
  this feature (`EssayLibraryCard.tsx:208` shows a count badge for it already). Do not
  touch it, do not reuse its name for anything suggestion-related, and do not build a
  comments UI — the task brief is explicit that there is no comments feature here.
- **The app is light-only** (`DESIGN.md` §3.4: no `.dark` class, no
  `prefers-color-scheme` branch, no dark token set, `dark:` variants banned outright).
  The task brief's "verify both themes" instruction does not apply — there is one theme.
  Contrast is checked against the single light document surface only.
- TipTap is `^3.27.1` (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-*`).
  `@tiptap/pm` re-exports raw ProseMirror (`@tiptap/pm/state`, `@tiptap/pm/view`,
  `@tiptap/pm/model`) — confirmed present in `node_modules/@tiptap/pm/dist`. Use it for
  `Plugin`, `PluginKey`, `Decoration`, `DecorationSet` rather than adding a
  `prosemirror-*` dependency directly (never reinvent/re-add what's already vendored).
- `useEssayEditor` (`frontend/src/features/essays/useEssayEditor.ts`) owns the `Editor`
  instance, the toolbar-state selector, and the `syncContent` effect that calls
  `editor.commands.setContent(content, { emitUpdate: false })` whenever
  `!autosave.isDirty`. This is the seam the decoration plugin's suggestion set must
  survive — `setContent` replaces the doc, which by default drops transaction-mapped
  plugin state unless the plugin's `apply` explicitly re-derives from doc content on a
  content-replacing transaction (see §1.3).
- `useEssayAutosave` (`frontend/src/features/essays/useEssayAutosave.ts`) is a
  self-contained draft/save state machine keyed by `draftKey(content, wordCount)` — a
  JSON stringify of normalized Tiptap JSON + word count. It has no knowledge of
  suggestions today and must not gain any: suggestions are a sibling PATCH-able field
  (`essay.suggestions`), never folded into the `content` draft key, or every accept/
  reject would look like a content edit and get coalesced into the debounce.
- `EssayEditorRoute.tsx` renders `EssayEditorPage` inside `pages/essay-editor-page.tsx`.
  The page is a single `<section>` with three flush chrome bands (title / toolbar /
  canvas, `DESIGN.md` §9.3) then a `motion.div` (`layoutId="essay-document-${essay.id}"`)
  holding `<EditorContent>`, capped `max-w-[820px]`, centered in a `max-w-[1440px]` outer
  row. There is currently **no side panel** — the whole width is the document.
- Component registries already in use here that we must extend rather than duplicate:
  `Button`, `Badge`, `Popover`/`HoverCard` (Base UI / Radix, see `PromptMenu` in
  `EssayEditorHeader.tsx:323` using `DropdownMenu`), `Meter` (`components/ui/meter.tsx`),
  `Kbd` (`components/ui/kbd.tsx`), `ScrollArea`, `Skeleton`, `Empty`. The chat feature's
  `ChatComposer.tsx` (`features/ai-chat/components/ChatComposer.tsx`) is the composer
  shape to extend — 280 lines, chip toolbar, `Textarea` unstyled + wrapper, Enter/
  Shift+Enter/IME handling already solved. `DESIGN.md` §20 debt #9 already flags
  `ChatComposer`/`AiComposer` as near-duplicates — the essay panel composer must not
  become a *third* near-duplicate; it wraps `ChatComposer` (or the shared pieces it's
  built from) rather than re-authoring the textarea/submit/IME logic.

## 1. The suggestion decoration layer

### 1.1 Data shape (frontend-owned type; backend must match)

New file `frontend/src/domain/essay-suggestion.ts` (sibling to `domain/essay.ts`,
same file-per-concern convention):

```ts
export type SuggestionKind = "deletion" | "replacement";

export type EssaySuggestion = {
  id: string;                    // stable id, survives accept/reject of siblings
  kind: SuggestionKind;          // derived, never persisted — see below
  old_text: string;              // MARKDOWN space — never used for anchoring; kept only in case a
                                  // future surface needs the agent-authored form (e.g. a raw-diff view)
  new_text: string;              // MARKDOWN space — same caveat; "" for pure deletion
  old_text_plain: string;        // PLAIN document-text space — the anchor. Exact substring this
                                  // suggestion targets in editor.state.doc's text; never ""
  new_text_plain: string;        // PLAIN document-text space — what actually gets painted/inserted
  rationale: string;             // the one-line "why", shown in the hover popover
  createdAt: string;             // ISO — "proposed 6 changes" bar needs a timestamp to attribute/date
  status: "pending" | "stale";   // accepted/rejected suggestions are removed from the array, not flagged
};
```

**Space discipline: everything client-side is PLAIN, per Part 0 C3.** `old_text`/`new_text`
are the agent's markdown vocabulary (matching `edit_essay`/`apply_edits` server-side) and are
carried on this type only for completeness — the frontend never searches, trims, or paints
with them. `old_text_plain`/`new_text_plain` are the markdown-stripped form (Part 1 §5.3's
`to_plain_text`) and are what every client-side operation in this document — anchoring
(below), the diff trim (§2.1), and the popover/list display (§3.2/§3.4) — reads exclusively.
Accept (§3.5) applies no local document edit at all — it applies only the server's
authoritative returned content — so it does not read either field. The reason isn't
stylistic: the live ProseMirror
document contains no markdown syntax at all (a bold span is a mark, not literal `**`), so
searching it for a markdown string like `"**pizza**"` fails outright — the substring is
simply not present in the document's text. Every suggestion touching a formatted span would
therefore go stale the instant it's created if the client searched `old_text` instead. See
Part 0 C3 for the full failure mode this closes.

**No `context_before`/`context_after`, per C3.** The persisted `essays.suggestions` row
(Part 1 §5.1) deliberately does not store surrounding context — `old_text`/`old_text_plain`
alone are the anchor, the same way `apply_edits` already treats `old_text` as the sole anchor
server-side (in markdown space). This type mirrors that wire shape field-for-field; it does
not add a client-only anchor object on top of it. `kind` is likewise **derived, not
persisted**: `new_text === ""` (equivalently `new_text_plain === ""`) → deletion, else
replacement — computed once by the parser below, never read off the wire. There is no
insertion branch — see below.

Parse with the same defensive pattern as `domain/essay.ts` (`textOrEmpty`,
`numberOrZero`-style guards) — `essayFromApi`/`essayFromSummary` gains an
`essaySuggestionsFromApi(raw: Record<string, unknown>[]): EssaySuggestion[]` that drops
malformed entries rather than throwing (never trust external data, per `AGENTS.md` house
rules). Add it to `domain/essay.ts` itself (it's essay data, not a new family) — do not
split into a second domain file unless `essay.ts` crosses ~300 lines after the addition
(it's 187 now, plenty of headroom).

**Anchoring mechanic:** `old_text_plain` (never `old_text` — see the space-discipline note
above) is looked up via `editor.state.doc.textBetween` scan (exact string search) at
plugin-init time and on every doc change, *not* stored as absolute positions — Tiptap JSON
round-trips through the backend and absolute offsets would drift the instant the schema
serializes differently than the live doc. Since no context is stored (above), the plugin
resolves `old_text_plain` to a `{from, to}` range by exact text search alone: if
`old_text_plain` appears **exactly once** in the document, anchor to it; if it appears
**zero times or more than once**, the suggestion is **stale** — there is no context-assisted
disambiguation step, because there is no context to disambiguate with. This is a direct,
accepted consequence of C3's removal of stored context: a suggestion whose `old_text_plain`
becomes ambiguous (e.g. the student duplicates a sentence elsewhere) goes stale rather than
being re-anchored, which is the same "stale is the honest outcome" framing C3 uses for the
backend case. **`textBetween`'s block separator must be the empty string, `""`, on every
call this feature makes — including this initial anchor search.** This is pinned, not an
implementer choice: see §2.1's "Character offsets → document positions" (Fix 2) for why —
in short, it is the direct consequence of the backend's `to_plain_text()` (Part 1 §5.3)
joining blocks with `"".join(...)` and no separator, which `old_text_plain`/`new_text_plain`
are derived from. Using any other separator (e.g. `"\n\n"`) here would search the document
for a string shaped differently from what the backend actually produced, breaking anchoring
for every suggestion spanning a block boundary.

**`old_text_plain` is never empty, so there is no client-side anchoring gap to resolve
here.** Per Part 0 C3, an empty `old_text` always fails `apply_edits`'s ambiguity check on
any non-empty essay (`str.count("")` is `len(s) + 1`), and suggest mode never runs on an
empty one — so a pure insertion is always stored as a replacement whose `new_text` (and
therefore `new_text_plain`) extends a short, non-empty `old_text`/`old_text_plain` anchor,
and that anchor resolves through the exact same "search for `old_text_plain`, unique match
or stale" mechanic as every other replacement. (`to_plain_text` of a non-empty markdown
fragment is itself non-empty — stripping syntax can only shrink, never erase, real prose
text.) This was previously flagged as an open item; it is closed — see Part 0 C3.

### 1.2 The extension

New file `frontend/src/features/essays/suggestions/suggestionExtension.ts` — a TipTap
`Extension.create()` wrapping one `@tiptap/pm/state` `Plugin`:

```ts
export const SuggestionPluginKey = new PluginKey<SuggestionPluginState>("essaySuggestions");

type SuggestionPluginState = {
  decorations: DecorationSet;
  resolved: ResolvedSuggestion[]; // suggestion + resolved {from,to} + stale flag, for the UI to read
};
```

- `state.init(_, {doc}) => resolveAll(doc, suggestionsRef.current)` — resolves every
  suggestion against the initial doc.
- `state.apply(tr, prev, oldState, newState)` — **the meta check runs first, strictly
  before the `docChanged` check**, so a transaction carrying both (as §3.5's accept-success
  transaction always does) takes the recompute path, never the mapping path:
  - If `tr.getMeta(SuggestionPluginKey)` carries a `{suggestions: EssaySuggestion[]}`
    payload (fired by §3.5's single-transaction accept/accept-all success path — the plain
    query-refetch case does not need this, since a refetch's own `setContent` never lands
    without also carrying this meta per §3.5), **re-resolve from scratch** against
    `newState.doc` — this is the one deliberate "recompute, don't map" path, and it is what
    makes every sibling suggestion survive an accept without going stale.
  - Else if `tr.docChanged`, **map** the existing resolved ranges through
    `tr.mapping`, then re-validate each mapped range's text still equals `old_text_plain`
    (mapping preserves position but a edit *inside* the range invalidates the anchor even
    though the position is still trackable) — any suggestion that fails re-validation
    flips to `stale` in place (kept, not removed, so the grey "your text changed" state
    is visible) rather than silently dropped.
  - Else return `prev` unchanged (no doc change, e.g. selection-only transactions).
- The extension takes `getSuggestions: () => EssaySuggestion[]` and
  `onResolvedChange: (resolved: ResolvedSuggestion[]) => void` as `configure()` options —
  the second is how the plugin pushes its resolved list up to React state without the
  panel needing direct ProseMirror access (`Editor.on("transaction")` or a
  `useEditorState` selector reading `SuggestionPluginKey.getState(editor.state)`, mirroring
  the existing `toolbarState` pattern in `useEssayEditor.ts:77-96` — same
  `useEditorState` mechanism, new selector).

**Coexisting with `syncContent` — two distinct `setContent` cases, told apart by which
call site issues them, not by inspecting the result:**

- **The pre-existing identity resync.** `useEssayEditor`'s content-sync effect calls
  `editor.commands.setContent(content, { emitUpdate: false })` with **no meta**, replacing
  the doc via a transaction that **does** carry `tr.docChanged = true` but is not a
  "suggestions changed" transaction — it's driven by `essay.content` changing (an ordinary
  save round-trip finishing). This call is a no-op diff in practice (autosave only
  re-triggers `syncContent` when `!autosave.isDirty`, i.e. right after a save lands with the
  same content that was already in the editor), so the plugin's `docChanged` branch
  (mapping) is correct and stable here — mapping ranges through a transaction that didn't
  actually change their surrounding text is safe by construction.
- **The accept-driven replacement (§3.5).** The accept-success `setContent` call is
  deliberately **not** identical content — it is the server's authoritative post-edit essay,
  which is exactly why it must never take the mapping branch. Per the fix above, this call
  site always chains the suggestions-changed meta onto the same transaction, so it takes the
  recompute branch instead, regardless of how large or small the actual text diff is.

No special case is needed to distinguish these dynamically: `syncContent`'s call site simply
never attaches the meta, and §3.5's call site always does. This is exactly why "recompute
only on an explicit suggestions-changed meta, map on every other doc change" is the right
split — the two `setContent` cases are separated by *which code calls `setContent`*, not by
inspecting the transaction after the fact.

### 1.3 Where it plugs into `useEssayEditor`

Extend `useEssayEditor.ts`'s `extensions` array (line 53) with the new extension,
gated by a new option:

```ts
type UseEssayEditorOptions = {
  content: TiptapContent;
  onBlur: (update: EssayEditorUpdate) => void;
  onUpdate: (update: EssayEditorUpdate) => void;
  syncContent: boolean;
  suggestions?: EssaySuggestion[];        // new, optional — undefined = extension not mounted
  onResolvedSuggestionsChange?: (resolved: ResolvedSuggestion[]) => void;
};
```

`EssayEditorPage` passes `essay.suggestions` (parsed) and a state setter through. Keep
the extension conditionally included (`suggestions !== undefined`) so the hook has zero
behavior change for any other future caller that doesn't pass suggestions — smallest
diff, no forced coupling.

## 2. Rendering

### 2.1 Decoration types

- **Deletion** (`kind: "deletion"`, `new_text_plain: ""`): `Decoration.inline(from, to, {class})`
  on the existing range — `--essay-suggestion-delete-ink` color +
  `line-through decoration-2`. This is real document text, so an inline decoration (not a
  widget) is correct — it doesn't touch `content`, only paints it.
- **Replacement**: both — inline decoration on the differing part of `{from, to}`
  (strikethrough, red) *plus* a widget immediately after it carrying the differing part of
  `new_text_plain` (underline, green). Adjacent, per the locked spec ("replacements adjacent"),
  not stacked/diffed word-by-word — word-level diff is exactly the kind of complexity
  YAGNI rules out here; the agent proposes whole-span replacements, not token diffs. Which
  part of `old_text_plain`/`new_text_plain` counts as "differing" is computed by the
  prefix/suffix trim described immediately below (PLAIN space throughout), not the raw
  fields.

**Prefix/suffix trim (diff rendering) — order of operations.** The trim exists *only* to
decide what gets painted. It is a separate, purely visual sub-step, and it runs **last**,
after the anchor and (if applicable) the block fragmentation are already resolved. **All
three steps operate on `old_text_plain`/`new_text_plain` (PLAIN document-text space, per
§1.1/Part 0 C3) — never `old_text`/`new_text`.** The markdown fields never enter this
pipeline at all; there is no offset math converting between markdown and plain here, only
between plain-text-string offsets and document positions (step 3).

1. **Resolve the full anchor.** `old_text_plain` is searched against the full document
   (§1.1) to produce a `{from, to}` range. This step, and the `ResolvedSuggestion` shape it
   produces (§1.2), always carry the full, untrimmed `old_text_plain`/`new_text_plain` — the
   trim has not happened yet and does not influence this step.
2. **Fragment across block nodes, if the range spans them.** The cross-paragraph
   fragmentation described below runs over this **full anchor** range, never the trimmed
   one — a suggestion is fragmented into per-block decoration pieces before anyone asks
   which part of the text is "differing."
3. **Trim, to decide paint boundaries within the already-resolved (and, where
   cross-paragraph, already-fragmented) range.** Only at this last step does the client
   compute the common prefix and common suffix between `old_text_plain` and `new_text_plain`,
   on word boundaries (splitting on whitespace, not raw characters, so a shared "th" between
   unrelated words never produces a ragged half-word decoration), and decorate only the
   differing middle. This step never feeds back into steps 1–2: it consumes positions,
   it does not produce them.

Because `old_text_plain` is never empty (Part 0 C3), a pure insertion is always stored as a
`kind: "replacement"` whose `new_text_plain` extends a short, non-empty `old_text_plain`
anchor. Rendering that naively — strike the whole `old_text_plain`, show the whole
`new_text_plain` in green — would visibly strike text the agent isn't actually removing
(e.g. adding "It reminds me of home." after "I like pizza." would strike the entire original
sentence), which is why the trim step exists:
- If the differing middle of `old_text_plain` is empty (the replacement only *extends* the
  span — the common prefix and suffix together consume the whole of `old_text_plain`),
  nothing is struck — it renders as a **pure visual insertion**: just the new words
  underlined in green. This is what makes "add a sentence here" look right.
- If the differing middle of `new_text_plain` is empty (the replacement only *shortens* the
  span — the common prefix and suffix together consume the whole of `new_text_plain`), it
  renders as a **pure visual deletion** — struck, nothing underlined. (Matches §3.2's
  phrasing exactly: "the trim leaves nothing underlined.")
- Otherwise (both middles non-empty) it renders as strikethrough + underline, adjacent, as
  above — a genuine replacement.
- **This trim is presentation only.** The stored suggestion and the decoration layer share
  the same PLAIN fields (`old_text_plain`/`new_text_plain`) the trim reads — but the trim's
  *output* (the differing-middle substrings) is never itself sent anywhere, and per §3.5
  accept applies **no** local document edit at all (untrimmed or otherwise): the accept/
  reject HTTP calls carry no body at all (Part 1 C4), the server resolves entirely from its
  own stored markdown `old_text`/`new_text` via `apply_edits` (Part 1 §6.2), and the client
  applies only the server's returned content via `setContent`. Nobody should "optimize" the
  trimmed values — or any `_plain` value — into any call; the trim exists purely to decide
  what the decoration layer paints.
- **Deletion** (`kind: "deletion"`) needs no trim — its `new_text_plain` is always `""`, so
  there is nothing to differentiate; the whole `old_text_plain` range is struck.
- **Character offsets → document positions.** The string-level trim produces character
  offsets into `old_text_plain`/`new_text_plain`, not document positions. Converting those
  offsets into the `{from, to}` (or per-fragment) positions computed in steps 1–2 must
  account for block separators. **The separator is pinned to `""` (the empty string) — it is
  not an implementer choice, and it is not `"\n\n"`.** `old_text_plain`/`new_text_plain` are
  produced by the backend's `to_plain_text()` (Part 1 §5.3), which is specified and
  implemented as `"".join(text for block in blocks for text in _collect_text(block))` — no
  separator between blocks, by deliberate design (§5.3 states this explicitly: "this is
  correct and deliberately simpler than `to_markdown`'s own `"\n\n".join`"). Every
  `textBetween` call this feature makes — the anchor search (§1.1) and this offset-to-
  position conversion — must therefore pass `""` as `blockSeparator` (which happens to also
  be ProseMirror's own default for `doc.textBetween(from, to, blockSeparator, leafText)`, so
  passing it explicitly here is about pinning intent and matching the backend, not
  overriding ProseMirror's default). Passing anything else (e.g. `"\n\n"`) would search the
  document for a string shaped differently from what `old_text_plain` actually is, breaking
  anchoring for any suggestion spanning a block boundary — precisely the bug this fix closes.
  Because the separator is always `""`, the trim's character offsets map onto document
  positions with no separator-width adjustment: a 1:1 slice of the resolved range, no
  block-boundary accounting needed in the offset math itself (block-boundary accounting is
  still needed for the block-node *fragmentation* covered in "Cross-paragraph suggestions"
  below — that's a rendering split, not an offset-width correction). **This is precisely why
  anchoring happens in plain-document-text space (`_plain`) rather than markdown space**
  (Fix 1 above): the backend's own markdown join is *not* uniform — `to_markdown`
  (`essay_markdown.py:104-106`) joins top-level blocks with `"\n\n"`, but list items join
  with `"\n"` (`:386-387`) and a blockquote nests its own join and `"> "` prefix
  (`:397-398`) — so there is no single separator that would work if anchoring were done in
  markdown space. `to_plain_text()`'s uniform no-separator join is what makes plain-space
  anchoring possible with one fixed value, `""`, everywhere.
- **Stale**: any of the above, but ink swaps to `--ink-disabled` (existing token,
  `--gray-650`, the app's one WCAG-exempt disabled ink per `DESIGN.md` §3.1), underline/
  strikethrough become `decoration-dotted`, and the decoration gets
  `pointer-events-none` plus a `title` (native tooltip, not the accept/reject popover —
  stale changes are inert) reading "Your text changed since this was suggested."
- **Cross-paragraph suggestions.** `essay-revision` (Part 1 §8.2) explicitly does structural
  reordering, and a reordering suggestion's resolved range can span multiple block nodes —
  `Decoration.inline` cannot cleanly span a block boundary, and a popover anchored to one span
  can't represent a suggestion that lives in three. Per the order of operations above, this
  fragmentation is computed against the **full, untrimmed anchor range** — the trim is applied
  afterward, per fragment, never before. A suggestion whose full anchor range crosses a block
  boundary produces **one `Decoration.inline` (or, for the trailing `new_text_plain`, one widget) per
  block node it touches**, all carrying the same `data-suggestion-id`. If the trim removes an
  entire leading or trailing block from the painted region (its content falls entirely inside
  the common prefix or common suffix), that block simply receives no decoration — it is still
  part of the anchor and still part of the accepted edit, it just isn't visually painted. The
  delegated hover
  listener (§3.2) resolves by `data-suggestion-id`, not by DOM position, so a multi-block
  suggestion is still **one hover target with one popover**: hovering any fragment adds
  `data-suggestion-hovered` to every fragment sharing that id (a plain attribute-selector CSS
  rule, no extra JS per fragment), so the whole group highlights together. The widget carrying
  the differing part of `new_text_plain`, if any, attaches after the **last** fragment's end
  position, never duplicated per block. Keyboard navigation (§3.3) and `Alt+.`/`Alt+,` treat the group as a
  single stop — landing on any fragment counts as landing on the suggestion — and accept/reject
  act on the whole suggestion, all fragments at once, never on a fragment individually. A
  suggestion is always atomic: block-node fragments are a rendering detail of how ProseMirror
  paints a multi-paragraph range, never a separately acceptable/rejectable unit.

### 2.2 New tokens

Per §2.2 Law 2, insertion is structurally an *addition being proposed* and deletion a
*removal being proposed* — the closest existing claims are `--success-*` (something
being added/completed) and `--danger-*` (something being removed), but using the raw
`--success-fg`/`--danger-fg` role tokens directly would blur "this word is done/ready"
with "this word is a proposed edit," a different claim on the same hue. That's exactly
what tier 3 family tokens are for (`DESIGN.md` §2.4: "new feature area with its own
recurring colours → give it a family file, prefixed by the feature, resolving only
through semantic.css"). Add to `frontend/src/styles/essay.css` (already the essay
family file, currently 71 lines, well under the ~300-line split threshold):

```css
/* ---- suggestion decorations (tracked changes) ---- */
--essay-suggestion-insert-ink: var(--success-fg);      /* leaf-700, on white ~7:1 */
--essay-suggestion-insert-surface: var(--success-surface); /* leaf-50, popover accent only */
--essay-suggestion-delete-ink: var(--danger-fg);        /* red-700, on white ~7.7:1 */
--essay-suggestion-delete-surface: var(--danger-surface);
--essay-suggestion-stale-ink: var(--ink-disabled);      /* existing gray-650, WCAG-exempt by design */
```

These resolve purely through `semantic.css` roles (tier 2), satisfying Law 1 — no new
primitive, no literal. Both values were verified elsewhere in the system already
(`--success-fg`/`--danger-fg` are the badge-text tokens, measured against `--success-
surface`/`--danger-surface`, both very-near-white like `--document`/`--essay-document-
surface`, so the measured ratios hold within a hundredth of a lightness point — no new
contrast script run needed, but note it in the PR per §21.1 practice). Underline/
strikethrough on white also needs a stroke-only check: `text-decoration-color` inherits
the same ink, so it clears the same ratio the text does.

Single theme — no dark variant to write (§0 above).

### 2.3 CSS home

Decoration styling itself (the `<ins>`/`<del>`/widget classes) is ProseMirror-rendered
DOM, not React — it needs plain CSS selectors, which is exactly the carve-out
`frontend/src/styles/README.md` already documents ("the small set of component classes
that don't fit the token system... the ProseMirror essay typography" lives in
`index.css`). Add a `.essay-suggestion-insert` / `.essay-suggestion-delete` /
`.essay-suggestion-stale` block next to the existing `.essay-editor-content` rules in
`index.css`, resolving only through the tier-3 tokens above — never a literal in that
block either.

### 2.4 Acknowledging a direct write (the first-draft moment)

A direct write (§5.2's `write_mode === "direct"` case — an empty essay's first full draft)
lands via `editor.commands.setContent`, exactly like the essay editor's own content-sync
effect (§0) already does for a save round-trip finishing. Without a signal, that's
indistinguishable from an autosave — the single moment where the essay stops being blank is
invisible. It needs a small, one-shot acknowledgment, and it needs to read as *neutral*, not
as the tracked-changes insertion green — nothing here is pending review, so borrowing that
vocabulary would misrepresent a direct write as a suggestion.

- **What:** a one-shot highlight sweep — a background wash over the newly-written range that
  fades out, **340ms** (the Slow tier, `DESIGN.md` §12.2 — the closed three-tier duration
  scale is 150/200/340ms and only those values, rule 27; 600ms is off-scale and there is no
  documented exception for a one-shot wash), `cubic-bezier(0.16, 1, 0.3, 1)` (the Slow-tier
  easing, §12.3), animating only `background-color`/`opacity` (never `transform` here, since
  the wash needs to cover irregular multi-line text, not move anything — rule 28's carve-out
  is for layout properties, not durations, and doesn't apply here anyway since this animates
  no layout property). New token, `--essay-direct-write-wash` (tier-3 family token in
  `frontend/src/styles/essay.css` alongside §2.2's suggestion tokens), resolving to a neutral
  low-alpha tint of `--document`'s own surface family — not `--success-surface`, precisely to
  avoid colliding with the insertion vocabulary.
- **When:** fired exactly once, keyed off the turn that produced a direct write landing (the
  same signal that distinguishes a direct write from an ordinary autosave — the caller already
  knows which turn is direct-mode, since that's a property of the turn per Part 1 §5.2, not
  something the frontend has to infer from the diff). Never fires for an ordinary autosave
  `setContent` replay, and never fires again once a first draft exists (`write_mode` only goes
  `direct` once, per Part 1 §5.2's "one-time event" framing).
- **Reduced motion:** under `prefers-reduced-motion: reduce`, no sweep — the text simply
  appears, same as every other motion-budget exception in this plan (§3.5, §5.2's mobile
  entrance, etc.).
- **Scope:** this is deliberately narrow — a direct write is the one case in this whole
  feature that isn't a suggestion, so it gets the one acknowledgment that isn't a
  suggestion-decoration color. No new component; a small effect in whatever hook applies the
  direct-write content (`useEssayEditor` or `EssayChatPanel`'s submit handler, whichever
  actually receives the "this turn was a direct write" flag from the turn response) that adds
  a transient decoration/class and removes it after the animation completes.

## 3. Accept / reject interaction

### 3.1 Semantic HTML

Deletion/replacement decorations render as `<del>`/`<ins>`-equivalent via
`Decoration.inline(..., {nodeName: undefined, class, "aria-roledescription": ...})` —
ProseMirror inline decorations can't literally swap the rendered tag without a NodeView,
so instead: wrap the decorated range's rendered text visually as above, and expose the
semantic pairing through `aria-label` on the popover trigger ("Insert: '{new_text_plain}'" /
"Delete: '{old_text_plain}'" — PLAIN space, never the markdown fields, since this is
user-facing text a screen reader speaks aloud) rather than relying on real `<ins>`/`<del>` tags inside
`contentEditable` (which ProseMirror doesn't support cleanly as decoration nodeNames
without breaking cursor placement). This is the pragmatic reading of "`<ins>`/`<del>`
semantics" in the brief — the accessible name carries the semantic, not the raw tag.

### 3.2 Hover popover

New component `frontend/src/features/essays/suggestions/SuggestionPopover.tsx`, built on
`components/ui/hover-card.tsx` (Radix `HoverCard`, already used for citation hover-cards
per `DESIGN.md` §15.3 — same interaction shape: hover a decorated span, a small card
appears with the change + a one-line rationale + accept/reject). Trigger is the
decorated `<span>` itself (needs `Decoration.inline`'s class list to include
`cursor-pointer` and a `data-suggestion-id` so a `mouseover`/`focus` delegated listener at
the editor-content root can resolve which suggestion is hovered — ProseMirror decorations
aren't React nodes, so the popover's *trigger* element is a portalled position tracked by
that delegated listener, not a literal `<HoverCard.Trigger>` wrapping the span). The
listener resolves by `data-suggestion-id`, so a multi-block suggestion (§2.1's
cross-paragraph case) resolves to the same one popover no matter which fragment is
hovered — the listener never needs to know a suggestion spans more than one span; it just
groups by id. Content:
- One line: a verb derived from the same prefix/suffix trim that drives the decoration
  (§2.1), not the raw `kind` field — "Insert" when the trim leaves nothing struck (a
  replacement that only extends), "Delete" when `kind === "deletion"` or the trim leaves
  nothing underlined (a replacement that only shortens), "Replace with" otherwise — + the
  text, `text-sm`.
- The rationale, `text-xs text-muted-foreground`, `line-clamp-2` (mirrors the citation
  hover-card's `line-clamp-4` pattern at a shorter cap since this is one sentence by
  contract).
- The change body itself (`old_text_plain`/`new_text_plain` — PLAIN space; a student must
  never see raw markdown syntax like `**`/`_`/`> ` in a change preview, which is a
  user-facing benefit of the PLAIN fields, not just a mechanism) is capped:
  `max-h-32 overflow-y-auto` wrapping the diff text, so a long paragraph-level replacement
  doesn't blow out the popover's height. Beyond a character cap
  (`SUGGESTION_POPOVER_PREVIEW_CHARS = 240`, one named constant, no magic number), the
  popover shows a truncated preview (`text-ellipsis`/`line-clamp` on each of
  `old_text_plain`/`new_text_plain`) with a trailing "View full change in the list below"
  line instead of trying to fit the whole diff — it defers to the expanded pending-changes
  list row (§3.4), which has no such cap.
- Two `Button` (`size="sm"`) — Accept (`variant="default"`, uses `--success-solid`
  indirectly via a `success`-toned button treatment — check whether `Button` has a
  success variant; if not, `variant="outline"` with the insert-ink token on the icon only,
  matching §2.2 Law 2's "ordinary control gets no hue, only the icon accents" reading) and
  Reject (`variant="outline"` with a `Trash2`/`X` icon). **Both buttons take
  `onMouseDown={(e) => e.preventDefault()}`** — a real `<Button>` click steals DOM focus by
  default, and §5.3 promises accept/reject never moves focus out of the document; suppressing
  the mousedown default is what makes that true for the popover path specifically. After the
  mutation resolves, the editor is explicitly refocused at the caret position stored when the
  popover opened (same stored-position mechanic §5.3 describes for the keyboard path) — belt
  and braces with the `preventDefault`, since a resolved promise can land after other focus
  changes. **Per §3.5, at most one accept or reject is ever in flight across the whole
  panel.** While that one resolve is pending: the pressed button takes `Button`'s existing
  `loading` prop (`DESIGN.md` §11.6: it sets `aria-disabled` — not `disabled` — so the label
  stays announceable, sets `data-loading`, makes the label transparent, and overlays a
  `Spinner`); its sibling button in the *same* popover, every *other* suggestion's
  Accept/Reject controls — every other popover, every other row in the pending-changes list
  (§3.4) — and the bar's own Accept all/Reject all (§3.4) all get the **same `aria-disabled`
  treatment as the pressed button, not native `disabled`, and for the identical reason**: any
  of those controls can legitimately hold real DOM focus (a student tabbing down the list, or
  clicking a different row — clicking does not always move focus onto the clicked element,
  most reliably on Safari, part of `DESIGN.md`'s cross-browser bar), and native `disabled`
  ejects focus from whichever one currently has it, exactly the bug the pressed button's
  `loading` prop already exists to avoid. Concretely: pass `aria-disabled` as a plain attribute
  on these Button instances (the component forwards unrecognized props straight to the
  rendered `<button>`, so `aria-disabled` reaches the DOM without also flipping the `loading`
  prop's `disabled: isDisabled` path or its `Spinner` — no spinner is wanted on a sibling that
  isn't the one being acted on). **`aria-disabled` alone does not block activation the way
  native `disabled` does — the click and keydown handlers on every one of these controls must
  themselves no-op whenever the panel-wide `resolving` lock (§3.5) is set**, checked before
  doing anything else, or an `aria-disabled` sibling would still fire a second request on
  click/`Enter`/`Space`. That is the trade this makes, and it must hold everywhere this
  lock is applied (§3.2/§3.4/§3.5 step 1/§7/§10), not just here. This is reused verbatim, not
  reinvented — `DESIGN.md` §11.6 already specifies exactly this "being applied, not applied
  yet" control state, and native `disabled` on any button that currently holds focus — the
  one just clicked, or an unrelated sibling a student tabbed to — would eject focus from it,
  breaking §5.3's "accept never moves focus out of the document" contract; that is exactly
  why `Button`'s own loading state avoids `disabled` in the first place, and the same
  reasoning extends to every locked-out sibling, not only the pressed button. **Do not
  "simplify" this back to native `disabled` anywhere in the panel-wide lock.** `aria-disabled`
  still needs the `onMouseDown` guard above on the pressed button specifically, since a
  hover-opened popover's button was never focused to begin with and can still register a stray
  click while
  `loading`.

  **Visual treatment of the locked-but-not-pressed siblings — canonical here, referenced
  (not restated) by §3.4/§3.5 step 1/§7.** A bare `aria-disabled` attribute picks up neither
  `DESIGN.md` §11.5's disabled appearance (`disabled:pointer-events-none`,
  `disabled:opacity-64` — both keyed to the native `disabled` attribute/CSS pseudo-class,
  which `Button` only sets when its own `loading`/`disabled` prop is true, not from a raw
  `aria-disabled` passed through `...props`) nor §11.6's `loading` appearance (keyed to
  `data-loading`, also prop-driven). Left as specified above, a locked sibling is a
  reachable, focusable, visually normal button that silently no-ops on click — indistinguishable
  from a live one until the student tries it. Fix, sourced from an existing pattern already in
  this codebase rather than invented: `frontend/src/features/tasks/task-actions.tsx` already
  styles a non-native-disabled control with the Tailwind v4 built-in `aria-disabled:` variant
  (`aria-disabled:cursor-not-allowed aria-disabled:opacity-64`, `task-actions.tsx:66`). Add
  `aria-disabled:cursor-not-allowed aria-disabled:opacity-64` to these Button instances'
  `className`, matching §11.5's own
  target opacity so a locked sibling reads as the same "disabled" a student already knows from
  every other control in the app. **Deliberately omit `aria-disabled:pointer-events-none`.**
  Note the precedent supports this rather than diverging from it: `task-actions.tsx` contains no
  `pointer-events` rule at all and relies purely on its handlers to block activation — the same
  handler-guarded pattern used here. (`components/ui/sidebar.tsx:524` does pair
  `aria-disabled:pointer-events-none` with `aria-disabled:opacity-50`, but that is a different
  component's own choice, at a different opacity.) These controls must stay hoverable and
  focusable, since remaining
  reachable by mouse and keyboard while locked is the entire reason `aria-disabled` was chosen
  over native `disabled` in §3.2 above; `pointer-events-none` would suppress hover (breaking
  the popover-hover affordance on a locked sibling row) and, on some platforms, interfere with
  the click-to-focus path §3.2 already relies on holding real focus. **The honesty question
  this raises, answered:** the dimming is itself the signal for why the control isn't
  responding, so a locked click needs no toast or inline message — silence plus a visibly
  unavailable control is coherent, where silence plus a normal-looking control (the bug this
  fixes) was not.

### 3.3 Keyboard model

Frequency rule: this is pressed dozens of times a session, so **keyboard accept/reject
gets zero animation** (§3.5 below) and a flat, always-available shortcut surface — no
popover needed to trigger it:

- **`Alt+.` / `Alt+,`** (or `]`/`[` — pick one, document the choice at the site; avoid
  arrow keys since those already navigate text) — jump focus to the next/previous
  pending (non-stale) suggestion, scrolling it into view. **This navigation stays available
  at all times, including while another suggestion is resolving (§3.5)** — a student can
  still move around and read pending changes while one resolve is in flight; only the
  resolve-triggering actions below are gated. A suggestion that is itself the one currently
  `resolving` is skipped as a landing target, same as a `stale` one, since accepting or
  rejecting it again mid-flight makes no sense — but every other pending suggestion remains
  a normal stop.
- **`Mod+Enter`** (while a suggestion is focused, i.e. the caret is inside its resolved
  range) — accept. **Not bare `Enter`, per C8:** inside a `contenteditable`, `Enter` means
  "new paragraph" — a student typing normally near a pending change would accept it by
  accident, silently. **No-ops whenever *any* suggestion is `resolving` — not merely the
  focused one.** Per §3.5, at most one accept or reject is ever in flight across the whole
  panel, so this handler must gate on the panel-wide resolving state, not a per-suggestion
  flag: without that, a `Mod+Enter` on suggestion B while suggestion A's accept is still in
  flight would fire a second request against a document that's about to be replaced by A's
  response, racing an anchor that may shift underneath it (§3.5). Gating on "is anything
  resolving" makes that structurally impossible rather than merely unlikely.
- **`Mod+Backspace`** while focused on a suggestion range — reject. **Not bare
  `Backspace`/`Delete`, per C8:** those keys mean "delete a character" inside the editor,
  so binding them to reject would fire on ordinary typing/editing near a suggestion, not
  just on deliberate use. `Mod+Backspace` doesn't collide with any editor default at this
  scope. **Same panel-wide `resolving` no-op guard as `Mod+Enter`**, for the identical
  reason — reject is just as capable of racing an in-flight accept's response as a second
  accept would be.
- These are editor-level `keydown` handlers added via the extension's
  `addKeyboardShortcuts()` — TipTap's native mechanism, not a new global listener — so
  they only fire when the editor has focus and don't collide with browser/OS shortcuts.
- `aria-live="polite"` region (a visually-hidden span in `EssayEditorPage`, mirroring the
  streaming-count pattern in `DESIGN.md` §16.1) announces "3 changes remaining" after
  each accept/reject and on initial load if >0 pending. **Because at most one resolve is
  ever in flight (§3.5), this is now unambiguous by construction** — there is never a
  second announcement racing the first, so no debounce or collision handling is needed
  here beyond the region's own default "replace, don't stack" behavior.

### 3.4 The pending-changes bar

New component `frontend/src/features/essays/suggestions/SuggestionsBar.tsx`. Renders
above `<EditorContent>` inside the canvas band (between the toolbar band and the
document `motion.div`, still inside `EssayEditorPage`'s scroll column, so it scrolls with
the document rather than pinning — the doc is 820px wide and already centered; the bar
should match that width, not span the full 1440px canvas). Copy: **"Counselle proposed
{n} changes"** + two ghost/outline `Button`s, "Accept all" / "Reject all" — `text-sm`,
`h-9`, matches the existing control-height scale (§7.2). Shape: a flush row, not a card
(no border-radius-xl box) — it's transient chrome sitting directly on
`--essay-editor-chrome-surface`, one hairline (`border-b`) separating it from the
document below, consistent with the "flush bands separated by hairlines" language
`EssayEditorRoute.tsx`'s own header comment already uses for this exact editor. Enter/
exit: `AnimatePresence` + `motion.div` `height`/`opacity` — this is genuinely the
"accordion height, no alternative" exception §12.1 rule 2 carves out (the bar's presence
changes document layout above the fold; a hard cut would jump the document position),
200ms `ease-out`, commented as the exception per the rule.

**The count is a disclosure, not just a label.** Hover-only discovery means finding six
suggestions scattered through the document means scrolling and hovering each one —
scannability needs a list. Wrap the `"{n} changes"` count in `components/ui/collapsible.tsx`
(Radix `Collapsible`, existing, reused rather than a bespoke expand/collapse): clicking it
expands into a compact list, one row per pending suggestion. **Each row uses the same
trim-derived treatment as the popover (§3.2), not the raw `old_text_plain`/`new_text_plain`
fields (and never the markdown `old_text`/`new_text` — same "never show raw markdown syntax
to the student" rule as §3.2)** — raw fields would show two long, near-identical sentences joined by an arrow for the common
"one clause changed inside a sentence" case, making every pending change look far bigger in
the list than it appears underlined in the document. A row shows the same verb the popover
derives from the trim ("Insert" / "Delete" / "Replace with") followed by only the differing
middle (the trim's non-empty side, or both sides for a genuine replacement, joined "→" only
when both are non-empty), truncated to the same `SUGGESTION_POPOVER_PREVIEW_CHARS` cap
applied to that trimmed text (not the raw fields), plus its own Accept/Reject `Button`s
(`size="sm"`, same pair as the popover). **Per §3.5, at most one accept or reject is ever in
flight across the whole panel:** the row that was clicked shows `Button`'s `loading` prop
(`DESIGN.md` §11.6, per §3.2) on the pressed action while its mutation is in flight, and
every *other* row's Accept/Reject `Button`s — plus the bar's own Accept all/Reject all — get
the same `aria-disabled` treatment as §3.2 (never native `disabled`, for the identical
focus-ejection reason — a student can be keyboard-focused on any row in this list; visibly
dimmed via §3.2's `aria-disabled:opacity-64`, still focusable and hoverable, no
`pointer-events-none`), with the same requirement that their click/keydown handlers no-op
while the panel-wide `resolving` lock is set, for that same duration, not just the clicked
row's sibling button. Collapsed
by default — the bar's base row (count + Accept all/Reject all) is unchanged from above; the
list is purely additive underneath it, using the same `AnimatePresence`/height-transition
exception already justified for the bar itself. **Focus advance on resolve:** the list keeps
a ref per row; per §3.5, the resolving row is busy, still in the DOM, and is only removed once
the server confirms, which would otherwise drop focus to `<body>` at that point, so the
resolve handler explicitly `.focus()`s the next row's Accept button (or the bar's own
Accept-all/Reject-all control if the resolved row was the last one) immediately after the
list re-renders on success — this is what lets a student clear the list by repeatedly hitting
Accept/Reject without ever refocusing anything (§5.3), and it is exactly why serialization
costs nothing here: the next row's controls are re-enabled and focused in the same beat the
previous row leaves the list, so there is never a moment where the *reviewing* flow feels
blocked, only the brief `resolving` window on the row actually in flight. On failure the row
returns to `pending` in place and keeps focus, per §3.5/§7. Clicking a list row scrolls its decoration
into view (`element.scrollIntoView({ block: "center" })`) and flashes
`data-suggestion-hovered` on it (the same attribute §2.1/§3.2 use for hover) for one beat, so
the student can find it in the document without hunting. **Stale suggestions appear in the
list too**, visibly inert (same disabled treatment as §2.1/§3.6 — dimmed row, no live
Accept/Reject buttons, just the "your text changed" reason inline) rather than silently
vanishing from the count they were once part of. Accept all / Reject all in the collapsed bar
itself are unaffected — they still act on every pending (non-stale) suggestion regardless of
whether the list is expanded.

### 3.5 Resolving state + flush + authoritative apply — serialized, no optimistic document edit

**This section previously specified an optimistic local document edit with rollback-on-
failure. That design is wrong and is replaced below — it silently destroys data.**

**A second correction, on top of the first: concurrent per-suggestion `resolving` was never
safe either, and is now removed.** An earlier revision of this plan declared concurrent
per-suggestion resolves "intentional and supported" — a student could accept suggestion A and
suggestion B at the same time, each request racing independently. That is wrong for a reason
beyond the "N remaining" count and stale-siblings bug the single-transaction fix in step 4
already closes: **each accept also applies the server's returned authoritative `content`.**
Response A is computed by the server before B's accept has committed, so A's response does not
contain B's edit. If A's response lands (and is applied via `setContent`) after B's, the
document is left visually missing an accepted edit — the server's stored `essays.content` is
correct, B's edit really is saved, but the student's screen silently diverges from it until
the next full sync (a reload, or another `setContent`). This is a second, independent race
from the same "two accepts complete out of order" root cause, and it corrupts what the student
sees, not just a count.

**The fix: at most one accept or reject in flight at a time, for the whole panel — not per
suggestion.** Accepting suggestion B while suggestion A's accept is still in flight means
acting against a document that is about to be replaced wholesale by A's response — B's own
anchor may shift underneath it the instant A's response lands. Serializing removes that
class of bug structurally rather than making it merely unlikely: there is never a second
in-flight request whose response could land in the wrong order relative to another, because
there is never a second in-flight request. This also removes the need this plan previously
carried for live-state `remaining` derivation, response-ordering guards, or any reconciliation
machinery between two concurrent responses — none of that exists anywhere below, and none of
it should be reintroduced by a future edit.

**Why the optimistic edit is unsafe, precisely.** `useEssayAutosave.ts`'s `saveDraft` calls
`updateEssay(essayId, { content: draft.content })` with no version field, and
`service_essays.py::_check_not_stale`'s docstring confirms omitting `expected_updated_at`
"keeps last-write-wins semantics." An optimistic accept edit applies `new_text_plain`
(markdown-stripped) into the live doc via `editor.commands.insertContentAt`/`deleteRange`.
That call is a normal editor transaction — it fires `onUpdate`, which is exactly the path
`useEssayAutosave` listens on, so it queues a save of the *plain*, formatting-stripped text
roughly 1.5s later. Meanwhile the accept `POST` returns the server's authoritative content —
built from the *markdown* `old_text`/`new_text` via `apply_edits`, which can carry formatting
the plain insert never had (e.g. `new_text: "**incredible** food"` vs. the optimistic edit's
literal `"incredible food"`). `syncContent` is gated on `!autosave.isDirty`, so the
authoritative response can't reach the editor until the debounced autosave finishes its own
round trip first — and that autosave PATCHes the plain text back over the server's correctly
formatted result. No error, no conflict: the formatting is silently and permanently gone.
This is not the "very next successful save/refetch reconciles it" story this section used to
tell — that save *is* the corrupting write.

**The fix: never edit the document locally for accept. Apply only what the server returns.**

1. **Mark the panel `resolving`, scoped to the one suggestion being acted on.** The pressed
   suggestion's own controls — in the hover popover (§3.2) and its pending-changes-list row
   (§3.4) — go busy via `Button`'s `loading` prop on the pressed action and `aria-disabled`
   (never native `disabled` — §3.2/§7) on its sibling the instant accept/reject is invoked.
   This is the honest affordance: the change is being applied, not already applied. No
   decoration changes yet — the suggestion is still visibly pending until the server confirms.
   **At the same moment, every *other* suggestion's Accept/Reject controls — in every other
   popover, every other pending-changes row, and the bar's own Accept all/Reject all — get the
   same `aria-disabled` treatment too, never native `disabled`** (§3.2's fix: any of those
   controls may currently hold real DOM focus, and native `disabled` would eject it; visibly
   dimmed per §3.2's `aria-disabled:opacity-64`, still focusable and hoverable — no
   `pointer-events-none`), with
   their click/keydown handlers no-op'ing while this lock is set, because per the
   correction above, at most one accept or reject can be in flight across the whole panel, not
   per suggestion. The keyboard path (§3.3) no-ops `Mod+Enter`/`Mod+Backspace` while *anything*
   is resolving, not merely the focused suggestion, for the identical reason. `Alt+.`/`Alt+,`
   navigation is the one exception: it stays available throughout, since moving around and
   reading pending changes is harmless while one resolve is in flight — only the
   resolve-triggering actions are gated. This single-flight lock is what makes the response-
   ordering race above structurally impossible: there is no second request that could land out
   of order, because a second request can't start until the first one finishes.
2. **Flush any pending autosave first, and await it.** If the student has unsaved typing,
   the server's copy of the essay is stale relative to the editor, and accepting against
   that stale copy would apply the edit to the wrong text. `useEssayAutosave` already
   exposes `flush()` (the same function its own `retry` calls, `useEssayAutosave.ts:455-457`)
   — reuse it, do not invent a second flush mechanism — but **`flush()` is not awaitable
   today and must become so.** Verified against the live file: `flush()` (`useEssayAutosave.ts:373-382`)
   calls `saveDraft(draft)`, and `saveDraft` (`:271-327`) is a `useCallback` returning
   `void` — it calls `updateEssay(essayId, { content: draft.content }).then(...).catch(...)`
   without returning that promise, so `flush()` itself resolves to `undefined`. `await
   flush()` as written would resolve on the next microtask, not when the save actually
   lands, leaving the accept `POST` racing the flushed save. **Required change to
   `useEssayAutosave.ts`, in this same PR:** make `saveDraft` return the `updateEssay(...)`
   promise it already builds (`.then()`/`.catch()` stay, they just sit on a `return`ed
   chain now), and make `flush()` return that promise — or `Promise.resolve()` when
   `pendingDraftRef.current` is `null` (nothing to flush). This is a type-only widening
   (`void` → `Promise<void>`); every existing caller (`retry`, `onBlur`, and any other
   fire-and-forget call site) keeps compiling unchanged because none of them use the return
   value — they simply continue to ignore it, exactly as before. This flow is the first
   caller that actually needs the promise, via `await flush()`.
3. **POST the accept or reject** — `POST /v1/essays/{essayId}/suggestions/{suggestionId}/accept`
   or `.../reject` (Part 1 C4 — no request body). The accept endpoint returns the
   authoritative updated `Essay`, built server-side from the *markdown* `old_text`/`new_text`
   via `apply_edits`, exactly as §6.2 specifies.
4. **On accept success, apply the returned content and the suggestions-changed meta in one
   transaction — never a plain `setContent` call.** A bare
   `editor.commands.setContent(essay.content, { emitUpdate: false })` produces a
   `docChanged` transaction with no meta, which falls into §1.2's **mapping** branch, not
   its recompute branch — and mapping is only safe when the content is unchanged (§1.2's
   "Coexisting with `syncContent`" case), which is exactly false here: the accepted
   suggestion's content is, by definition, different from what every sibling suggestion was
   anchored against. Mapping every other pending suggestion's anchor through a whole-document
   replacement, then re-validating, fails re-validation and flips every other suggestion to
   `stale` the moment one is accepted. TipTap's chained commands accumulate into a single
   transaction, so land both changes atomically:
   ```ts
   editor.chain()
     .setContent(essay.content, { emitUpdate: false })
     .command(({ tr }) => {
       tr.setMeta(SuggestionPluginKey, { suggestions: essay.suggestions });
       return true;
     })
     .run();
   ```
   where `essay` is the accept endpoint's own response body — the same `Essay` object
   `resolve_suggestion` returns (Part 1 §6.2, built from `get_essay` after the transaction
   commits), whose `suggestions` field is already the authoritative post-accept array with the
   just-resolved suggestion removed. **`remaining` is not computed client-side at all** — an
   earlier revision of this plan derived it locally (filtering the just-accepted suggestion out
   of whatever suggestion list the client already had), which was itself a residue of the
   concurrent design: computing "what's left" locally only made sense when more than one
   accept/reject could be in flight and each needed its own local view of the remainder. Under
   serialization there is no such need — the response is already the source of truth for both
   `content` and `suggestions`, and because only one request is ever in flight, there is no
   ordering hazard in reading straight from it. Per §1.2, the plugin's `apply()` checks
   `tr.getMeta(SuggestionPluginKey)` **before** the `tr.docChanged` branch, so this single
   transaction takes the recompute path: every remaining suggestion is re-resolved from scratch
   against the new document, never mapped through the replacement. Because `emitUpdate` is
   `false`, this transaction still fires no `onUpdate`, so it queues **no** autosave. Reject
   success needs no document edit at all — just replace the local suggestion list with the
   reject response's own `suggestions` array (a plain state update, no transaction, no plugin
   meta needed since the document itself didn't change) — so its path stays simpler than
   accept's.
   **§1.2's "Coexisting with `syncContent`" passage, corrected:** that passage's "a
   `setContent` with identical content is a no-op diff" reasoning applies only to the
   *pre-existing identity resync* — `syncContent`'s own `editor.commands.setContent(content,
   { emitUpdate: false })` call, fired when `essay.content` changes after a save round-trip
   returns the same content that was already in the editor, where mapping is genuinely safe
   because nothing actually changed. It does **not** apply to this accept-driven
   `setContent`, whose content is deliberately different from what's in the editor. The two
   cases must be told apart by which code path issues the call, not inferred after the fact
   — `syncContent`'s call carries no meta (mapping is correct there), this flow's call always
   carries the suggestions-changed meta (recompute is required here).
5. **On failure,** return the suggestion from `resolving` to `pending` (re-enable its own
   controls) **and release the panel-wide lock** (re-enable every other suggestion's
   Accept/Reject controls and the bar's Accept all/Reject all, per step 1) and surface an
   inline error per §17.3 ("errors surfaced as an inline message or a button state — never a
   blocking modal") — a toast (`sonner`, already used app-wide) reading "Could not accept —
   try again." **There is nothing to roll back**: because no local document edit was ever
   applied, a failed request simply leaves the document and the suggestion list exactly as
   they were before the attempt. This is precisely what makes this flow simpler than the
   optimistic-edit design it replaces — failure handling is "put the suggestion back and
   unlock," not "undo a transaction and hope nothing else touched the doc since."

**`acceptAll`/`rejectAll`** follow the same shape at the batch level, and were never subject to
the per-suggestion concurrency question above — they are already a single request apiece, so
there is nothing to serialize *within* one call. They still participate in the same panel-wide
lock (step 1): while an accept-all/reject-all is in flight, individual Accept/Reject controls
get the same `aria-disabled` (never native `disabled`, visibly dimmed per §3.2) treatment too,
for the identical reason a single accept locks the panel — a lone accept started mid-batch
would be racing a response that's about to replace the whole document. Mark the panel `resolving`, `await flush()` once,
call **`POST /v1/essays/{essayId}/suggestions/accept-all`** / **`.../reject-all`** (Part 1 C4 —
real batch endpoints, not a client-side loop), which returns `{"essay": Essay, "applied": n,
"skipped": [...]}` (Part 1 §6.2). Then, for accept-all, the same single-transaction
`editor.chain().setContent(response.essay.content, { emitUpdate: false }).command(({ tr }) => {
tr.setMeta(SuggestionPluginKey, { suggestions: response.essay.suggestions }); return true;
}).run()` as step 4 above, reading `content`/`suggestions` off the response's nested `essay`
the same way — Part 1 §6.2's accept-all endpoint returns the post-batch `Essay` alongside
`applied`/`skipped`, matching `resolve_suggestion`'s own return-shape precedent, precisely so
this call site can stay "read straight from the response" instead of re-deriving a remainder
from the `applied`/`skipped` counts alone (reject-all needs no document edit, just replacing
local suggestion state with `response.essay.suggestions` — the same "no transaction" shape as
single-reject). On a partial failure, `response.applied`/`response.skipped` report the count
alongside the (already-authoritative) essay, so the toast reads "4 of 6 accepted — 2 could not
be applied" straight from that payload.

**This hook is `frontend/src/features/essays/suggestions/useEssaySuggestions.ts`**
(co-located with the extension, its own small module — not bolted onto `useEssayAutosave`,
which owns *content* saves and must stay that way per the docstring's implicit contract). It
depends on `useEssayAutosave`'s `flush()` (imported/passed in, not duplicated) and on the
editor instance (for the one `setContent` call on success) — nothing else. It owns exactly one
piece of shared state: the panel-wide `resolving` lock (which suggestion, if any, is in
flight), consulted by the popover (§3.2), the pending-changes list (§3.4), and the keyboard
handlers (§3.3) to decide what's disabled.

**The trade this makes, explicitly — and the honest answer to "does accepting six changes in a
row feel like a stall."** Serializing accept/reject means each one is a real network round trip
(flush, if needed, then the accept POST) before the document visibly changes, and now no two
of those round trips can overlap. That trade is correct on data-safety grounds alone: a change
that appears to land instantly and then silently reverts — or silently drops formatting, or
silently overwrites a sibling's edit, per the two bugs above — is a far worse student-facing
outcome than one that takes roughly 200ms–1s longer and is simply right. On responsiveness,
specifically:
- Each accept is one short round trip against an already-open connection (the same session's
  SSE/HTTP stack, not a cold connection each time) — the wait is genuinely short, and the
  `resolving`/`loading` state (step 1) makes it honest rather than dead: the student sees the
  system working, not a stalled click.
- **`Accept all`/`Reject all` remain single batch requests**, not a client-side loop over
  individual accepts — that is the actual answer to "reviewing six changes shouldn't take six
  round trips." A student who wants to move fast through a large batch reaches for the bulk
  control, which pays the network cost once, not once per change.
- The controls are **visibly disabled, not silently inert**, while a resolve is in flight — a
  student who clicks a different suggestion mid-resolve gets a clearly-unavailable control
  (§3.2/§3.4's `disabled` treatment), never a click that appears to do nothing and leaves them
  wondering whether it registered.
- **Flagged trade-off, not a reason to reintroduce concurrency:** if a student reviews changes
  one at a time via individual Accept clicks rather than Accept all, working through a long
  list this way is now strictly slower than the (unsafe) concurrent design was — each click
  waits for the previous one's round trip. If this turns out to feel bad in practice, the fix
  is steering students toward `Accept all` for bulk review (already the faster path, and
  already a single request), or shortening the round trip itself (e.g. an optimistic UI *for
  the resolving suggestion's own decoration only*, never for another suggestion or for
  `content` — a narrower, still-serialized affordance), not parallelizing individual accepts
  again.

**Motion, explicitly:**
- The popover accept/reject buttons: standard button press (§11.3, existing `Button`
  states) plus the new `resolving` busy/disabled treatment (step 1 above) — no other extra
  choreography.
- **Keyboard accept/reject: the decoration removal on success is instant** — no fade, no
  layout-shift animation on the surrounding text reflow (text reflow from an accepted edit
  is real DOM layout change; that's ProseMirror's job, not ours to animate — do not wrap it
  in a transition). This is the one place this feature deliberately omits motion that
  §12.1's "clarify flow" test would otherwise justify, because the frequency rule overrides
  it explicitly per the task brief. The `resolving` state itself has no bespoke animation —
  it's a disabled/busy control state, not a transition.
- The **pending-changes bar** and **hover popover** entrance/exit do get the standard
  200ms `ease-out` / Radix `HoverCard` defaults (already reduced-motion-safe via
  `motion-safe:` utilities and Radix's own `data-state` transitions) — those are
  infrequent, whole-surface enter/exits, not the dozens-per-session micro-interaction.
- `@media (prefers-reduced-motion: reduce)` on the bar's height/opacity transition,
  collapsing to opacity-only per the established pattern.

### 3.6 Stale state

Already covered in §2.1 rendering — additionally: a stale suggestion is excluded from
the pending-bar count and from `Alt+.`/`Alt+,` keyboard navigation (it's inert), but
still visible so the student sees what was proposed. Hovering it shows a plain
`Tooltip` (not the accept/reject `HoverCard`) reading "Your text changed since this was
suggested" with no action buttons — matches "greyed, not acceptable, labelled" from the
locked spec exactly.

## 4. Word count with pending changes

`EssayEditorPage` already computes `displayedWordCount` (line 38) from
`autosave.isDirty ? wordCount : essay.wordCount`. Extend the header's word-count `<span>`
(lines 89–100 of `EssayEditorRoute.tsx`) to append a second clause when there are pending
suggestions with a net word-count delta:

```
{displayedWordCount}{hasWordLimit ? ` / ${essay.wordLimit} words` : " words"}
{pendingWordDelta !== 0 && ` · ${displayedWordCount + pendingWordDelta} if you accept all`}
```

`pendingWordDelta` is derived in `EssayEditorPage` from the resolved suggestion list
(`countWords(new_text_plain) - countWords(old_text_plain)` summed over pending, non-stale
suggestions — PLAIN space, since this counts words as the student will actually see them,
not markdown tokens; reuse `countWords` from `essay-content.ts`, don't reimplement). Rendered
`text-xs text-muted-foreground` trailing the existing `tabular-nums` count, same `<span>`,
so it doesn't add a new layout row to the already-tight header (§9.3's documented
priority-drop ordering for this exact header). This clause drops out first among the
optional header segments if the header is measured too tight below `xl:` — lower
priority than "Modified …" would be wrong (word count is the primary content of that
segment; the *pending* clause is the added part, so it's what drops, not the base count).

## 5. Panel layout

### 5.1 Structure

`EssayEditorPage`'s outer scroll row (`EssayEditorRoute.tsx:204-218`,
`<div className="min-h-0 flex-1 overflow-y-auto ...">` wrapping a `flex` row with
`<main>`) gains a second flex child, the panel, as a sibling of `<main>` — not nested
inside it, so the panel can pin `sticky top-0 self-start h-full` independent of the
document's own scroll:

```tsx
<div className="flex min-h-0 flex-1 overflow-y-auto bg-(--essay-editor-chrome-surface)">
  <div className="mx-auto flex w-full max-w-[1440px] px-4 pt-6 pb-12 lg:px-7 lg:pt-8 lg:pb-16 gap-6">
    <main className="min-w-0 flex-1">{/* existing document */}</main>
    {panelOpen && (
      <EssayChatPanel className="hidden shrink-0 lg:flex" ... />
    )}
  </div>
</div>
```

- **Width:** fixed `w-[380px]` per the locked spec ("~380px"), not resizable — this is a
  simpler, smaller-diff choice than the sidebar's resizable pattern (§9.2), and nothing
  in the brief asks for resize. If it earns a resize handle later, that's an additive
  follow-up, not a reason to build it now (YAGNI).
- **Collapse:** a toggle button in the editor header's actions row (next to the existing
  Save button — `EssayEditorRoute.tsx:117-139`), icon-only (`PanelRight` from
  lucide-react), `aria-pressed` per §11.1 toggle convention. Collapsed state is local
  `useState` (not persisted — unlike the sidebar's `localStorage`/cookie persistence,
  this is a per-session preference on a route the student leaves frequently; persisting
  it would fight "the document is the hero" as a default on return visits). Collapse
  animates via `motion.div` `width` transition (another `width`-not-`transform` exception,
  same accordion-height carve-out reasoning, commented) — 200ms `ease-out`, or instant
  under reduced motion.
- **Document max-width:** unchanged at `max-w-[820px]` — the panel takes width from the
  now-`gap-6`'d flex row's remaining space, not from shrinking the document's own cap.
  On viewports where `820px document + 380px panel + gaps` doesn't fit (roughly <1400px
  on top of the existing sidebar/chrome chatter), the document's `flex-1 min-w-0` lets it
  compress below 820px naturally — same responsive behavior the document already has
  today without a panel.
- **`layoutId`:** unaffected — it's on the document's own `motion.div`, which doesn't
  move.

### 5.2 Responsive / mobile

Recommendation: **the panel is desktop-only chrome, collapsed to a `Sheet` trigger below
`lg:` (1024px)**, matching the sidebar's own off-canvas pattern at its breakpoint (§9.2)
rather than inventing a new responsive shape. Justification: at <1024px there isn't room
for document + panel side by side without either becoming unusably narrow (the document
alone is already 820px at its cap), and the existing `Sheet` primitive
(`components/ui/sheet.tsx`) is already the app's answer to "this chrome doesn't fit,
make it an overlay" (used by the sidebar and by the sources rail on mobile per
`DESIGN.md` §15.4). A floating action button (`PanelRight` icon, bottom-right, matching
touch-target rules §11.8) opens the `Sheet` full-width on mobile / `w-[380px]` on tablet
widths just under `lg:`. This reuses a component instead of inventing a fourth panel
shape, which is the higher-value path per the registry-first rule.

### 5.3 Focus management

- **Opening/collapsing the panel (desktop) does not steal focus.** The collapse toggle
  (§5.1) is a normal, non-modal control — clicking it does not move focus into the panel or
  the composer; focus stays exactly where it was (the toggle button itself, per default
  button-click behavior). The panel appearing is not a dialog opening.
- **Closing the panel returns focus to the toggle that opened it** — the collapse button in
  the editor header's actions row (§5.1). This is the one explicit `.focus()` call this
  feature needs on desktop: on collapse, re-focus the toggle ref.
- **The mobile `Sheet` (§5.2) traps focus and restores it on close — Radix already does
  this**, so no bespoke focus-trap code: `components/ui/sheet.tsx` wraps Radix `Dialog`,
  which moves focus into the sheet on open and restores it to the triggering element
  (the floating action button) on close, per Radix's own `Dialog` contract. Verify this in
  the mobile QA pass (§10/real-browser check), don't reimplement it.
- **Accept/reject keeps focus in the document.** For the keyboard path (§3.3), focus and the
  caret simply never leave the editor. For the popover path (§3.2), the Accept/Reject
  `<Button>`s take `onMouseDown={(e) => e.preventDefault()}` so the click never steals DOM
  focus in the first place, and once the mutation resolves the editor is explicitly
  refocused at the caret position stored when the popover opened — concretely, the same
  outcome as the keyboard path, reached deliberately rather than by accident of a real
  `<Button>` never getting clicked. Consistent with "keyboard accept/reject gets zero
  animation" (§3.5): no focus jump either.
- **Accepting/rejecting from the pending-changes list (§3.4)** keeps focus **in the list**,
  advancing to the next row (or the list's own collapse trigger if that was the last row) —
  not back in the document. A student working through the list linearly should be able to
  keep hitting Accept/Reject without refocusing anything.
- **This all holds unchanged under §3.5's serialization.** These focus rules were always
  written per-suggestion, not as a page-level lock, so gating accept/reject to one in-flight
  request at a time doesn't change where focus goes for the one that's actually resolving —
  it only means the student can't have a second one resolving to worry about focus for
  simultaneously. The "advance to next row" behavior (§3.4) is in fact what makes
  serialization free from the student's perspective: the moment one row's resolve completes
  and leaves the list, focus and the now-enabled controls are already on the next row.

## 6. Selection → composer

- Editor `onSelectionUpdate` (TipTap's native callback, add alongside the existing
  `onBlur`/`onUpdate` in `useEssayEditor.ts`) reports `{from, to, text}` when
  non-collapsed, debounced 150ms (matches the "Fast" motion tier's threshold for
  UI-reactive updates, reusing the existing `use-auto-resize-textarea`-adjacent
  `hooks/` convention — check for an existing `useDebounce`; the TS common-patterns rule
  file's example hook is the exact shape needed, add `hooks/useDebounce.ts` if genuinely
  absent).
- Selected text (`text.slice(0, 80)` truncated) renders as a dismissible chip inside the
  panel's composer, above the textarea — same visual language as the citation chip
  (`DESIGN.md` §15.3: favicon + label + `<button>`), but simpler: a `Badge` `variant=
  "outline"` with the truncated text and an `X` dismiss icon. Reuse `Badge`, don't build
  a new chip component.
- While a selection chip is present, the composer's quick-action row swaps from generic
  suggestions to the three selection-scoped verbs from the brief ("Make specific" /
  "Shorten" / "Show don't tell") — reuse `components/ai-elements/suggestion.tsx`'s
  `Suggestion`/`Suggestions` (currently zero-importer per `DESIGN.md` §10.5 — this is
  exactly the "AI Elements directory is mostly vendored scaffolding" component finally
  finding its use, better than hand-rolling a chip row).
- Clearing: dismiss button, `Escape` while composer is focused, or the underlying
  editor selection collapsing (listened via the same `onSelectionUpdate`).

## 7. Empty / loading / error states

- **Panel empty** (no suggestions, no selection, nothing sent yet): `Empty` primitive
  (`components/ui/empty.tsx`) — icon + "No messages yet" / "Ask a question to start this
  conversation" per the exact §13.2 template already defined for chat, reused verbatim
  (it's the same claim: an empty conversation).
- **Panel loading** (initial suggestions fetch, or a turn in flight): reuse the two
  staggered-width `Skeleton` bars pattern already specified for work-visibility loading
  (§15.2) rather than a spinner — consistent vocabulary.
- **A suggestion being accepted/rejected (`resolving`, §3.5):** its own Accept/Reject
  controls — in both the hover popover (§3.2) and its pending-changes-list row (§3.4) — put
  the pressed button into `Button`'s `loading` prop (`DESIGN.md` §11.6: `aria-disabled`, not
  `disabled`, so the label stays announceable, plus `data-loading` and a `Spinner` overlay)
  and its sibling button in the same pair `aria-disabled` (never native `disabled` — §3.2's
  fix: the sibling may hold real focus, and native `disabled` would eject it; visibly dimmed
  per §3.2's `aria-disabled:opacity-64`, still focusable/hoverable, no `pointer-events-none` —
  no toast or message accompanies a locked click, since the dimming is itself the signal, per
  §3.2). The document
  itself stays fully interactive (a student can keep reading, scrolling, and typing outside a
  pending suggestion's range) — this is not a page-level loading state, since `resolving`
  covers a flush-then-await plus one network round trip that can legitimately take a second or
  so per §3.5's stated trade. No skeleton, no overlay — the suggestion's own decoration stays
  visible and unstruck until the server confirms. **Per §3.3/§3.5, at most one suggestion may
  be `resolving` at a time across the whole panel** — every *other* suggestion's Accept/Reject
  controls (other popovers, other pending-changes-list rows, and the bar's Accept
  all/Reject all) get the same `aria-disabled` treatment (dimmed, focusable — §3.2) for that
  same duration, with their click/keydown handlers no-op'ing while the lock is set (§3.2). This is a deliberate reversal of
  an earlier draft that allowed concurrent per-suggestion resolves: two accepts completing out
  of order could both corrupt the "N remaining" count *and* leave the document silently
  missing an accepted edit whose response landed first but was applied second (§3.5). The busy
  state is therefore scoped to one suggestion at a time system-wide, not per suggestion
  independently.
- **Failed accept/reject:** inline toast (§3.5) — never a blocking modal, per §17.3. The
  suggestion returns to `pending` (controls re-enabled); per §3.5 there is no document edit
  to roll back.
- **Suggestions bar itself has no error state** — if the suggestions fetch fails, the bar
  simply doesn't render (falls back to zero pending), and the document renders clean;
  this degrades safely rather than blocking editing.

## 8. Component inventory

| Piece | Source |
|---|---|
| Popover on hover (accept/reject) | `components/ui/hover-card.tsx` (Radix, existing — citation hover-card precedent) |
| Stale tooltip | `components/ui/tooltip.tsx` (existing) |
| Accept/Reject/Accept-all/Reject-all buttons | `components/ui/button.tsx` (existing) |
| Pending count badge, selection chip | `components/ui/badge.tsx` (existing) |
| Pending-changes disclosure list (§3.4) | `components/ui/collapsible.tsx` (Radix, existing) |
| Composer textarea/submit/IME | `features/ai-chat/components/ChatComposer.tsx` (extend/wrap, don't fork) |
| Quick-action verb chips | `components/ai-elements/suggestion.tsx` (existing, zero-importer today) |
| Panel collapse toggle | `components/ui/button.tsx` `size="icon"` (existing) |
| Mobile panel container | `components/ui/sheet.tsx` (existing) |
| Empty/loading panel states | `components/ui/empty.tsx`, `components/ui/skeleton.tsx` (existing) |
| Toast on failed mutation | `components/ui/sonner.tsx` (existing, app-wide) |
| `aria-live` pending-count region | plain `<span className="sr-only">`, no component needed |
| Decoration rendering (insert/delete/stale spans) | **new** — ProseMirror decorations have no registry equivalent; this is the honesty-surface-adjacent bespoke work `DESIGN.md` §10.1 step 6 expects |
| `SuggestionPopover`, `SuggestionsBar` | **new** — no registry component composes "ProseMirror decoration position + hover-card + accept/reject mutation"; built from the primitives above. **`EssayChatPanel` is not built here — per C5 it is `features/essays/EssayChatPanel.tsx`, Part 3's thin `AiChatPage` wrapper, not a second chat implementation.** |
| Prefix/suffix diff trim (§2.1) | **new** — a small pure function (`old_text_plain`, `new_text_plain` — PLAIN space, never the markdown fields) → the differing middle, on word boundaries, plus the offset-to-document-position conversion; feeds three display surfaces (document decorations §2.1, popover §3.2, pending-list rows §3.4), never the accept path (§3.5, which uses the untrimmed `_plain` fields directly); no registry equivalent, and exactly the kind of logic that earns a unit test (see §10) |

## 9. Files created / modified, in build order

1. `frontend/src/domain/essay-suggestion.ts` — **new**: `EssaySuggestion` type,
   `essaySuggestionsFromApi` parser.
2. `frontend/src/domain/essay.ts` — **modify**: import and use the new parser in
   `essayFromApi` to populate a typed `EssayDetail.suggestions: EssaySuggestion[]`
   (currently untyped `Record<string, unknown>[]` on the raw `Essay` API type only).
3. `frontend/src/features/essays/suggestions/suggestionExtension.ts` — **new**: the
   TipTap extension + plugin + anchoring/staleness logic (§1).
4. `frontend/src/features/essays/suggestions/suggestionExtension.test.ts` — **new**, see
   §10.
5. `frontend/src/features/essays/useEssayEditor.ts` — **modify**: accept
   `suggestions`/`onResolvedSuggestionsChange` options, conditionally include the
   extension, add `onSelectionUpdate` for §6.
5a. `frontend/src/features/essays/useEssayAutosave.ts` — **modify**: make `saveDraft`
   (`:271-327`) return the `updateEssay(...)` promise it already builds instead of `void`,
   and make `flush()` (`:373-382`) return that promise (or `Promise.resolve()` when there is
   no pending draft) instead of `undefined` — required so §3.5 step 2 can `await flush()`
   before issuing the accept/reject request. Purely a return-type widening; every existing
   caller (`retry`, `onBlur`) already ignores the return value and keeps compiling unchanged.
6. `frontend/src/styles/essay.css` — **modify**: add the five `--essay-suggestion-*`
   tokens (§2.2).
7. `frontend/src/index.css` — **modify**: add the `.essay-suggestion-*` decoration CSS
   block next to the existing ProseMirror essay typography rules (§2.3).
8. `frontend/src/api/workspace/essays.ts` — **modify**: add `acceptEssaySuggestion`/
   `rejectEssaySuggestion`/`acceptAllEssaySuggestions`/`rejectAllEssaySuggestions`
   against Part 1 C4's four confirmed routes (`POST .../suggestions/{id}/accept`,
   `.../reject`, `.../suggestions/accept-all`, `.../suggestions/reject-all`) — the
   endpoint shape is locked, not a guess (§3.5).
9. `frontend/src/api/workspace/hooks/essays.ts` — **modify**: `useAcceptEssaySuggestion`
   / `useRejectEssaySuggestion` mutations — **no optimistic update**; on success they
   apply the server's returned content via `setContent(..., { emitUpdate: false })` and
   remove the suggestion from local state, per the rewritten §3.5 (this deliberately does
   *not* mirror `useUpdateEssay`'s optimistic shape, since an optimistic edit here is the
   data-loss bug §3.5 closes).
10. `frontend/src/features/essays/suggestions/useEssaySuggestions.ts` — **new**:
    accept/reject/acceptAll/rejectAll orchestration (§3.5).
11. `frontend/src/features/essays/suggestions/SuggestionPopover.tsx` — **new** (§3.2).
12. `frontend/src/features/essays/suggestions/SuggestionsBar.tsx` — **new** (§3.4).
13. **Deleted, per C5.** This item used to list a `features/essays/suggestions/
    EssayChatPanel.tsx` composing `ChatComposer` directly — a second chat implementation.
    That component does not exist in this plan. The essay panel's chat surface is
    `features/essays/EssayChatPanel.tsx`, built in Part 3 §1/§8/§9 as a thin
    `<AiChatPage variant="essay-panel" essayContext={...} />` wrapper — same composer,
    same message rendering, same turn engine, not re-implemented here. Left here, struck,
    so a reader who only skims this list doesn't miss that the item was considered and
    removed, not silently dropped.
14. `frontend/src/features/essays/EssayEditorRoute.tsx` — **modify**: panel layout (§5),
    word-count copy (§4), collapse toggle in the header actions row.
15. `frontend/src/pages/essay-editor-page.tsx` — **modify** only if it needs to thread a
    new prop through; check current signature before assuming a change is needed.
16. `DESIGN.md` — **modify**: register the new `--essay-suggestion-*` tokens in a table
    somewhere near §14 (status vocabulary) or as a note in the essay family section, per
    the "living document, update in the same PR" rule at the top of the file.

## 10. Tests worth writing

Per `AGENTS.md`/`DESIGN.md` §18: no reflexive tests, but anchoring/staleness is exactly
the "logic gnarly enough that a test is the fastest way to trust it" case, and it's the
one honesty-adjacent piece here (a wrongly-anchored suggestion silently applying to the
wrong text would be a real "lied to the student" failure mode in spirit, even though
§1.1 is about CDS facts specifically — the same discipline applies to not silently
misapplying an edit).

- `suggestionExtension.test.ts` — matches the actual algorithm (exact-`old_text_plain`-match-
  or-stale, no context involved, per §1.1's rewrite): a unique match resolves; zero
  matches → stale; more than one match → stale; position mapping survives an edit
  elsewhere in the document; an edit inside the anchored range invalidates it (goes
  stale even though the mapped position is still trackable). **A formatted-span case is
  mandatory here, not optional** (the Part 0 C3 bug this whole `_plain` mechanism exists to
  fix): a suggestion whose `old_text`/`old_text_plain` pair is e.g.
  `old_text: "I love **pizza**."`, `old_text_plain: "I love pizza."` against a document
  containing "I love pizza." (rendered bold in the editor) must anchor successfully and
  never go stale — this is the exact regression that made the fix necessary, so it needs a
  direct, named assertion, not incidental coverage.
- `useEssaySuggestions.test.ts` (or inline in the hook's own file per existing
  `useEssayAutosave` convention — no dedicated test file exists for that hook either, so
  match precedent): **the honesty-critical assertion is that accept applies only the
  server's returned content and queues no autosave** — this is the direct regression test
  for the data-loss bug §3.5 was rewritten to close. Concretely: mock the accept endpoint to
  return an `Essay` whose `content` carries formatting the plain `new_text_plain` never had
  (e.g. server content contains a bold mark where the suggestion's `new_text_plain` was
  plain "incredible food"); assert (a) `editor.commands.setContent` is called with exactly
  the server's returned content and `{ emitUpdate: false }`, (b) no `onUpdate` fires as a
  result of that call, and (c) `autosave.queueSave`/`saveDraft` is never invoked during the
  accept flow — i.e. the accepted content cannot be overwritten by a subsequent autosave.
  Also assert: `flush()` is genuinely awaited before the accept `POST` is issued — mock
  `useEssayAutosave.flush` to return a controllable, not-yet-resolved promise and assert the
  accept `POST` is not called until that promise resolves (a mock that resolves
  synchronously/immediately would pass even against the old, broken `void`-returning
  `flush()`, so the mock must actually defer); the suggestion moves to `resolving` on invoke
  and back to `pending` (not removed) on a failed request, with no `setContent` call and no
  document mutation attempted on failure — there is no rollback path to test because none
  exists by design (§3.5). **The highest-value test in this plan:** accepting one suggestion
  out of several pending ones leaves every sibling suggestion `pending` (never `stale`) and
  still correctly anchored — assert the accept-success transaction carries
  `tr.getMeta(SuggestionPluginKey)` with **exactly the response's own `suggestions` array**
  (not a locally-filtered list — §3.5's fix reads the remainder straight off the accept
  response, never re-derives it client-side), and that the plugin's resolved-suggestions
  output after that transaction still resolves every sibling to a valid, non-stale range. This
  is the direct regression test for the stale-siblings bug — without the meta, siblings are
  mapped through the whole-document replacement, fail re-validation, and flip to `stale`.
  **A second, equally load-bearing test: a second accept/reject cannot be initiated while one
  is already in flight.** Invoke accept on suggestion A (leave its mock response unresolved),
  then attempt accept on suggestion B before A's promise settles, and assert (a) no second
  `POST` is issued for B, (b) B's controls carry `aria-disabled` (not native `disabled`, not
  `loading`), carry the `aria-disabled:opacity-64` dimming class (§3.2) and remain focusable
  (no `disabled` attribute, no `tabindex="-1"`, no `pointer-events-none`) for the duration, and
  a click/keydown on them no-ops rather than firing a request (§3.2's fix — B's controls may
  hold real focus, so native `disabled` is never used), and
  (c) once A's response resolves and is applied, B's controls become available again with
  no residual lock, `aria-disabled` removed, and the dimming class gone. This is the direct regression test for the response-ordering bug §3.5
  closes by removing concurrent per-suggestion resolves entirely — without this guard, B's
  accept could fire against a document about to be replaced by A's response, and if B's
  response then landed and were applied *after* A's, the document would silently end up
  missing A's already-committed edit. **Explicitly drop** any test from an earlier draft that
  asserted concurrent per-suggestion `resolving` states were simultaneously supported (e.g.
  "student may accept a different suggestion while an earlier one is still in flight") — that
  behavior no longer exists and asserting it would be asserting the bug back in.
- `suggestionExtension.test.ts` (or co-located with the above) — **meta-vs-mapping
  ordering**: a transaction carrying both `tr.docChanged` and
  `tr.getMeta(SuggestionPluginKey)` takes the recompute branch, never the mapping branch —
  assert directly against `apply()`, not just observed indirectly through the accept flow,
  since this is the load-bearing invariant §1.2/§3.5 both depend on.
- `useEssayAutosave.test.ts` (new, since none exists today per §10's own note on precedent —
  add one specifically for this regression) — `flush()` returns a promise that resolves only
  after `updateEssay(...)` resolves (not before), and resolves to `Promise.resolve()`
  immediately when there is no pending draft; existing fire-and-forget callers (`retry`,
  `onBlur`) are unaffected by the return-type change (call them and assert no behavior
  difference beyond the additional, ignorable return value).
- Diff-trim function (§2.1/§8) — pure function, no editor needed, operating on
  `old_text_plain`/`new_text_plain` throughout: common-prefix-only (renders pure
  insertion), common-suffix-only (renders pure deletion), genuine replacement (both
  differ), word-boundary trimming (a shared substring inside adjacent unrelated words
  doesn't get trimmed into a ragged half-word), and the canonical "delete a clause" case
  (`old_text_plain: "I like pizza, which is my favorite food."`, `new_text_plain: "I like
  pizza."` → common suffix trims to nothing, differing middle of `new_text_plain` is empty,
  classified as pure deletion) — this is the case that motivated §2.1's condition rewrite,
  so it needs its own assertion. Offset-to-document-position conversion across a
  multi-block anchor is covered separately, against a resolved multi-block anchor, and
  **must assert the code passes `blockSeparator: ""` to every `textBetween` call** (§2.1,
  Fix 2 — this is pinned, not an implementer choice, so the test should fail if a future
  edit changes it to `"\n\n"` or anything else).
- Explicitly **skip**: snapshot/render tests for `SuggestionPopover`/`SuggestionsBar`
  purely for coverage, motion-timing tests, and anything that would just restate the JSX.

## 11. Risks

1. **Decoration-position correctness under concurrent typing.** The mapping path
   (§1.2's `tr.docChanged` branch) is the highest-risk piece: ProseMirror's
   `tr.mapping` is well-tested for *position* tracking but doesn't know about text
   *identity* — a mapped range can point at the right offsets while containing entirely
   different text if the student typed inside it. Mitigated by the explicit
   re-validation-after-mapping step (§1.2), but this is the one place a subtle bug would
   manifest as "silently misapplied" rather than "visibly broken" — worth a deliberate
   manual QA pass (type inside, before, and after a pending suggestion's range; delete
   across a suggestion boundary; paste a block that shifts everything) beyond what the
   unit tests above cover.
2. **`syncContent` interaction.** If a save round-trip ever returns content that differs
   from what's locally in the editor (e.g., server-side normalization), the `setContent`
   call is a real doc replacement, not a no-op — the mapping-based staleness check would
   need to run against the *new* doc, which `apply()`'s `docChanged` branch already
   does correctly by construction (it always maps against `newState.doc`), but this
   deserves a specific test case (the "an edit inside the anchored range invalidates it"
   case in §10's list) rather than assumed-safe.
3. **Dead — resolved by the §3.5 rewrite, contingent on the `flush()` fix in §9 item 5a.**
   This item used to flag that accepting a suggestion edits the doc locally, which fires
   `onUpdate` → `autosave.queueSave`, and that the resulting content-save could race the
   separate accept/reject `POST` if `useAcceptEssaySuggestion` accidentally shared
   `useEssayAutosave`'s in-flight tracking. Per the rewritten §3.5, there is no local
   document edit on accept at all: the flow is flush-then-**await** any pending autosave,
   then `POST` accept, then apply the server's returned content plus the suggestions-changed
   meta in one transaction via `editor.chain().setContent(..., { emitUpdate: false
   }).command(...).run()`, which fires no `onUpdate` and therefore queues no autosave. There
   is no longer a content-save for the accept `POST` to race against — **but this guarantee
   holds only because `flush()` is now genuinely awaitable** (§9 item 5a: `saveDraft`/
   `flush()` return the underlying `updateEssay(...)` promise instead of `void`). Before that
   fix, `await flush()` resolved on the next microtask regardless of whether the save had
   actually landed, so the accept `POST` could still fire against a stale server-side copy
   while a flushed save was in flight — a real, not hypothetical, version of the race this
   item claims is closed. With the awaitable `flush()`, the ordering (the flush's `updateEssay`
   call genuinely completes before the accept request is sent, and the success path emits no
   new save) makes the race structurally impossible, not merely unlikely. Left here, struck,
   so a reader who only skims §11 doesn't miss that this risk was considered and closed, not
   silently dropped.
4. **Dead — resolved by C4.** This item used to flag that §3.5 and §9 item 8 assumed an
   unconfirmed `PATCH .../{suggestionId}` endpoint shape. Per C4, the backend contract is
   the four `POST .../suggestions/{id}/accept|reject` and `.../suggestions/accept-all|
   reject-all` routes — §3.5 and §9 item 8 are now written against those directly. Left
   here, struck, so a reader who only skims §11 doesn't miss that this risk was
   considered and closed, not silently dropped.
5. **Selection-scoped composer verbs need a real backend prompt/skill behind them**
   ("Make specific" / "Shorten" / "Show don't tell") — this plan only specs the chip UI
   (§6); the actual agent-side handling of a selection-scoped instruction is out of
   frontend scope and should be confirmed as covered somewhere (Part 1 or a Part 3) before
   build, so the chips aren't shipped as UI with nothing behind them.
6. **Dead — closed by Part 0 C3.** This item used to flag that pure-insertion suggestions
   have no client-side anchor, since `old_text: ""` has nothing to search the document
   for, and left the resolution as an open question for whoever owns Part 1. It is not an
   open question: Part 0 C3 verifies against the real code that `old_text` can never be
   empty (`apply_edits`, `app/workspace/essay_markdown.py:667-684`, raises "ambiguous" for
   an empty `old_text` on any non-empty essay, and suggest mode never runs on an empty
   one), so a pure insertion is always stored as a replacement whose `new_text` extends a
   short, non-empty `old_text` anchor — which resolves through the ordinary
   exact-match-or-stale mechanic like any other replacement (§1.1), and renders as a pure
   visual insertion via the prefix/suffix trim (§2.1). Left here, struck, so a reader who
   only skims §11 doesn't miss that this risk was considered and closed, not silently
   dropped.
7. **Dead — resolved by §3.5's serialization rewrite.** A review pass found that concurrent
   per-suggestion `resolving` — previously declared "intentional and supported" — had a
   second, independent failure mode beyond the stale-siblings/count bug the single-transaction
   fix (item 3 above, §3.5 step 4) already closes: each accept also applies the server's
   returned authoritative `content`, computed by the server *before* any sibling accept still
   in flight has committed. If suggestion A's accept response landed and was applied *after*
   suggestion B's (a real possibility with two independent in-flight requests, since network
   timing has no relationship to request order), the document would silently end up missing
   A's already-committed edit — the server's stored content is correct, A really did save, but
   the student's screen would diverge from it until the next full sync, with no error and no
   visible signal anything was wrong. §3.5 now serializes accept/reject to at most one in
   flight across the whole panel (never per-suggestion), which makes this race structurally
   impossible rather than merely unlikely: there is no second in-flight response that could
   land out of order, because there is no second in-flight request. `Alt+.`/`Alt+,` navigation
   stays available throughout serialization (§3.3) — only the resolve-triggering actions are
   gated, so a student can still read and move around pending changes while one resolve is in
   flight. Left here, struck, so a reader who only skims §11 doesn't miss that this risk was
   found and closed, not silently dropped.
# Part 3 — chat surface reuse (essay editor panel) + the document panel in main chat

Scope: (a) reuse the existing `AiChatPage` chat stack as a ~380px panel inside the essay
editor, essay-scoped; (b) add a right-hand document panel to the main chat (`/app/ai/:sessionId`)
that opens the same shared document surface Part 2 builds, triggered from a mutation-receipt
card or by asking. **Zero changes to the main agent** (backend tools/prompt untouched — new
essay skills surface through the existing skill registry/picker). Part 2 owns the tracked-changes
internals of the document surface; this part owns the component boundary, both callers, and all
chat-side integration.

Everything below was verified against the current tree, not guessed:
`frontend/src/features/ai-chat/**`, `frontend/src/features/ai-composer/**`,
`frontend/src/features/essays/**`, `frontend/src/api/chat/**`, `frontend/src/app/shell/**`,
`frontend/src/components/workspace/PageContainer.tsx`, `frontend/src/pages/essay-editor-page.tsx`,
`frontend/src/pages/ai-page.tsx`, `frontend/src/app/router.tsx`, `DESIGN.md`,
`frontend/src/styles/README.md`.

---

## 0. What already exists that this plan leans on hard

- **`ChatTransport.createSession`/`sendMessage` have no surface/essay/selection fields today**
  (`frontend/src/api/chat/types.ts:820-849`). Adding them is a **backend-adjacent wire change**,
  not a main-agent change — it's session/message metadata the agent's tools and prompt never see.
  That wire work is assumed to land wherever Part 1 (backend essay skills) lands; this part
  specifies the exact FE shape it needs and treats it as an external dependency.
- **`MutationSubject.resource_ref`** (`frontend/src/api/chat/types.ts:322-325`) already carries
  the mutated essay's UUID on every `essay`/`essay_content` receipt — confirmed live in
  `app/workspace_mutation_receipts.py:109` (`subject(title, resource_ref=essay.id)`) and already
  parsed FE-side in `parseMutationReceipt.ts:42-44`. **It is parsed but never read for navigation
  today.** This is the entire wire dependency the "receipt as a door" affordance needs — no
  backend change at all, just FE wiring.
- `AiChatPage` is a **prop-driven, self-contained page component** (`sessionId`, `initialTurn`,
  transport injection) with no assumption baked in about being full-width other than Tailwind
  classes on itself and two children (`ChatMessages`, `SourcesRail`). It already renders as
  `<main className="flex min-h-0 flex-1 md:bg-sidebar">` — i.e. it's already built to be handed
  a flex-sized box by its parent, not to own viewport width itself.
- `AiComposer.tsx` and `ChatComposer.tsx` are documented, known duplicates (DESIGN.md §20 debt
  #9). Not this plan's job to merge them — noted only so nothing here accidentally deepens the
  fork by copy-pasting a third variant.

---

## 1. Reusing `AiChatPage` in a 380px panel

### Verdict: no fork. One new optional prop (`variant`), consumed by three existing children,
### wired by a ~40-line wrapper component that owns essay-specific concerns outside `AiChatPage`.

**Why not fork:** `AiChatPage` is 500 lines of turn-lifecycle wiring (clarify drafts, response-mode
hydration, feedback, sources, retry/model-unavailable recovery, initial-turn dispatch). All of it
is identical in the essay panel — the essay panel is "the same chat, narrower, pre-scoped to an
essay's session." Forking means every future turn-engine fix (this file changes constantly per
its own comments — see the `plan §5.5/§8.4` references throughout `useTurnEngine.ts`) has to be
re-applied twice. That is exactly the duplication AGENTS.md's "extend, don't rewrite" rule exists
to prevent.

**What actually breaks at 380px**, checked against each child `AiChatPage` renders:

| Component | What breaks at 380px | Fix |
|---|---|---|
| `ChatMessages` | `mx-auto w-full max-w-3xl px-4 py-6` (line 83) — the `max-w-3xl` (768px) is a no-op below its own width, so this is actually **fine as-is**: it degrades to `w-full px-4`. No change needed. | none |
| `ChatComposer` | Toolbar row is `flex-wrap gap-3` (line 209) — at 380px minus 32px padding (~348px usable), `CounselingModeMenu`/`SourcesMenu`/`ResponseModeMenu` chips plus the send button will wrap onto two lines. This is visually fine (the row already wraps by design) but the **essay panel doesn't want the response-mode picker at all** (explicit product requirement — essay turns aren't deep-research-eligible). | new `hideResponseMode` prop (see below) |
| `AiChatPage`'s own layout (`<main className="flex ...">` wrapping the message column + `SourcesRail`) | `SourcesRail` is `hidden ... md:flex` at a **fixed `w-[26rem]` (416px)** — wider than the whole panel. Opening it inside a 380px panel would blow out the layout or force an ugly inner scroll. | in the panel variant, sources open in the **shell's own** `SourcesRail`-equivalent, not inline — see below |
| `AgentRunView` / `ToolBeat` / `MutationReceiptShell` | All use the shared `grid-cols-[16px_minmax(0,1fr)] gap-3` tool-beat grid (DESIGN.md §15.2) — no fixed widths, degrades cleanly. Text wraps; nothing overflows. | none |
| `VizBlock` (`stat_block`/`comparison_table`) | `comparison_table` renders schools as columns — genuinely too wide for 380px. | `VizBlock` already needs to be legible in the **main chat's own narrow states** (mobile, `sm:`) since DESIGN.md documents no viz-specific breakpoint handling; confirm it already has a horizontal-scroll container (grep shows `SearchToolWidget` uses `@container` for exactly this). If `VizBlock`'s tables don't already scroll, that's a **pre-existing bug**, not new panel scope — flag, don't silently redesign viz for this plan. |
| `MessageSources` / citation chips | Chips are inline in markdown text, wrap normally. Fine. | none |
| `SkillPicker` / `InlineSkillMentionLayer` | Positioned via `anchorRef` (the composer div) — a popover anchored to a 380px-wide box will itself size to content, which may be wider than the panel and overflow. | `SkillPicker` already needs viewport-edge collision handling for the *narrow sidebar chat* case (the sidebar can be resized down to 232px, per DESIGN.md §9.2) — if it doesn't already clamp to viewport, that's pre-existing, not new. Verify in Phase 5 testing; do not add bespoke essay-panel logic for it. |

**The extension, concretely:**

1. **`AiChatPage` gains one new prop, additive and optional, default preserves today's behavior:**
   ```ts
   export type AiChatSurfaceVariant = "workspace" | "essay-panel";

   export type AiChatPageProps = {
     // ...existing props
     variant?: AiChatSurfaceVariant; // default "workspace"
     essayContext?: { essayId: string; selection?: EssaySelectionRef | null };
   };
   ```
   `variant` does exactly three things inside `AiChatPage`:
   - Passes `hideResponseMode={variant === "essay-panel"}` down to `ChatComposer` (new prop on
     `ChatComposer`, defaults `false`; when true, `ResponseModeMenu` is not rendered — the
     composer's `flex-wrap gap-3` row already tolerates one fewer chip with no other change).
   - Renders `SourcesRail` only when `variant === "workspace"`. In `"essay-panel"` mode,
     `openSources`/`closeSources` are threaded up via a new optional `onOpenSources` **callback
     prop** instead of managing local `sourcesPayload` state — the essay panel's shell (the essay
     editor route) owns where citations actually surface (see §5's note on the essay panel not
     needing its own sources rail at first cut: **defer real sources-rail support in the essay
     panel to a follow-up**; a citation click can no-op or open in a lightweight popover using
     the existing `CitationRenderer` hover-card, which already exists and needs no new work).
   - Applies a `data-chat-variant={variant}` attribute on the outer `<main>` — this is the one
     styling hook a future 380px-specific CSS tweak would key off, per DESIGN.md's `data-slot`
     convention, rather than a prop-drilled className.
2. **A new thin wrapper, `EssayChatPanel.tsx`**, lives in `frontend/src/features/essays/` (not
   `ai-chat/` — it's essay-feature-owned, the same way `AiChatRoute.tsx` is chat-feature-owned).
   It is responsible for: resolving/creating the essay-scoped session id (§3), passing
   `essayContext`, rendering `AiChatPage` inside a fixed-width flex child, and the quick-action
   chip row above the composer (§3). It does **not** re-implement any turn logic.
3. **No changes to `useChatSession` or `useTurnEngine`** beyond what §2 requires for the surface
   flag — the panel is a consumer of the same hooks through the same `AiChatPage`, not a second
   turn-engine caller.

This is the smallest diff that satisfies "same composer, same message rendering, same
streaming/activity-timeline components" literally — the essay panel *is* an `AiChatPage`
instance, not a lookalike.

**Closing the panel mid-turn does not need new lifecycle handling.** Because the panel is a
real `AiChatPage` instance, an in-flight turn is owned by the existing `TurnRegistry`
(backend) / turn-engine (frontend) exactly like a main-chat turn is — it does not belong to
the React component that happens to be rendering it. Collapsing the panel (§5.1) or
navigating away just unmounts that `AiChatPage`; the turn keeps running server-side and the
frontend's existing detach/reattach path (the same mechanism a main-chat turn already
survives a page refresh or tab close through) picks it back up the moment the panel — or the
essay's session — is rendered again. This is citing the existing mechanism, not inventing a
new one: no essay-specific "resume this turn" code is needed.

---

## 2. The surface flag on the wire

**Goal:** every turn started from the essay panel tells the backend (a) this is essay-surface,
(b) which essay, (c) the current text selection, if any — without touching the agent's tools or
prompt (those read turn context the backend already resolves; the surface flag only changes
*which skills the composer offers by default and what session metadata gets stored*, per the
product spec: "the essay-surface flag sent with each turn").

**Smallest diff, given `useChatSession`/`useTurnEngine`'s existing submit path:**

- `SubmitMessageOptions` (`useTurnEngine.ts:62-79`) gains one new optional field:
  ```ts
  essayContext?: { essayId: string; selection?: EssaySelectionRef | null };
  ```
- `SendMessageInput` (`api/chat/types.ts:782-794`) and `ChatTransport.createSession`'s input
  (`types.ts:822-825`) both gain the same optional `essayContext` field. `transport.ts`'s
  `createSession`/`sendMessage` serialize it to snake_case (`essay_context: { essay_id, selection }`)
  exactly like `sourceConfig` already does (`toWireSourceConfig`) — same pattern, same file,
  same function shape. **Per C2, `selection` on the wire is `EssaySelectionRef["text"]` alone**,
  never the `{from, to}` positions the FE-internal `EssaySelectionRef` may carry — the
  serializer narrows `{ from, to, text }` down to just `text` (or `null`) at exactly this
  boundary, the same way `MessageBody.essay_context.selection` is typed on the backend (§1.2).
- **`runTurn`/`startSend` in `useTurnEngine.ts` pass `essayContext` straight through** to
  `transport.sendMessage(...)` and `transport.createSession(...)` — no branching logic added to
  the engine itself. The engine doesn't need to know what essay-surface *means*; it only needs to
  forward one more field, the same way it already forwards `sourceConfig`/`responseMode` without
  interpreting them.
- `EssayChatPanel.tsx` is the **only** call site that ever passes `essayContext` — the workspace
  `AiChatPage` instance (`AiChatRoute.tsx`) never does, so `essayContext` is `undefined` on every
  existing turn and the wire payload is byte-identical to today for the main chat. This is what
  makes the change genuinely zero-risk to the main agent path.
- **Selection**: `EssaySelectionRef` is a small new type (`{ from: number; to: number; text: string }`
  or whatever Part 2's document surface exposes as its selection accessor — this plan does not
  invent tracked-changes internals, it just needs *a* selection value to forward). `EssayChatPanel`
  reads the current selection from the shared document component's exposed `onSelectionChange`
  (Part 2's prop, §4) and holds it in local state, attached to the *next* submit only — it is not
  sticky across turns, matching how `sourceConfig`/`responseMode` are each turn's own snapshot.

No change to `useChatSession.ts` itself — `essayContext` flows through `submitMessage`'s
options object it already destructures and forwards to `useTurnEngine`, so the hook doesn't need
a new parameter, only `AiChatPage`'s `handleComposerSubmit` needs to append
`essayContext: variant === "essay-panel" ? panelEssayContext : undefined` to the options object
it already builds at `AiChatPage.tsx:215-221`.

---

## 3. Per-essay chat history

**Session scoping — per C4/C6, this is a database concern, not a client-side cache.** An
earlier draft of this section proposed a client-side `localStorage["counselle:essay-chat-
sessions"]` map (mirroring `useResizableSidebar`'s persistence pattern) as "the simplest
correct thing." **Per Part 0 §0.2 C6, that is wrong and is overridden**: the conversation
about an essay is a property of the essay, so it must survive a different browser or
device — a localStorage map silently gives the student a blank panel on their laptop and
a different blank panel on their phone, with no way to tell they lost anything. Use Part
1's design instead: the `counselle.sessions.essay_id` column, its partial unique index
(exactly one session per essay, Part 1 §7.2), and `POST /v1/essays/{essay_id}/session`.

- A new, small hook, `useEssayChatSession(essayId: string)`, in
  `frontend/src/features/essays/useEssayChatSession.ts`. It is a **thin client of that
  endpoint, with no localStorage**: on mount for a given `essayId`, it calls
  `POST /v1/essays/{essayId}/session` once, which returns the essay's one durable
  `session_id` (creating it on first call, per Part 1 §7.2's `ON CONFLICT ... DO NOTHING`
  get-or-create). The panel then opens `AiChatPage` with that `session_id` — which, if the
  essay already has history, opens straight into it, and if not, renders exactly like a
  fresh top-level chat (`sessionId` was never `null` here the way `AiComposerRoute.tsx`'s
  landing state is; the session row always exists before the panel renders its first
  message).
- **No "new chat" control, per C6's explicit decision.** The partial unique index on
  `sessions.essay_id` enforces exactly one session per essay — there is no backend
  operation that retires the current session and starts a successor, and building a
  control that only *forgets* the mapping (the localStorage-era idea) would silently
  discard the conversation with no way back, which is worse than no control at all. One
  durable thread per essay is the product promise for this first cut; revisit only if
  students ask, per Part 1 C6.
- **No new session-list UI.** The essay panel is single-thread per essay by design (spec: "per-essay
  chat history" — implies *the* history for that essay, not a picker across many), and this
  falls out for free from C6's one-session-per-essay design — there is nothing to list.
- **Chat-list exclusion.** Per Part 1 §7.3, `list_sessions` filters `WHERE essay_id IS NULL`,
  so this essay-scoped session never appears in the main chat sidebar — nothing to build
  here, just don't assume the essay's session shows up anywhere but the panel.

**Empty-history state.** The essay's session always exists by the time the panel renders
(the `POST .../session` call above resolves before `AiChatPage` mounts with a real
`session_id` — there is no client-side "no session yet" state under C6, unlike the main
composer's landing page). `EssayChatPanel` still passes an `initialTurn`-shaped seed **only
when the student actually sends something** — same contract `AiChatPage` already has via
`initialPrompt`/`initialTurn`. Until a first message exists in that session's history, the
panel shows:
- The **opening line**, rendered where `ChatMessages`' empty state already renders
  (`ChatMessages.tsx:60-71`, the "No messages yet" block) — but essay-scoped copy, per DESIGN.md
  §13.4 (second person, present tense, says the noun):
  > **"Let's work on this essay."**
  > "Ask Counselle to draft, revise, tighten, or check anything about {essay.title}."
- **Quick-action chips** above the composer (a new small row, reusing the `Button` primitive at
  `variant="outline"`, `size="sm"` — same shape as existing chip rows in `ChatComposer`'s toolbar,
  not a new component). Copy, essay-specific and skill-triggering (each chip inserts task-skill
  text the same way `SkillPicker`'s `insertTrigger`/`selectSkill` already does — no new mechanism):
  - **"Tighten this paragraph"** (enabled only when there's a live selection; disabled/hidden
    otherwise — ties into the selection chip, §1/§4)
  - **"Check this against the prompt"**
  - **"Suggest a stronger opening line"**
  - **"What's missing here?"**
  These are exactly the "essay-specific quick-action chips" called out in the spec. They are not
  a new skill-picker UI — they are pre-filled composer submissions, same shape as the initial-turn
  dispatch `AiChatPage` already does at mount (`AiChatPage.tsx:280-313`).

**The selection chip in the composer** (also explicit in the spec): a small removable chip
rendered in `ChatComposer`'s existing toolbar row (`ChatComposer.tsx:216-261`, the
`flex min-w-0 flex-wrap items-center gap-2` row) showing e.g. `"¶2, 34 words"` with an `XIcon` to
clear it — this requires `ChatComposer` to accept two more optional props,
`selectionChip?: { label: string } | null` and `onClearSelection?: () => void`, rendered
conditionally before the mode/sources/response-mode chips. This is additive to `ChatComposer` and
inert for the main chat (`undefined` → nothing renders), preserving "one shared composer."

---

## 4. The shared document surface

**This is the load-bearing architectural call. Get the boundary right:**

### The component: `EssayDocumentSurface`

Lives in `frontend/src/features/essays/EssayDocumentSurface.tsx` (feature-owned, not
`components/ui/` — it is Counselle's differentiating honesty surface, per AGENTS.md's "build new
for differentiating surfaces" rule, DESIGN.md §10.1 step 6). It wraps:
- The TipTap editor (`useEssayEditor`, `EditorContent`) — **unchanged**, Part 2 extends
  `useEssayEditor`'s extension list with whatever tracked-changes/suggestions extension it adds
  (a TipTap extension, e.g. based on `@tiptap-pro/extension-track-changes` or a hand-rolled
  suggestion decoration layer — Part 2's call, not this plan's).
- The paper surface styling currently inline in `EssayEditorRoute.tsx:207-215` (the
  `motion.div.essay-editor-shell` with `layoutId`, border/shadow/typography tokens) — **moved
  into this component**, parameterized by whether the shared-element `layoutId` is present (see
  below).
- Part 2's suggestions layer (accept/reject affordances) rendered as a prop-driven overlay/
  toolbar this component hosts, not owns — this plan does not specify accept/reject UI, only that
  the component has a slot for it.

**Props** (the contract both callers share):

```ts
type EssayDocumentSurfaceProps = {
  essay: EssayDetail;
  /** Registers Part 2's tracked-changes editor instance one level up so a
   *  caller (the editor route's toolbar, or nothing, for the panel) can
   *  drive bold/italic/etc. Mirrors today's useEssayEditor return shape. */
  onEditorReady?: (editor: Editor, toolbarState: ToolbarState) => void;
  /** Content sync + autosave wiring stays at the CALLER, not in this
   *  component (both callers already have different autosave cadences —
   *  see below) — this component is receive-content, emit-changes only. */
  content: TiptapContent;
  onUpdate: (update: EssayEditorUpdate) => void;
  onBlur: (update: EssayEditorUpdate) => void;
  syncContent: boolean;
  /** Selection reporting for the chat composer's selection chip (§3). No-op
   *  prop when unused (the full editor page doesn't pass it). */
  onSelectionChange?: (selection: EssaySelectionRef | null) => void;
  /** Shared-element continuity between the essay card, the panel, and the
   *  full editor — see §5/§7. Omit to render without the layoutId (a
   *  standalone panel open has nothing to morph from). */
  layoutId?: string;
  /** Panel renders at a narrower measure and skips the outer page chrome
   *  (max-width, generous padding) the full editor page wraps it in. */
  density?: "editor" | "panel";
};
```

**Why content/autosave stay at the caller, not inside the shared component:** the full editor
page's autosave (`useEssayAutosave`, 1.5s debounce, keepalive-on-hide) and the panel's needs
(the panel doesn't drive typing at all in the first cut — see §7 "editable there" below is a
locked requirement, so this *does* need the same autosave wiring, not a divergent one) are
**the same hook, reused as-is** — `EssayChatPanel`'s open document view calls `useEssayAutosave`
exactly like `EssayEditorRoute` does today. The reason this lives at the caller and not inside
`EssayDocumentSurface` is boundary hygiene: the component's job is "render the document + tracked
changes," not "know how essays get persisted." This mirrors the existing separation in
`EssayEditorRoute.tsx` today, where `useEssayAutosave` and `useEssayEditor` are already two
separate hooks composed by the route, not fused.

### The two callers

1. **`EssayEditorRoute.tsx`** (full editor page) — replace the current inline
   `motion.div.essay-editor-shell` + `EditorContent` block (lines 204-218) with
   `<EssayDocumentSurface essay={essay} density="editor" layoutId={`essay-document-${essay.id}`} content={essay.content} onUpdate={handleUpdate} onBlur={handleBlur} syncContent={!autosave.isDirty} onEditorReady={(editor, state) => setToolbarState/editorRef} />`.
   The page keeps owning `PageHeader`, the toolbar (`EssayEditorToolbar`, which needs the `editor`
   instance — supplied via `onEditorReady`), and the outer `max-w-[1440px]` scroll wrapper. This
   is a **near-zero net diff**: the JSX that moves is exactly what's already in the file, lifted
   one level.
2. **The main chat's document panel** (new, §5) — renders `<EssayDocumentSurface essay={openEssay} density="panel" layoutId={`essay-document-${openEssay.id}`} content={...} onUpdate={...} onBlur={...} syncContent={...} onSelectionChange={setSelection} />` inside the panel's fixed-width column, with its own thin header (title, "Open in editor" affordance, close button — §6/§7) that the full editor page's `PageHeader` doesn't need to duplicate.

Both callers share the exact same `layoutId` pattern already proven in `EssayEditorRoute.tsx`
(`layoutId={`essay-document-${essay.id}`}`) and `EssayDocumentPreview.tsx` (the essay-library card
uses the same id format) — this is **not new machinery**, it's the third user of an existing
`motion` shared-element convention, which is exactly why the panel-open and "open in editor"
transitions in §5/§7 can be genuinely animated (`layoutId` match) rather than faked with a fade.

### Where Part 2's tracked-changes internals plug in

Part 2 is expected to expose, from whatever hook/extension it builds (analogous to
`useEssayEditor`'s return shape), a suggestions collection + accept/reject callbacks.
`EssayDocumentSurface` hosts that as a **toolbar strip or inline decorations rendered by Part 2's
own sub-components**, passed in via composition (children or a dedicated
`suggestionsOverlay?: ReactNode` slot) rather than this plan inventing the shape. The contract
this plan commits to: **whatever Part 2 builds must work unmodified in both `density="editor"`
and `density="panel"`** — if a control needs the full 820px measure to make sense, that's a bug
Part 2 must fix, not something Part 3 works around, because "same paper, same tracked-changes,
same accept/reject" is a locked product requirement.

---

## 5. The main chat split layout

### Layout mechanics

`AiChatPage`'s workspace-variant render (`AiChatPage.tsx:402-500`) currently returns:
```
<main className="flex ... md:bg-sidebar">
  <div className="flex-1 flex-col ...">  {/* messages + composer */}
  <SourcesRail ... />                     {/* w-[26rem], conditional */}
</main>
```
The document panel becomes a **third sibling in that same flex row**, mutually exclusive with
`SourcesRail` on desktop (both are right-docked panels; opening one closes the other — see below)
but structurally identical in how they attach: `hidden md:flex` + a fixed width + `shrink-0`,
exactly like `SourcesRail`'s own `w-[26rem]` treatment.

- **Width**: reuse the sources rail's `w-[26rem]` (416px) as the closed/default document panel
  width is **not** what's wanted here — the document needs real writing room. Use a distinct,
  wider fixed width: **`w-[36rem]` (576px)** on `lg:` and up, collapsing to a full-width takeover
  below `lg:` (see mobile behavior below). 576px is chosen to comfortably fit the essay's own
  `max-w-[820px]` document measure scaled down with padding, without being wide enough to fight
  the chat column for the "one raised level" (DESIGN.md §2.2 Law 3) — the panel is chrome-adjacent
  (own surface), not a second canvas.
- **The existing chat max-width and mobile behavior are untouched.** `ChatMessages`' inner
  `max-w-3xl` (768px) already degrades gracefully when the flex parent shrinks (same reasoning as
  §1's table for the essay panel) — opening the document panel simply shrinks the chat column's
  available width, same as opening `SourcesRail` does today. No new breakpoint logic needed in
  `ChatMessages` itself.
- **Mutual exclusivity with `SourcesRail`**: both panels are lifted to `AiChatPage`-level state as
  a single discriminated union, not two independent booleans:
  ```ts
  type RightPanel =
    | { kind: "sources"; payload: MessageSourcesPayload }
    | { kind: "document"; essayId: string }
    | null;
  ```
  Opening a citation while the document panel is open closes the document panel and vice versa —
  this is a **product-sensible default** (DESIGN.md's "one raised level" logic applies to
  right-docked chrome too: two competing right rails is worse than one that swaps), and it is a
  small, explicit decision this plan is making, not an accidental side effect. `sourcesPayload`
  state (`AiChatPage.tsx:75-76, 367-371`) is replaced by this union; `openSources`/`closeSources`
  become `openPanel(panel: RightPanel)`/`closePanel()`.
- **Resize**: **no user-resizable divider in the first cut.** The sidebar's resizer
  (`SidebarResizer`, `useResizableSidebar`) is a real, non-trivial piece of machinery (drag
  handling, min/max clamping, localStorage persistence, double-click reset) — reusing it wholesale
  for a second resizable edge is exactly the kind of yes-value/hard-effort tradeoff AGENTS.md's
  value×ease rule says to skip *unless* it's genuinely high-value. A fixed, well-chosen width is
  the smallest correct thing; resizability is a clean follow-up if it's ever asked for (the state
  shape above already isolates "panel width" as a single tunable if that day comes).

### Open/close motion

Per the design skill's constraints (≤250ms, interruptible, no animation on keyboard-triggered
open, `prefers-reduced-motion` alternative mandatory, `transform`/`opacity` only):

- Reuse `SourcesRail`'s exact proven pattern: `motion-safe:animate-in motion-safe:fade-in
  motion-safe:slide-in-from-right-2 duration-200 ease-out` (this is verbatim what
  `SourcesRail.tsx:421` already does — 200ms sits inside DESIGN.md's Base tier, already
  under the panel's 250ms budget). The document panel gets the identical Tailwind utility
  treatment; no new keyframe, no new duration.
- **Interruptible**: `AnimatePresence`/CSS `animate-in`/`animate-out` on a **mount/unmount**
  boundary (not a width transition) means opening panel B while panel A is closing is just two
  independent enter/exit animations on different elements — no additional wiring needed. If the
  discriminated-union state above causes an instant kind swap (`sources` → `document`) with no
  visible gap, that's `AnimatePresence mode="wait"` vs default `mode="sync"`; use the default
  (`sync`) so the swap feels like a cross-fade, not a flash of empty chrome — again, zero custom
  motion code, just the right `AnimatePresence` default.
- **Keyboard-triggered open must not animate**: when the document panel opens because the user
  typed a slash-command-equivalent or pressed a shortcut (not applicable here — the panel only
  opens via receipt click or the agent's own tool call surfacing it, both pointer/response-driven,
  never a raw keydown), this clause doesn't bite. Documented so a future keyboard shortcut for
  opening the panel remembers to skip the animation class conditionally.
- **`layoutId` continuity**: because `EssayDocumentSurface` carries the same
  `essay-document-${essayId}` `layoutId` the editor page and the library card use, opening the
  panel from a receipt **can** morph from nothing (first open — no source element in the DOM, so
  it just fades/slides in per above) but "Open in editor" (§7) *does* get a real shared-element
  transition into the full page, because both are mounted across the same `LayoutGroup` id
  (`WorkspaceOutlet.tsx:16`, `"counselle-workspace"`) — this is already the mechanism
  `WorkspaceOutlet` sets up for route transitions generally, so the panel and the editor page
  genuinely share one `layoutId` continuity without new plumbing.

### Deep-linking / URL state

- **The panel's open/closed state and which essay is open are not part of the URL.** The main
  chat route is `/app/ai/:sessionId` — adding `?doc=<essayId>` is tempting but the product spec
  says "closing it loses nothing; pending changes stay pending," i.e. this is explicitly a
  **transient UI affordance**, not a bookmarkable view. Keeping it in React state only (lifted to
  `AiChatPage`) avoids a URL param that would need to survive session switches, browser back, etc.
  for no product benefit. If "share a link that opens the doc panel" is ever requested, add the
  query param then — YAGNI today.
- **"Ask to open it" ("show me my Stanford essay")** is a backend/agent-side capability (the
  agent must decide to call some tool or emit some signal that names an essay) — **out of this
  plan's FE-only scope for the trigger itself**, but the FE contract is simple: whatever event
  shape the backend uses to say "open essay X" (most naturally, a `viz`-like typed block in the
  existing SSE protocol, or a new `ProtocolEvent` variant — that's a backend/Part 1 decision) maps
  to the same `openPanel({ kind: "document", essayId })` call the receipt-click path uses (§6).
  This plan defines the **one FE entry point** both triggers converge on; it does not invent the
  new backend event.

### Mobile behavior

Below `lg:` (matching `SourcesRail`'s own `md:flex` — but the document panel needs more room than
sources, so it degrades one breakpoint earlier at `lg:` per the width choice above), the document
panel does **not** dock beside the chat. It opens as a **full-screen `Sheet`** (the same
`components/ui/sheet.tsx` primitive `SourcesRail` already uses for its mobile case,
`SourcesRail.tsx:403-416`) — `side="right"`, `w-full max-w-full`. This reuses an existing,
already-accessible (Radix-based, focus-trapped, Escape-to-close) primitive rather than building a
bespoke mobile document view.

### Focus management

- **Opening the document panel (desktop, docked) does not steal focus.** Like the essay
  editor's own panel (Part 2 §5.3), this is a non-modal sibling panel, not a dialog — clicking
  the receipt door (§6) or the composer's "open essay" affordance leaves focus wherever the
  click happened; the composer is never force-focused.
- **Closing it returns focus to whatever opened it** — the receipt-door `<button>` (§6) if that
  was the trigger, or the panel's own close button's prior focus target otherwise. Track the
  triggering element the same way `SourcesRail`'s own open/close already must (verify its
  existing pattern before adding a new one — reuse, don't duplicate).
- **The mobile `Sheet` case (above) traps focus and restores it on close via Radix**, same as
  Part 2 §5.3's essay-panel Sheet and `SourcesRail`'s own existing mobile Sheet — no new
  focus-trap code, just the same Radix `Dialog` contract already relied on elsewhere in this
  app.
- **The essay chat panel (`EssayChatPanel`, §1) follows the identical rule** on the essay
  editor side: opening/collapsing it is non-modal (Part 2 §5.3 owns this in detail, since the
  toggle and collapse chrome live there); this plan's panel is the same kind of sibling
  element, not a dialog, so the same "don't steal focus, do restore it" contract applies
  without a separate implementation.

---

## 6. The mutation-receipt card as a door

Read: `MutationReceiptShell.tsx`, `EssayMutationWidget.tsx`, `EssayContentMutationWidget.tsx`,
`parseMutationReceipt.ts`. **Not redesigning the receipt system** — adding one affordance to the
existing shell.

### The exact change

`MutationReceiptShell` (`MutationReceiptShell.tsx:151-214`) gains a new optional prop,
`onOpenEssay?: (essayId: string) => void`, threaded from `MutationReceiptRenderer` →
`ChatMessage` → `AiChatPage` (`onOpenEssay={(essayId) => openPanel({ kind: "document", essayId })}`,
the exact wiring pattern `onOpenSources` already uses today — same prop-drilling depth, same
shape). The shell resolves whether a receipt is essay-openable itself, with no caller-side
family-switching needed:

```ts
function essayResourceRefOf(receipt: WorkspaceMutationReceipt): string | null {
  if (receipt.family !== "essay" && receipt.family !== "essay_content") return null;
  const { body } = receipt;
  if (body.kind === "update" || body.kind === "essay_edit" || body.kind === "essay_write") {
    return body.subject.resource_ref ?? null;
  }
  if (body.kind === "duplicate") return body.copy.resource_ref ?? null; // the new essay, not the source
  return null; // batch/state_transition/reorder receipts don't name one essay to jump to
}
```

This reuses `MutationSubject.resource_ref`, which — per §0 — is already parsed and already
carries the essay UUID; **zero backend change**.

### States and copy

The door affordance is **the existing glance line becoming clickable**, not a new element bolted
on — this is the smallest diff and matches "the existing mutation-receipt card becomes a door."

- **Proposed / in progress** (`running` — `step.status === "start"`): no door. The essay isn't
  necessarily in a stable state to open mid-edit-stream, and DESIGN.md's mutation-receipt rules
  don't show the disclosure trigger while running either (`MutationReceiptShell.tsx:193`,
  `{!running && expandable && ...}`) — the door follows the same `!running` gate.
  layer, not this hover state.
- **Success, N accepted / M rejected** (after the receipt settles, `outcome === "success"`): the
  glance line (currently a plain `<ToolBeatLabel>`, `MutationReceiptShell.tsx:184`) becomes a
  real `<button>` when `essayResourceRefOf(receipt)` is non-null, styled as inline text with the
  existing focus-ring rule (§11.4) — not a new button chrome, just `<button className="text-left
  underline-offset-2 hover:underline focus-visible:ring-2 ...">{glance}</button>` wrapping the
  same text `mutationGlanceText` already produces. Copy stays exactly what `mutationGlanceText`
  already generates (e.g. "Tightened the second paragraph" / "Drafted your Stanford essay") — this
  plan does not touch `mutation-format.ts`. The "N accepted / M rejected" tallying is **Part 2's
  concern** (it owns the suggestions/tracked-changes state that knows acceptance counts) — this
  door only opens the document; it does not render a review summary. If Part 2 wants the receipt
  itself to show live accept/reject counts as they happen in the panel, that's an enhancement atop
  this door, not required for it to function.
- **Failed/unknown** (`failed` in the shell's existing terminology): **no door.** An essay edit
  that failed shouldn't invite the student into a broken/partial document with a click that implies
  "see your edit" — the existing `immediateIssueText` block already surfaces the actionable issue
  outside the collapsed region (rule 38, "never hide an error behind a click"); adding a door on a
  failure would contradict that by implying success. Matches the `!failed` implicit gate other
  receipt affordances already follow.

### Copy for the affordance itself

No new copy needed beyond the existing glance text becoming a link — per DESIGN.md §13.4 ("say
the noun"), the glance line already names the essay action; turning it into a button doesn't
change what it says, only that it's now operable. `aria-label` on the button:
`"Open {essay title} — {glance text}"` when the title is available from `body.subject.title.text`,
falling back to the glance text alone if not (mirrors DESIGN.md's icon-only-control labeling rule,
§16.1).

---

## 7. Navigation between panel and full editor

- **"Open in editor"**: a small icon+label control (reuse `Button`, `variant="ghost"`, `size="sm"`
  — same shape as `EssayEditorHeader.tsx`'s existing header actions) in the document panel's own
  thin header, next to the close button. `onClick` navigates to `/app/essays/${essayId}` via
  `useNavigate()` — same call `EssayEditorPage`'s own back button already makes in reverse
  (`pages/essay-editor-page.tsx:60`, `onBack: () => void navigate("/app/essays")`).
- **Because both the panel's `EssayDocumentSurface` and the full editor page's
  `EssayDocumentSurface` share the same `layoutId`**, and both are rendered under
  `WorkspaceOutlet`'s single `LayoutGroup` (`"counselle-workspace"`), this navigation is a real
  shared-element transition — Motion resolves the `layoutId` match across the route change the
  same way `WorkspaceOutlet` already animates route swaps (`WorkspaceOutlet.tsx:17-36`), no new
  glue code. `transition={{ layout: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}` is already
  the value both `EssayEditorRoute.tsx:210-211` and `EssayDocumentPreview.tsx:28` use — reused
  verbatim inside `EssayDocumentSurface`, not re-authored a third time.
- **Returning preserves chat state**: this falls out of the URL/state design in §5 for free —
  the chat session (`/app/ai/:sessionId`) never navigated away; only the document panel's local
  `RightPanel` state existed transiently. Clicking a browser back button (or an in-app "back to
  chat" affordance the editor page could optionally add, though the spec doesn't require one — the
  existing sidebar nav already gets the student back to `/app/ai/:sessionId`) lands on the exact
  same chat, same scroll position (nothing in `useChatSession`/`useTurnEngine` was ever unmounted
  by opening the panel — it's a sibling element, not a route change).
- **"Closing it loses nothing; pending changes stay pending"**: because `EssayDocumentSurface`'s
  content/autosave wiring at the panel caller is the same `useEssayAutosave` hook the full editor
  uses (§4), any edit made in the panel autosaves to the essay itself (not to some panel-local
  draft) exactly like the editor page does today — closing the panel is just unmounting a
  component whose state already round-tripped through the same save path. "Pending changes stay
  pending" refers to Part 2's tracked-changes/suggestions (unaccepted AI edits) — those live in
  Part 2's own state (likely persisted essay-side, since they need to survive a panel close and
  reappear in the full editor per the "same tracked-changes" requirement) — not something this
  plan needs to re-solve, only not break by unmounting the panel.

---

## 8. Component inventory

| Component | Disposition |
|---|---|
| `AiChatPage` | **Reuse, extend** (`frontend/src/features/ai-chat/AiChatPage.tsx`) — new `variant`/`essayContext` props, `RightPanel` union replaces `sourcesPayload` |
| `ChatComposer` | **Reuse, extend** (`.../components/ChatComposer.tsx`) — new `hideResponseMode`, `selectionChip`, `onClearSelection` props |
| `ChatMessages`, `ChatMessage`, `AgentRunView`, `ToolBeat`, `VizBlock`, `MessageSources`, `CitationRenderer` | **Reuse unchanged** — verified to degrade at narrow widths (§1) |
| `SourcesRail` | **Reuse unchanged** as one arm of the new `RightPanel` union; its Tailwind/motion pattern is copied (not abstracted into a shared "right panel shell" — see below) for the document panel |
| `MutationReceiptShell`, `MutationReceiptRenderer` | **Reuse, extend** — new `onOpenEssay` prop and door affordance (§6) |
| `Button`, `Sheet`/`SheetContent`, `Collapsible` (ui primitives) | **Reuse unchanged** from `components/ui/` |
| `EssayDocumentSurface` | **Build new** (`frontend/src/features/essays/EssayDocumentSurface.tsx`) — justified in §4: no registry has an essay-specific paper+tracked-changes surface; it's Counselle's differentiating honesty/writing surface per AGENTS.md's registry-search rule, wrapping TipTap (already chosen, not a new dependency) |
| `EssayChatPanel` | **Build new** (`frontend/src/features/essays/EssayChatPanel.tsx`) — thin wrapper composing `AiChatPage` + quick-action chips + `useEssayChatSession`; not a registry component, it's pure composition of existing pieces |
| `EssayDocumentPanel` (main-chat right panel shell) | **Build new**, small (`frontend/src/features/ai-chat/components/EssayDocumentPanel.tsx`) — the `aside`/`Sheet` wrapper hosting `EssayDocumentSurface` in the main chat, mirroring `SourcesRail`'s own file shape (header + close button + responsive `Sheet` fallback) rather than trying to generalize `SourcesRail` into an abstract "right panel" component. **Rejected alternative**: extracting a shared `RightPanelShell` — considered, rejected because `SourcesRail`'s header (source count, no actions) and the document panel's header (title, "Open in editor," close) diverge enough that a shared abstraction would need two render-prop slots on day one, which is exactly the premature abstraction AGENTS.md warns against for a two-user case. Revisit only if a third right panel shows up. |
| `useEssayChatSession` | **Build new**, small hook (`frontend/src/features/essays/useEssayChatSession.ts`) — per C6, a thin client of `POST /v1/essays/{essayId}/session` (Part 1 §7.2), no localStorage |

---

## 9. Files created/modified, in build order

1. `frontend/src/api/chat/types.ts` — add `essayContext` to `SendMessageInput` and
   `createSession` input (§2). *(Depends on backend wire support landing; FE type addition can
   land ahead of it as dead-until-wired, same as any additive optional field.)*
2. `frontend/src/api/chat/transport.ts` — serialize `essayContext` to snake_case in
   `createSession`/`sendMessage` (§2).
3. `frontend/src/features/ai-chat/useTurnEngine.ts` — thread `essayContext` through
   `SubmitMessageOptions` → `runTurn` → `transport.sendMessage`/`createSession` (§2).
4. `frontend/src/features/ai-chat/components/ChatComposer.tsx` — `hideResponseMode`,
   `selectionChip`, `onClearSelection` props (§1, §3).
5. `frontend/src/features/ai-chat/components/mutation-receipts/MutationReceiptShell.tsx` —
   `onOpenEssay` prop, `essayResourceRefOf`, button-ify the glance line (§6).
6. `frontend/src/features/ai-chat/components/mutation-receipts/MutationReceiptRenderer.tsx` —
   forward `onOpenEssay` (§6).
7. `frontend/src/features/ai-chat/components/ToolWidgets.tsx`, `ChatMessage.tsx`,
   `ChatMessages.tsx` — thread `onOpenEssay` prop down to the renderer (mirrors existing
   `onOpenSources` threading, same files, same depth).
8. `frontend/src/features/ai-chat/components/EssayDocumentPanel.tsx` — **new**, the right-panel
   shell (§5, §8).
9. `frontend/src/features/essays/EssayDocumentSurface.tsx` — **new**, the shared document
   component (§4) — depends on Part 2's tracked-changes extension existing to fully wire the
   suggestions slot, but can be scaffolded (paper + editor, no suggestions) ahead of Part 2 landing.
10. `frontend/src/features/essays/EssayEditorRoute.tsx` — replace inline paper block with
    `<EssayDocumentSurface density="editor" .../>` (§4).
11. `frontend/src/features/ai-chat/AiChatPage.tsx` — `variant`/`essayContext` props,
    `RightPanel` union replacing `sourcesPayload`, render `EssayDocumentPanel` (§1, §5).
12. `frontend/src/features/essays/useEssayChatSession.ts` — **new** (§3).
13. `frontend/src/features/essays/EssayChatPanel.tsx` — **new**, the essay-editor-side panel
    wrapper + quick-action chips + opening-line copy (§1, §3).
14. `frontend/src/features/essays/EssayEditorRoute.tsx` (second pass) — mount `EssayChatPanel`
    beside `EssayDocumentSurface` inside the editor page's layout (this plan doesn't specify the
    editor page's own panel-toggle chrome beyond "it's there," since the essay editor's existing
    header/toolbar structure — `EssayEditorHeader.tsx`, `EssayEditorToolbar.tsx` — already has a
    documented priority-drop pattern for adding one more header control, per DESIGN.md §9.3's
    worked example).

---

## 10. Tests worth writing

Per AGENTS.md's no-reflexive-tests rule — only what earns its place:

- **`essayResourceRefOf` (§6)** — pure function, easy to get subtly wrong (duplicate's `copy` vs
  `source`, batch/reorder correctly returning `null`). Unit test, mirrors the existing
  `parseMutationReceipt.test.ts` style.
- **The `RightPanel` mutual-exclusivity reducer logic** in `AiChatPage` (opening sources closes
  the document panel and vice versa) — small, easy to silently break in a later edit, worth a
  focused test the way `stream-reconcile.test.ts`/`turn-reducer.test.ts` already test similarly
  small pure-logic slices of this same feature.
- **`useEssayChatSession`'s get-or-create call** (calls `POST /v1/essays/{essayId}/session`
  exactly once per mount, surfaces the returned `session_id` to `AiChatPage`, and doesn't
  re-fetch on every re-render) — small hook, easy to get the effect dependencies or
  request-dedup wrong; matches the existing test-worthiness bar `useChatSession.test.tsx`
  already sets for session-adjacent hooks in this exact file family.
- **Do not** write reflexive render tests for `EssayDocumentPanel`, `EssayChatPanel`, or the
  quick-action chips — they're composition/copy, not logic; per DESIGN.md §18 and AGENTS.md, that
  earns nothing.
- **Do** extend `ChatMessage.test.tsx` (already being touched per the current git status) if the
  `onOpenEssay` wiring changes that file's props in a way its existing tests assert on — check
  when implementing, don't add a new test file speculatively.

---

## 11. Risks

1. **Wire dependency on Part 1's backend surface flag.** §2's `essayContext` field is inert until
   a backend counterpart reads it. If Part 1 lands a different field name/shape, this plan's
   `transport.ts` serialization is a one-file fix — isolated by design (the same reason
   `sourceConfig`'s wire mapping lives in one `toWireSourceConfig` function).
2. **The "ask to open it" trigger (§5) is genuinely unspecified** until Part 1/backend decides how
   the agent signals "open essay X" over SSE. This plan defines the FE landing point
   (`openPanel({ kind: "document", essayId })`) but not the event. Risk: if the backend event
   shape requires new `ProtocolEvent` handling in `turn-reducer.ts`/`stream-reconcile.ts`, those
   are **shared-chat-behavior files** — touching them for essay-panel purposes must not change
   how the workspace chat processes events for non-essay turns. Mitigation: whatever new event
   variant is added must be additive to the `ProtocolEvent` union and ignored (no-op) by every
   existing reducer branch, the same discipline `meta`/`clarify_response` handling already follows.
3. **`EssayDocumentSurface` scaffolding ahead of Part 2.** Building the component shell (§4, §9
   step 9) before Part 2's tracked-changes extension lands means an interim version with no
   suggestions layer. Risk is low (additive slot) but the *editor page* migration (step 10) should
   not land until Part 2's extension is at least stubbed, so the full editor page never regresses
   behavior mid-migration.
4. **Right-panel mutual exclusivity (§5) is a product decision this plan makes, not one the user
   explicitly locked.** If it's wrong, the fix is contained to the `RightPanel` union and its two
   call sites (`openSources`, `onOpenEssay`) — not a structural risk, but worth flagging as an
   assumption, not a requirement, before implementation starts.
5. **Nothing in this plan touches `app/`, `domain/`, or any backend tool/prompt file** — confirmed
   by construction (every file in §9 is under `frontend/src/`). The one adjacent risk is if a
   future implementer, wiring up §2's `essayContext`, is tempted to also add essay-awareness to
   the agent's system prompt "while they're in there" — that would violate the hard constraint.
   Flagging explicitly so whoever implements this reads it.
