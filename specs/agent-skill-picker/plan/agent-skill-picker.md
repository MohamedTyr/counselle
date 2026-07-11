# Plan: Explicit Skill Invocation from the AI Composer

Status: Draft for review
Date: 2026-07-11

## Goal

Let a student explicitly invoke one or more user-facing Counselle skills from
either AI composer by typing `@`, searching the skill catalog, and selecting a
result with the keyboard or pointer. Selection must be deterministic: the
backend, not the model, validates and loads the selected skill instructions for
that turn.

This is a small full-stack feature, not a new skill system. `skills/*/SKILL.md`
remains canonical (ADR 0010), `app/skills.py` remains the loader, and the
existing `load_skill` tool remains available for model-selected progressive
disclosure. This feature adds an explicit student-selected path through those
same seams.

## Success criteria

- Typing `@` at the start of a composer token opens a searchable skill list.
- Typing filters the list without moving focus out of the textarea.
- Arrow keys move the active result; Enter selects; Escape closes; IME input is
  never intercepted.
- A selected skill becomes a removable chip in the composer. The trigger text
  is removed and the caret is restored where the trigger began.
- The same behavior exists on the home composer and in-session composer.
- Only explicitly user-facing skills appear. Internal honesty skills remain
  available to the agent but are not presented as student actions.
- The message request carries canonical skill names separately from `text`.
- The API rejects unknown, duplicate, hidden, or excessive selections before
  claiming a turn or mutating session/title/source-config state. As with other
  invalid message bodies today, the route-level rate limiter has already spent
  the caller's attempt; changing that global ordering is outside this feature.
- The agent deterministically receives the selected skill bodies for that turn.
- The clean student text remains the transcript/title/history text. No sentinel
  syntax or hidden instruction is inserted into it.
- Selected skills survive transcript reload, retry, regeneration/history
  replacement, and the home-to-session handoff.
- Existing clients remain valid when `skills` is omitted.

## Current state (verified 2026-07-11)

- The two composer implementations are
  `frontend/src/features/ai-composer/AiComposer.tsx` (home) and
  `frontend/src/features/ai-chat/components/ChatComposer.tsx` (session).
  Both are controlled textareas with Enter-to-send and the same visual shell,
  but their submit callback signatures differ.
- `frontend/src/components/ui/command.tsx` provides the installed `cmdk` visual
  vocabulary. Its own search input is not the correct interaction seam here:
  focus must remain in the composer textarea while the active `@query` filters
  results.
- `GET /v1/config` already carries composer boot data and is cached under
  `["chat", "config"]` on the home route. It is the smallest catalog delivery
  surface; no second skills endpoint is needed.
- `app/skills.py` discovers `skills/*/SKILL.md`, parses frontmatter, caches
  metadata, and loads bodies. The current minimal parser accepts scalar
  `key: value` fields only.
- Four skills ship today. `dossier-assembly` and `school-comparison` are useful
  student actions; `decode-coded-value` and `citation-and-recency` are internal
  honesty workflows and should not be exposed in the picker.
- `POST /v1/sessions/{id}/messages` validates `MessageBody`, then claims the
  detached turn through `TurnRegistry.start`. The registry passes text and
  source config into `run_turn`, which builds the LangGraph input.
- `app/records.py` writes one self-contained record per assistant turn;
  `app/transcript.py` derives the user and assistant transcript entries from
  that record. This is the correct persistence surface for selected skill
  names.
- The agent currently exposes `load_skill(name)` as a normal tool and builds
  the per-turn instructions in `app/agent_node.py` through
  `build_system_prompt(...)`.

## Binding design decisions

1. **Structured selection, never prompt syntax.** The wire field is
   `skills: string[]`; raw `@name` is not sent as student prose and no hidden
   marker is embedded in `text`. This makes activation deterministic and keeps
   titles, history, steering, citations, and transcript text clean.
2. **SKILL.md remains the source of truth.** Add optional scalar frontmatter
   fields `user_invokable`, `display_name`, and `user_description`. The API
   derives the catalog from `load_all_skill_meta()`; the frontend has no
   hardcoded skill list.
3. **Opt-in visibility.** Only `user_invokable: true` entries appear and may be
   explicitly requested. Missing/false means internal. Mark
   `dossier-assembly` and `school-comparison` true initially; leave the two
   honesty skills internal.
4. **One selected-skill type at every boundary.** Canonical identity is the
   existing `name` slug. Presentation fields never come back on message sends.
5. **Up to three skills per turn.** Define one backend constant
   `MAX_SELECTED_SKILLS = 3` next to validation in `app/skills.py`; expose that
   limit in config so the frontend can prevent a fourth selection without
   duplicating a magic value. Three keeps prompt growth bounded while allowing
   legitimate combinations. Apply selected workflows in user selection order;
   the base counselor, honesty, authz, read-only, and tool-mounting rules always
   win if workflows conflict. No settings/env knob until the limit needs tuning.
   Count is not the prompt-size guard: public skill bodies must also be at most
   `MAX_PUBLIC_SKILL_BODY_CHARS = 12_000` each and selected bodies at most
   `MAX_SELECTED_SKILL_BODY_CHARS = 24_000` in aggregate. Validate both without
   truncation. These ceilings comfortably cover today's ~5.5K-character files
   and are code invariants, not user-tunable product settings.
6. **Deterministic preload, scoped to one turn.** Before constructing the
   PydanticAI agent, validate the selected names and append a clearly delimited
   server-owned block containing each selected skill body to that turn's
   instructions. The model need not call `load_skill` for a selected skill;
   model-selected skills continue using the tool.
7. **Do not mutate the base prompt builder.** `build_system_prompt` remains the
   stable global prompt. Add a small pure renderer in `app/skills.py` (or a
   focused sibling if the file would exceed its limit) and concatenate its
   result in `agent_node.py`. Selected skill content is trusted repository
   content, not user input. A fixed server-owned preamble states that workflows
   cannot override system instructions, authz/tool mounting, read-only
   constraints, citations, or value-reading rules.
8. **Persist names on the turn record.** Add `skills: list[str]` to the record
   and to the corresponding user transcript entry. This preserves the exact
   invocation for reload and regeneration/history replacement without changing the serialized
   model message.
9. **Regeneration reuses the original invocation by default.** The frontend
   passes the parent user message's stored `skills` with
   `replace_message_id`. A normal new send uses the composer chips. No implicit
   carry-over to later turns.
10. **Clarify and steering do not invoke new skills in v1.** The picker is
    disabled while the composer is answering an active clarify prompt or while
    a turn is streaming. `/steer` stays text-only. This avoids attaching a new
    workflow halfway through an existing run. A parked clarify-answer request
    with a non-empty `skills` list is rejected with the same generic safe 422;
    an empty list inherits the parked turn's original skills for continuation.
    Revisit only if a real use case appears.
11. **Selection produces chips, not literal text mentions.** When a result is
    selected, remove the active `@query`, add a chip above the textarea, restore
    the caret, and keep typing. A skill alone cannot send; the student still
    supplies the task.
12. **The textarea owns search.** A valid trigger is `@` at index 0 or preceded
    by whitespace. The query runs from `@` to the caret and contains slug-like
    characters only. This avoids emails. Paste may open the picker, but only an
    explicit result selection activates a skill.
13. **Popover, not modal.** Desktop and mobile use one portal-backed surface
    positioned above the composer, width clamped to the composer/viewport and
    height capped so the textarea and software keyboard remain usable.
14. **One immutable registry snapshot.** Discovery produces one process-lifetime
    registry keyed by canonical name and containing validated metadata, resolved
    trusted path, and body. Catalog output, request authorization, normal
    `load_skill`, and selected-skill rendering all derive from it. Duplicate
    names fail startup; there is no independent rescan that could authorize one
    file and load another.
15. **Per-turn ownership has three explicit homes.** `_Turn.selected_skills` is
    the immutable in-flight source (including partial terminal persistence;
    an in-process tuple is allowed here),
    `turn_ids["selected_skills"]` is the checkpointed current-invocation
    transport into `agent_node`, and the completed turn record is the durable
    source. Do not add a redundant top-level graph-state key or session column.
16. **No new ADR.** This extends ADR 0010 through the existing API-first and
    turn-record seams. Update living architecture docs when implementation
    lands; do not retro-edit shipped plan narratives or wire contracts.

## Wire contract

### `GET /v1/config` additive response

```json
{
  "skills": [
    {
      "name": "school-comparison",
      "display_name": "School comparison",
      "description": "Compare 2–6 schools across cost, admissions, outcomes, and fit."
    }
  ],
  "max_selected_skills": 3
}
```

Rules:

- Preserve the existing greeting, season note, starters, and source config.
- Sort by canonical `name` for deterministic output.
- Return only user-invokable entries.
- Eagerly validate the registry during application lifespan startup.
  `display_name` and `user_description` are required when
  `user_invokable: true`; accept only literal lowercase `true`/`false`; validate
  canonical slug grammar, bounded single-line/control-free display copy, body
  ceilings, unique names, and `name == parent directory`. Resolve every path,
  require a regular file beneath resolved `_SKILLS_ROOT`, and reject symlink
  escape. Malformed public metadata or duplicate names fails startup rather
  than first failing `/config`; unreadable/malformed internal files retain the
  existing skip-and-log resilience where they do not create ambiguity.

### `POST /v1/sessions/{id}/messages` additive request

```json
{
  "text": "Compare Duke and Northwestern for financial aid",
  "skills": ["school-comparison"],
  "source_config": { "web": true, "edu": true, "reddit": false }
}
```

- `skills` uses `Field(default_factory=list)` for backward compatibility, with
  schema-level maximum items and strict per-item slug/length constraints before
  repository validation. Do not trim or lowercase client input.
- Reject more than `MAX_SELECTED_SKILLS`, duplicates, unknown names, or skills
  without `user_invokable: true` with one generic safe 422 message that does
  not reveal whether a hidden/internal name exists. Log the canonical reason
  without paths or bodies.
- Validate before `TurnRegistry.start`, history rewrite, source-config
  persistence, title persistence, or model work. The existing route-level
  message limiter runs first and continues to count invalid requests; pin this
  ordering in a test rather than silently refactoring global rate-limit policy.
- Keep `CreateSessionBody` unchanged. A home selection belongs to the first
  message, not to the session.

### Transcript addition

Record-backed user entries may add:

```json
{
  "role": "user",
  "text": "Compare Duke and Northwestern for financial aid",
  "skills": ["school-comparison"]
}
```

Older records and clients omit/ignore the field. Synthesized clarify-answer
entries do not inherit it; the original question entry carries the parked
turn's skill list.

## Frontend interaction specification

### Trigger and filtering

- Valid active token: `(^|\s)@([A-Za-z0-9-]*)$` over the substring ending at the
  current caret. Text after the caret is preserved.
- Match case-insensitively against name, display name, and description.
- Rank prefix matches on name/display name before substring description
  matches; preserve server order within a rank. The catalog is tiny, so use a
  clear pure filter rather than adding fuzzy-search machinery.
- Do not open while disabled, submitting, awaiting clarify, or composing IME.
- The optional `@` toolbar button inserts `@` at the caret and opens the same
  flow. Tooltip/accessible label: `Add a skill (@)`.

### Keyboard and focus

- Focus never leaves the textarea when opened by typing.
- `ArrowDown`/`ArrowUp`: cycle active options and call `scrollIntoView` only
  when needed.
- `Enter`: while open and a result is active, select it and do not send.
- `Tab`: close the picker and preserve normal focus traversal. Enter is the sole
  keyboard selection action.
- `Escape`: close and leave the typed token untouched.
- `Shift+Enter`: always inserts a newline; it never selects or sends.
- IME `compositionstart` through `compositionend` suppresses picker keyboard
  handling and send handling.
- After pointer selection, refocus the textarea and restore the computed caret.

### Visual structure

- Portal-backed listbox aligned to the composer start edge, opening above it.
- Width: `min(30rem, calc(100vw - 2rem))`; never wider than its composer.
- Maximum list height around 18rem; no nested page scroll.
- Row: display name, one-line student description, subdued `@slug`; use the
  current Geist type and semantic workspace tokens.
- Active row uses the existing muted/active surface and visible foreground,
  not a new brand color. Use one border and a tight shadow (if needed), not the
  banned border-plus-wide-shadow pattern.
- Selected skills render as compact removable chips in a tray above the
  textarea. Removal buttons meet the 44px hit area via padding/hit area even if
  the visible icon is smaller.
- Desktop footer shows `↑↓ Navigate · Enter Select · Esc Close`; omit it on
  touch/mobile.
- Empty state: `No skills match “{query}”.` No fabricated “create skill” action.
- Open/close transition: 150–180ms opacity + small translate, ease-out; reduced
  motion uses an instant/crossfade alternative.

### Accessibility

- Textarea: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`,
  `aria-controls`, and `aria-activedescendant` while open.
- Popup: named `listbox`; each result is an `option` with stable id and
  `aria-selected`.
- Announce result count and selection/removal through one polite live region.
- Result rows are non-focusable `role="option"` elements controlled by the
  textarea's active descendant. Pointer-down prevents default focus transfer,
  selects, then preserves the textarea selection. The toolbar trigger and chip
  removers are real buttons with explicit accessible names.
- Announce opening/result-count changes plus successful selection, removal, and
  limit errors; do not duplicate every arrow movement in the live region.
- Maintain WCAG AA foreground/selected/placeholder contrast and verify at 200%
  zoom, 375px width, and reduced motion.

## Implementation phases

### Phase 1 — Skill metadata and validation core

Files:

- `skills/dossier-assembly/SKILL.md`
- `skills/school-comparison/SKILL.md`
- `app/skills.py`
- `tests/app/test_skills.py`

Work:

1. Extend parsed metadata with the three optional presentation fields.
2. Add a typed immutable registry entry (Pydantic model or frozen
   dataclass; choose the existing module's smallest fit) rather than passing
   expanding untyped dicts through new code.
3. Build one eager immutable snapshot and add `user_skill_catalog()`,
   `validate_selected_skills(names)`, and
   `render_selected_skills(names)` over the same cached discovery result.
4. Validation returns canonical names in input order and rejects duplicates,
   hidden/unknown skills, or excess count. Do not partially accept.
5. Rendering strict-loads bodies from the exact validated registry entries,
   checks the aggregate ceiling, and places each body under an unambiguous repository-owned heading
   and instructs the model that these workflows were explicitly selected for
   this turn. Include the fixed precedence statement. Do not interpolate display
   copy or user text, and never inject `load_skill()`'s friendly not-found
   string as instructions.
6. Add student-facing metadata to the two initial public skills.

Tests earn their place here because this is the authority boundary: catalog
visibility, malformed public metadata, duplicate names, symlink escape,
duplicate/hidden/unknown request rejection, count/body enforcement, ordering,
and exact metadata-to-body binding.

### Phase 2 — API and turn plumbing

Files expected to change:

- `api/routes/config.py`
- `api/routes/sessions.py`
- `app/turns.py`
- `app/run_turn.py`
- `app/state.py`
- `app/agent_node.py`
- `app/records.py`
- `app/transcript.py`
- relevant tests under `tests/api/` and `tests/app/`

Work:

1. Add catalog and max selection count to `/config`.
2. Add `skills: list[str] = Field(default_factory=list)` to `MessageBody` with
   strict item/list bounds; validate through the core
   function at the route boundary, then capture the canonical names as an
   immutable tuple on the process-local `_Turn` only.
3. Extend the detached `_Turn` with an immutable tuple of canonical names at
   claim time. Thread
   them through `TurnRegistry.start` -> `_Turn` -> `_drive` -> `run_turn`.
4. Put `selected_skills` in `turn_ids` for every graph invocation, always as a
   fresh msgpack/JSON-plain list, including an explicit empty list for an
   ordinary unskilled turn. Records also store fresh lists; tuples never enter
   checkpoint state. Do not create a top-level graph-state field. In the atomic
   history-rewrite update, replace/clear the nested `turn_ids` value itself
   (for example `turn_ids=None`), never write a nonexistent top-level
   `selected_skills` key, before preparing the replacement invocation.
5. Parked-record skills are authoritative for clarify continuation. If an
   answer request supplies a non-empty list, reject it while the registry claim
   is held, release the claim, and return the generic safe 422. For a normal
   empty answer, copy the parked names into the resumed
   `turn_ids`, and extend `_partial_anchor` (or its replacement) to return those
   names so cancel/timeout/shutdown during resume cannot erase them.
6. In `run_agent_node`, validate `turn_ids` defensively and append the rendered
   selected-skill block to the per-turn instructions before `Agent(...)`.
7. Add an explicit `selected_skills` parameter to `build_turn_record` and
   `build_terminal_update`. Pass names from the correct local owner into every
   persisted path: complete,
   awaiting-input, cancel, timeout, error, and pre-stream failure. Default to
   `[]` for legacy callers/records.
   Complete uses validated current `turn_ids`; run-turn awaiting/error uses its
   resolved effective selection; registry partial persistence uses `_Turn` or
   parked-record names. Preserve the existing pre-meta ghost-turn rule: a path
   that writes no record has nothing to preserve.
8. Emit the names on the record-backed original user transcript entry. Do not
   add them to assistant entries or synthesized clarify answers.
9. Ensure history rewrite replaces the old record with the new turn's supplied
   list and does not leave stale names behind.

Tests:

- Config exposes only public metadata and the limit.
- Omitted `skills` remains valid.
- Invalid requests return the generic 422 before registry claim/history
  rewrite/config/title writes and retain existing rate-limit accounting.
- Selected bodies appear in agent instructions once and clean text remains the
  model user prompt.
- Selected turn followed by unselected turn proves no checkpoint leakage.
- Complete/error/cancel/timeout/clarify records preserve names; successful,
  failed, cancelled, and timed-out clarify resumes retain parked names.
- Transcript round-trip and regeneration/history replacement preserve the contract.
- History-rewrite preparation failure leaves no deleted turn selection active.
- Unknown names in restored graph state fail safely rather than loading paths
  supplied by a client.

### Phase 3 — Shared frontend domain and picker

New focused files:

- `frontend/src/features/skill-picker/types.ts`
- `frontend/src/features/skill-picker/skill-query.ts`
- `frontend/src/features/skill-picker/useSkillPicker.ts`
- `frontend/src/features/skill-picker/SkillPicker.tsx`
- `frontend/src/features/skill-picker/SelectedSkillChips.tsx`

Existing files:

- `frontend/src/api/chat/types.ts`
- `frontend/src/api/chat/transport.ts`
- `frontend/src/api/chat/config.ts`
- `frontend/src/api/chat/config.test.ts`
- `frontend/src/components/ui/command.tsx` only if a genuinely reusable primitive
  needs an additive API; do not distort the global command component for this.

Work:

0. From `frontend/`, follow the mandatory registry search order: shadcn MCP
   with COSS first, then `@ai-elements`, then `@shadcn`, and compare optional
   21st.dev Magic results if available. Record the choice in implementation
   notes. The expected result is likely reuse of the installed Base UI Popover
   plus a small domain-specific combobox/listbox because focus must remain in
   the textarea, but that conclusion must follow the search.
1. Add wire/domain types and parse the additive config fields defensively.
   A malformed/missing catalog degrades to an empty picker; messaging remains
   usable.
2. Add selected skill names to `SendMessageInput` and the transport request.
3. Build pure trigger detection, ranked filtering, and token-removal helpers.
4. Build a controlled hook accepting text, textarea ref, catalog, selected
   names, and setters. Keep DOM positioning/rendering out of the pure helpers.
   Recompute the active token on value changes and textarea `onSelect` so mouse,
   touch, Home/End, and programmatic caret movement cannot leave stale state.
5. Build the listbox and chip tray with the existing Base UI Popover primitive,
   an explicit composer/textarea anchor, `side="top"`, collision constraints,
   and auto-focus prevention. Reuse existing tokens/icons; do not hand-roll
   fixed positioning, modify `command.tsx`, or add a dependency unless the
   installed primitive demonstrably fails.
6. Avoid list virtualization: the curated catalog is intentionally small.

Focused tests:

- Trigger boundary/email/caret/mid-text and uppercase-query cases.
- Filter ranking and no-results behavior.
- Keyboard selection versus send, Escape, Shift+Enter, IME, and pointer focus
  restoration.
- Caret repositioning into/out of current and earlier `@tokens`.
- Toolbar insertion at a middle selection: preserve text on both sides, place
  the caret after `@`, retain focus/software keyboard, and replace rather than
  duplicate an already-active query.
- Duplicate selection and max-limit behavior.
- Chip removal and accessible combobox/listbox attributes.

### Phase 4 — Integrate both composers and lifecycle behavior

Files expected to change:

- `frontend/src/features/ai-composer/AiComposer.tsx`
- `frontend/src/features/ai-composer/AiComposerRoute.tsx`
- `frontend/src/features/ai-composer/useComposerStartTurn.ts`
- `frontend/src/features/ai-chat/components/ChatComposer.tsx`
- `frontend/src/features/ai-chat/AiChatPage.tsx`
- `frontend/src/features/ai-chat/AiChatRoute.tsx`
- `frontend/src/features/ai-chat/AiChatRoute.test.tsx`
- `frontend/src/features/ai-chat/useTurnEngine.ts`
- `frontend/src/features/ai-chat/model.ts`
- `frontend/src/features/ai-chat/components/ChatMessage.tsx`
- `frontend/src/features/ai-chat/components/ChatMessage.test.tsx`
- `frontend/src/features/ai-chat/components/ChatMessages.tsx`
- `frontend/src/features/ai-chat/components/ChatMessages.test.tsx`
- existing colocated tests

Work:

1. Make both composers accept `skills`, `selectedSkills`, and
   `onSelectedSkillsChange` through the same shared picker API.
2. Add a shared cached `useChatConfig` query used by home and in-session routes;
   a direct reload of `/app/ai/:sessionId` must receive the catalog without
   visiting home. Catalog failure never blocks messaging: hide/disable the `@`
   trigger, and typed `@` remains ordinary text rather than opening an empty
   picker.
3. Home route uses the config query. On successful start, carry one atomically
   parsed `InitialTurn { text, skills }` in router state; do not clear either
   until session creation succeeds.
4. Extend the pending-route/location-state handoff so the first message sends
   the selection exactly once. Clear router state after consumption as today.
   Malformed state degrades safely. If the first POST fails after state is
   consumed, restore both into the local composer.
5. Session submit snapshots text + skills together. Enumerate and update every
   engine carrier: `submitMessage`, `startSend`, `runTurn`, `PendingSend`,
   optimistic `userMessage`, conflict cancel-and-retry, `retryLastSend`,
   regeneration, and initial-turn handoff. Clear both optimistically;
   restore both on failed send. Pending/retry state stores both.
6. Optimistic user messages carry selected names so chips render immediately.
   Reconcile with transcript data on reload.
7. Add `skills` to `UserChatMessage`, transcript mapping, and user-message
   rendering. Historical chips are compact and non-interactive, with a
   humanized-slug fallback if a persisted skill no longer exists in the current
   catalog. Pass a catalog-backed label resolver through
   `AiChatPage -> ChatMessages -> ChatMessage`; do not make leaf components
   fetch config.
8. Regenerate passes the parent user message's names. If editing UI later allows
   changing skills, the same structured field is already available.
9. Clear composer selections after a successful accepted send; never carry
   them to the next turn.
10. Split the page handlers explicitly. `handleComposerSubmit(text)` snapshots
    and clears composer text + skills. `handleClarifyAnswer(text)` calls
    `submitMessage(text, [])` without reading or clearing unrelated composer
    draft state.
11. Enforce no mid-run skill injection in the engine, not only the UI. Live
    `/steer`, auto-forwarded/injected messages, and clarify answers always use
    `[]`. If a stale caller attempts to steer with selected skills, reject and
    restore the snapshot rather than silently stripping it. An unrelated draft
    selection may remain visible/disabled while attached to another active
    turn; clarify submission does not consume it. Session remount clears it.
12. Centralize IME composition handling in the shared hook or give both
    composers equivalent handlers; the home composer currently lacks the
    session composer's guard.

Integration tests:

- Home selection reaches first POST after session creation.
- In-session selection reaches transport and clears on accepted send.
- Failed create/send restores text and chips.
- Ordinary retry, 409 conflict cancel-and-retry, and regenerate reuse the
  correct names.
- Streaming steer/auto-forward/clarify cannot carry skills.
- Submitting a clarify answer while unrelated draft text/chips exist preserves
  that draft and sends no new skills.
- Reload maps transcript names onto user messages.
- Direct session-route reload fetches a usable catalog.
- Both composer variants preserve existing source-toggle and Enter behavior.

### Phase 5 — Visual and behavioral verification

1. Run frontend typecheck and focused tests, then the full frontend suite.
2. Run backend focused tests, routine non-live suite, Ruff, and mypy.
3. Exercise with browser automation at 375, 768, 1024, and 1440 widths:
   keyboard-only, pointer, long descriptions, no results, max selections,
   scroll, zoom, reduced motion, and a mobile viewport with the keyboard-sized
   vertical constraint represented. Include one real mobile-browser/manual pass
   to confirm opening the picker preserves the software keyboard; if custom
   `visualViewport` logic becomes necessary, test it directly.
4. Verify the portaled popup is not clipped by the composer `overflow-hidden`
   shell and stays above sticky chat content/source rail.
5. Verify contrast and focus visibility in the active dark design system.
6. Verify 200% zoom/text scaling with three long skill chips, wrapped source
   controls, and expanded Reddit controls: no horizontal scroll or hidden
   send/stop action.
7. Run one targeted live-agent smoke test (not a broad eval): explicitly select
   `school-comparison`, ask for a two-school comparison, and confirm the skill
   is preloaded and followed correctly. Do not require absence of a redundant
   `load_skill` tool call; avoiding dynamic tool hiding is simpler and safer.
   This is the only paid/live check the feature needs.
8. Update living `docs/ARCHITECTURE.md` §15 to describe explicit invocation,
   public metadata, and record persistence. Do not edit the shipped MVP2 wire
   contract or other historical specs.
   Keep this draft in `plans/` until implementation is shipped and verified.

## Failure and edge-case matrix

| Case | Required behavior |
|---|---|
| `hello@example.com` | No picker |
| `@` or `compare @sch` at caret | Picker opens and filters |
| Caret moves away from token | Picker closes without text mutation |
| Escape | Close; preserve typed `@query` |
| Enter with active result | Select; do not send |
| Enter with no result | No-op; do not accidentally submit the unresolved trigger |
| Shift+Enter | Newline |
| IME composition | No selection/send interception |
| Skill already selected | Row shows selected and cannot duplicate |
| Fourth skill | Prevent selection and announce the three-skill limit |
| Catalog/config failure | Composer works; picker unavailable |
| Invalid/tampered name | Safe 422; no turn claim or prompt loading |
| Send failure | Restore exact text and selected chips |
| Reload | User bubble retains invoked-skill chips |
| Regenerate | Reuse original user bubble's skill list |
| Clarify answer with `skills: []` | Continue with parked original list; unrelated composer draft remains intact |
| Clarify answer with non-empty skills | Generic safe 422; no silent stripping or replacement |
| Clarify resume cancel/timeout | Replaced parked record retains its original list |
| Cancel/error/timeout | Turn record retains selected list |
| Old record/client | Missing field behaves as `[]` |

## Security and honesty review checklist

- Names are allowlisted against repository metadata; no filesystem path comes
  from the client.
- Duplicate names fail startup; authorization and body loading use the same
  immutable entry, and resolved files cannot escape `_SKILLS_ROOT`.
- Skill bodies are read only through existing loader paths.
- User text and selected names never share an interpolation channel.
- Hidden/internal skills cannot be invoked by guessing their names through the
  public request.
- Error responses do not expose filesystem paths or skill bodies.
- No selected skill can weaken authz: workspace tools remain server-mounted by
  authenticated `user_id`, independent of prompt instructions.
- Prompt/token growth is bounded by the selection limit and existing agent
  total-token limits plus explicit per-skill and aggregate body ceilings.
- Skills remain workflow guidance; all data values still flow through typed
  tools, normalization, and citations.

## Explicit non-goals

- Creating, installing, editing, or enabling skills from the UI.
- Fuzzy marketplace search, categories, favorites, recents, or analytics.
- Session-wide sticky skills or automatic carry-over.
- Mid-run skill injection through `/steer`.
- Changing the existing automatic `load_skill` behavior.
- Rich-text contenteditable or literal inline mention rendering inside the
  textarea.
- A new database table or migration.
- A new endpoint when `/v1/config` already owns composer boot metadata.

## Delivery gate

The implementation is done only when the shared picker works identically in
both composers, the backend deterministically preloads only validated public
skills, every terminal record path preserves the selection, clean transcript
text is unchanged, routine checks pass, and the responsive/accessibility
browser pass finds no keyboard, focus, clipping, contrast, or reduced-motion
regression.
