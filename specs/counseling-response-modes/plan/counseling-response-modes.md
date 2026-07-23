# Counseling Response Modes — Skills-Backed Composer Plan

Status: **implemented and graduated to specs**.

As-built note (2026-07-22): phases 1–8 were implemented on
`feat/counseling-response-modes`. Deterministic backend/frontend suites, a
mocked real-browser UX pass, and the three focused live LLM behavior eval cases
are complete. The full three-case eval command had one transient upstream
Google/HTTP stream failure during verification, but each Focused, Deep, and
Guided case subsequently passed live. Owner acceptance of real interactions
remains the final human sign-off gate.

Acceptance-polish note (2026-07-23): during owner review, the open menu was
changed from larger two-line descriptive rows with a check indicator to compact
one-line rows matching the adjacent Sources menu chrome. The descriptions
remain in the `/v1/config` catalog for metadata and future surfaces, but they
are not rendered in the composer mode menu.

This plan adds one calm, student-facing mode selector to both Counselle
composers. The selector exposes exactly three choices:

1. **Focused Answer** — clear, direct help without unnecessary exploration.
2. **Deep Research** — a thorough, multi-source investigation for complex
   questions and consequential decisions.
3. **Guided Counselor** — a conversation that works toward the answer one
   thoughtful question at a time.

The selector is a curated skill selector under the hood. A normal message still
uses the existing `skills: string[]` request field, existing public-skill
validation, existing turn persistence, and existing selected-skill prompt
injection. This feature does **not** introduce a second agent runtime, a
personality framework, a mode-specific endpoint, or another session column.

This file is the graduated execution record. The living system description is
in `docs/ARCHITECTURE.md`; the SKILL.md decision record is ADR 0010.

---

## 0. Requirements and locked product decisions

### 0.1 Required outcome

- Both the new-chat composer and in-session composer expose the same visible
  mode control.
- The control always shows the selected mode's human-readable name; students
  never need to understand skill slugs.
- Opening the control shows exactly three compact radio choices and a
  progressive-disclosure path to specialized `@` skills.
- Each of the three modes is implemented as a new public `SKILL.md` workflow.
- Existing skill bodies are not edited or repurposed.
- Existing specialized skills remain available through `@` mentions.
- A mode is sticky within a conversation and is snapshotted when a normal turn
  starts.
- Steering, retry, regeneration, refresh, initial navigation, and legacy parked
  sessions preserve the correct semantics.
- The work must preserve Counselle's honesty, citation, authorization,
  read-only, tool, and data-reading contracts.

### 0.2 Locked interaction decisions

1. **Focused Answer is the default** for every new and legacy conversation.
2. **Mode is sticky per conversation**, not reset after each successful send.
   Guided Counselor is a conversational posture, and resetting it after one
   answer would be surprising. Consistent persistence is also easier to explain
   than mode-specific reset rules.
3. **Mode applies to the next normal new turn.** The execution mode of an
   already-running, retried, regenerated, or steered turn is immutable.
4. **The selector remains visible but is disabled** during an active response
   and while answering a legacy parked clarification. Agent V1 does not mount a
   clarification tool, so new mode-driven conversations never create parked
   clarification state; the disabled branch exists only to preserve the
   repository's compatibility surface.
5. **Specialized `@` skills are per-turn.** They clear after a successful send;
   the selected mode does not.
6. **One mode plus at most two specialized skills** fits the existing
   `MAX_SELECTED_SKILLS = 3` boundary.
7. **Mode skills do not render as repetitive chips** under every user message.
   Specialized skills continue to render there.
8. **Mode selection never changes source selection.** Sources and mode are
   orthogonal controls.
9. **No automatic model routing is part of this feature.** The feature selects
   behavior through skills, exactly as requested.
10. **No silent fallback between the three modes.** If the mode catalog is
    unavailable or malformed before a turn starts, the frontend degrades to
    today's Focused-like behavior and hides the broken selector; it does not
    pretend another mode was selected.
11. **Regenerate rewinds the sticky mode with the conversation branch.** The
    server's existing regeneration is a destructive history rewrite. A
    regeneration therefore reuses the parent question's historical full skill
    list and makes that historical mode the selected next-turn mode. This stays
    consistent before and after refresh without adding a second persistence
    source.
12. **Draft-only mode selection is not durable.** Stickiness begins after a
    normal user turn is persisted. If the first send fails before any user turn
    exists, a refresh loses the draft text and draft mode together and falls
    back to Focused Answer, matching today's draft lifecycle.

### 0.3 Important existing Quick/Think collision

The repository already contains a partially landed, separate Quick/Think
feature:

- `domain/response_mode.py` and `app/model_selection.py` are committed;
- `api/routes/config.py`, `api/routes/sessions.py`, `app/sessions.py`, and
  `config/settings.py` currently contain further local work;
- `migrations/0014_response_mode.sql` and
  `plans/quick-think-response-mode.md` are present locally.

Quick/Think controls model speed/thinking configuration. The three modes in
this plan control workflow and conversational behavior. Shipping two adjacent
composer controls both described as “mode” would produce confusing combinations
such as Quick + Deep Research and Think + Focused Answer.

**Required product gate before implementation:** the three skills-backed modes
are the only student-facing composer mode control. Do not add the planned
Quick/Think control beside it. The existing Quick/Think backend may remain
independent while its product surface is reconsidered, but this feature must use
the distinct wire name `skill_modes`, the frontend concept
`CounselingMode`, and the accessible label “Counseling mode.” Do not delete,
rewrite, or merge the existing Quick/Think work as an incidental part of this
feature.

If the owner later wants Quick/Think exposed, that requires a separate product
decision about an advanced model setting outside the primary composer. It is
not bundled into this plan.

### 0.4 Explicitly out of scope

- Building or activating the deferred GPT-Researcher graph.
- A raw model picker or a model/provider disclosure inside the mode menu.
- Mode-specific source presets.
- Mounting `ask_student`, changing graph topology, or enabling new parked
  clarification flows. Guided Counselor asks natural-language questions in
  ordinary assistant messages.
- Per-user global mode defaults.
- Mode analytics, recommendations, or automatic mode switching.
- New session persistence or database migrations for counseling modes.
- Editing existing skill bodies such as `counselor-research`,
  `school-deep-dive`, or `school-comparison`.
- Refactoring unrelated composer, turn-engine, prompt, or skill code.
- Decorative mode colors, gradients, glass effects, illustrations, or
  personality avatars.

---

## 1. Current-system findings that constrain the design

### 1.1 Skill registry and API boundary

`app/skills.py` is the canonical registry. It discovers `skills/*/SKILL.md`,
validates public metadata, exposes the browser-safe catalog, validates explicit
selection, caps selected skill bodies, and renders selected instructions into a
single turn. `api/routes/config.py` returns the catalog and selection limit;
`api/routes/sessions.py::MessageBody.skills` accepts at most three public skill
names.

The selected skill names are already:

- persisted into turn records;
- restored for parked clarifications;
- included on user transcript entries;
- preserved across retries and regeneration;
- revalidated at the API, turn registry, and agent boundaries.

Therefore the existing `skills` request is the correct execution contract.
Adding `mode` or `counseling_mode` to message requests would create two sources
of truth for the same behavior.

### 1.2 Current public and internal skills

Only `school-comparison` and `school-deep-dive` are currently public. The
internal `counselor-research` skill is a reusable evidence-routing contract but
is not an exact public Deep Research mode. The base system prompt contains a
Direct Answer Contract, but Focused Answer is not an independently selectable
workflow. There is no Guided Counselor skill.

Consequently this feature creates three new public skills and leaves every
existing skill unchanged.

### 1.3 Mention-backed skill state cannot hold a mode

`frontend/src/features/skill-picker/useSkillPicker.ts` intentionally filters a
selected skill out when its `@skill-name` mention disappears from the textarea.
This is correct for explicit task workflows. A visible mode is not an inline
mention, so putting it into the same `selectedSkills` React state would cause
the effect to delete it immediately.

The frontend must keep these concepts separate:

```ts
selectedModeSkill: string
selectedTaskSkills: string[]
```

They merge only at the normal-turn send boundary.

### 1.4 Active steering cannot blindly receive the mode skill

`frontend/src/features/ai-chat/useTurnEngine.ts::submitMessage` currently
rejects a mid-run message if `skills.length > 0`, because a live steer cannot
replace the active turn's selected workflows. If a sticky mode were appended to
every call, all steering in Deep Research or Guided Counselor would fail with
“Wait for the current response to finish before using a skill.”

The engine must receive mode and task skills as distinct inputs and decide when
to merge them:

- normal new turn: send mode + task skills;
- live steer: send text only and inherit the active execution;
- parked clarification: send no replacement skills; server inherits the parked
  selection;
- queued local auto-forward: retain the captured mode separately until the
  next normal turn actually starts.

### 1.5 Current composer grammar

Both composers have the same visual anatomy: textarea, left-side tool row, and
right-side send/stop control. The left row currently contains an icon-only `@`
skill trigger and the labeled Sources menu. `SourcesMenu.tsx` already uses the
installed Base UI menu family with top placement. `components/ui/menu.tsx`
already exports real radio-group/radio-item primitives.

The smallest coherent UI change is to replace the visible `@` button with one
labeled mode menu, preserve Sources, and keep the existing `@` picker reachable
from the menu and keyboard.

### 1.6 Direct Answer and current Agent V1 clarification constraints

The base system prompt says to answer immediately and independently judge
depth. More importantly, the shipped graph explicitly does not mount a clarify
tool (`app/graph.py`), and the live prompt says not to stop for a clarifying
tool call in Agent V1. `app/clarify.py` remains compatibility/future surface,
not a callable capability of this feature. Selected skill bodies cannot
override those system/runtime constraints.

Guided Counselor and Deep Research therefore require one small system-prompt
precedence sentence: an explicitly selected skill in the trusted
`response-mode` group controls response cadence and depth, while remaining
subordinate to honesty, citations, authorization, mounted-tool availability,
read-only, and value-reading rules. Guided uses ordinary natural-language
questions at the end of assistant messages; it never calls `ask_student` or
creates a parked turn. Without the precedence sentence, a carefully written
Guided skill could be neutralized by the base Direct Answer Contract.

---

## 2. Final student experience

### 2.1 Closed composer

Desktop and normal mobile widths:

```text
┌────────────────────────────────────────────────────┐
│ Message Counselle…                                 │
│                                                    │
│ [ Focused Answer ▾ ] [ Sources ▾ ]            [➤] │
└────────────────────────────────────────────────────┘
```

The mode trigger is the first control because it changes the nature of the
response. Sources remains second because it changes evidence access. Send/stop
remains visually separated on the right.

Trigger requirements:

- Visible current mode name at all times.
- A small mode-specific Lucide icon plus chevron; text remains the primary
  signal.
- Accessible name: `Counseling mode: Focused Answer` (or current mode).
- Same 32px visual height, radius, border, surface, hover, active, and focus
  language as Sources.
- Existing coarse-pointer hit-area behavior must still produce at least a 44px
  effective target.
- Disabled styling remains legible while generating/clarifying.

Suggested icons, using already-installed Lucide only:

- Focused Answer: `MessageSquareText`.
- Deep Research: `Search` or `LibraryBig`; choose the one that remains clearest
  at 16px in the actual composer.
- Guided Counselor: `MessagesSquare`.

Do not assign different colors to the modes. Selection is communicated by
name, icon, and the same selected-row surface treatment used by the Sources
menu, not color or decoration.

### 2.2 Open menu

```text
Focused Answer
Deep Research
Guided Counselor

────────────────────────────────────
@  More specialized skills…
```

Use `Menu`, `MenuTrigger`, `MenuPopup`, `MenuRadioGroup`, and `MenuRadioItem`
from `components/ui/menu.tsx`, matching `SourcesMenu`:

- `side="top"`, `align="start"`, `sideOffset={8}`;
- same compact width and outer padding as `SourcesMenu`, capped to viewport
  width;
- opaque existing dropdown/composer surfaces;
- no group label;
- three one-line radio rows with the same compact density and icon gutter as
  `SourcesMenu`;
- no visible check or secondary selection glyph;
- one subtle separator before the secondary action;
- existing menu transition only, with reduced-motion support;
- Escape closes and restores focus; arrow keys, Home/End, Enter/Space, and
  checked-state announcements come from Base UI.

Do not use a modal, command palette, segmented control, horizontal tabs, or
three permanent cards. The composer and menu should remain visually quiet and
consistent with the adjacent Sources control.

### 2.3 “More specialized skills…” behavior

The visible icon-only `@` toolbar button is removed to make room for the mode
without crowding mobile. Its functionality remains available in two ways:

1. A student can type `@` at any time, exactly as today.
2. Activating “More specialized skills…” first closes the mode menu, then—after
   Base UI has completed focus restoration—focuses the textarea, inserts the
   `@` trigger through the existing `useSkillPicker().insertTrigger`, and opens
   the existing searchable picker.

This handoff must be deliberate: a synchronous `insertTrigger` from a closing
menu item can race Base UI's return-focus behavior and put focus back on the
mode trigger. Use a controlled menu close plus a one-shot deferred handoff (or
the primitive's supported close-complete seam), then assert the final focus,
caret, `@` text, and open listbox in an integration test. Do not scatter timing
workarounds across the composers.

This reuses the current selection, caret, keyboard, announcement, and inline
mention behavior. Do not build a second skill-search UI inside the mode menu and
do not nest one popup inside another. When both specialized skill slots are
already used, disable “More specialized skills…” and label the reached limit;
do not insert a dead `@` trigger.

The ordinary picker must exclude skills whose `selection_group` is
`response-mode`, preventing duplicate access paths and conflicting selections.

### 2.4 Responsive behavior

- Treat 375px as the primary mobile acceptance width.
- Keep the full selected mode name visible at 375px.
- Keep the current flex-wrap safety, but avoid a routine two-row toolbar.
- At narrower reflow widths/200% zoom, collapse the lower-priority Sources
  trigger's visible text before truncating or hiding the mode name; preserve its
  full accessible label.
- Cap the menu to `calc(100vw - 2rem)`.
- Do not introduce horizontal scrolling.
- Verify long labels do not overlap the viewport.
- Preserve textarea and send-button alignment when the toolbar reflows.

### 2.5 Loading, failure, and disabled states

- While `/v1/config` is loading, preserve the current composer skeleton/disabled
  behavior; do not briefly render the wrong mode and then snap.
- If the ordinary skill catalog fails but `skill_modes` is valid, modes remain
  usable and specialized skills disappear.
- If `skill_modes` is missing, malformed, has duplicates, does not contain
  exactly one default, or does not resolve to exactly the three supported
  entries, hide the selector **and render the existing visible `@` toolbar
  button unchanged**. Do not disable sending, Sources, or the ordinary skill
  picker.
- During an active turn, selector is disabled and continues showing the active
  conversation mode.
- During a legacy parked clarification, selector is disabled and existing
  continuation behavior remains unchanged. New mode skills cannot create this
  state because Agent V1 mounts no clarify tool.
- No tooltip is necessary for enabled mode rows; all explanations are visible.
  A disabled native trigger may use a nearby visually-hidden explanation or an
  existing tooltip only if the actual interaction test shows students cannot
  understand why it is unavailable.

### 2.6 Mode persistence and history semantics

- New conversation: initialize from the one `selection_default` entry.
- Landing-to-chat handoff: carry the captured combined skill list in the
  existing `initialTurn` route state.
- Successful normal send: clear text and task skills; keep selected mode.
- Failed normal send: restore text and task skills; keep captured mode.
- Direct load/refresh: derive the UI mode from the newest valid mode skill on a
  persisted normal user transcript entry. This promise starts after the first
  normal user turn has actually persisted; unsent/pre-persistence drafts are
  intentionally local only.
- Legacy transcript with no mode skill: display Focused Answer.
- Regenerating an older response reuses that parent message's historical full
  skill list and resets the current next-turn selector to the parent message's
  historical mode (Focused for a legacy parent with none). This matches the
  server's branch-truncating history rewrite and remains stable after refresh.
- Switching sessions remounts the route and derives each session independently;
  no mode state leaks between chats.
- Changing the selector before Send is local draft state and need not persist
  across devices until a message records it.

### 2.7 Transcript presentation

`ChatMessage.tsx` currently renders every user message skill as an “Invoked
skills” chip. Filter response-mode entries out of this chip list. Showing
“Focused Answer” beneath nearly every message would add noise without helping
the student.

Specialized skills retain their existing chips and labels. Historical mode is
still preserved in the message model for regeneration and state derivation; it
is merely not repeated visually. Do not add a replacement badge to assistant
messages, activity rows, or the sidebar in this feature.

---

## 3. Skill definitions

Create three new files only; do not modify existing skill bodies:

- `skills/focused-answer/SKILL.md`
- `skills/deep-research/SKILL.md`
- `skills/guided-counselor/SKILL.md`

### 3.1 Shared frontmatter

Extend the deliberately small scalar frontmatter parser and immutable
`SkillEntry` with these optional public-selection fields:

```yaml
user_invokable: true
display_name: Focused Answer
user_description: Clear, direct help without unnecessary exploration.
selection_group: response-mode
selection_order: 10
selection_default: true
```

Rules:

- `selection_group` is either absent or a valid skill-style identifier.
- `selection_order` is a non-negative integer when a group is present.
- `selection_default` is literal lowercase `true`/`false` and defaults false.
- Grouped public skills require an order.
- A default requires a group.
- Public invalid metadata fails startup exactly as other invalid public
  metadata does; malformed internal metadata remains skipped according to the
  current registry policy.
- The `response-mode` group must resolve to exactly three entries, exactly one
  default, unique orders, and the locked names. This product invariant is
  enforced inside `_build_registry` after all entries are collected, so the
  existing `api/main.py` startup call to `load_all_skill_meta()` validates it
  before traffic is accepted. Do not defer it until `/v1/config` is requested
  and do not trust the frontend.

Orders:

- `focused-answer`: 10, default true.
- `deep-research`: 20.
- `guided-counselor`: 30.

The frontend must not hardcode ordering or infer the default from array
position.

### 3.2 Focused Answer behavior

The skill body must be compact and operational:

- Start with the answer, recommendation, or closest supported answer.
- Prefer the smallest evidence set that changes the decision.
- Do not broaden a request into a research project merely because several
  related questions could be asked.
- State one material limitation only when it affects the recommendation.
- Make a reasonable explicit assumption instead of asking when the ambiguity
  is low-risk.
- Ask one focused question only when a responsible answer materially depends on
  it.
- For advice, end with the concrete next move.
- Preserve all honesty/citation/data-source rules.

This skill makes an explicit Focused choice meaningfully stronger than the
base prompt's automatic depth judgment; it is not an empty marker skill.

### 3.3 Deep Research behavior

The skill must describe the capability that exists today, not the deferred
GPT-Researcher subsystem:

- Briefly establish the decision and material research axes.
- Use DB/CDS evidence first for covered school facts.
- Load the existing internal `counselor-research` skill when its source-routing
  contract applies.
- Use official sources for current policy/program facts, broad web for
  discovery/context, and Reddit only for clearly labeled lived-experience
  signals.
- Triangulate important claims, resolve or disclose conflicts, and distinguish
  fact from inference.
- Explore unknown unknowns that could invert the recommendation.
- Lead the final synthesis with the answer/recommendation, then organize the
  evidence by decision axis.
- Be comprehensive but never pad; the number of material axes earns length.
- If the scope is genuinely outcome-changing and unspecified, ask one focused
  natural-language question and wait for the student's next ordinary message
  before expensive research; do not call a clarification tool.
- Never claim multi-agent/GPT-Researcher execution unless that subsystem later
  ships and the skill is deliberately revised in a separate change.

### 3.4 Guided Counselor behavior

The skill defines a multi-turn admissions conversation, not therapy and not an
intake form:

- Use saved profile/context first and never re-ask known information.
- Ask at most one meaningful question in a response.
- Before the next question, reflect the important part of the student's answer
  and provide a useful observation, option, or provisional recommendation.
- Ask through ordinary assistant prose. Agent V1 does not mount `ask_student`;
  do not call or imply a clarification widget.
- Make progress every turn. Never produce a sequence of bare questions.
- Explain why a sensitive or non-obvious question matters when that is not
  self-evident.
- Avoid asking for private information that is unnecessary for the admissions
  decision.
- Track the actual decision being made and stop questioning once enough is
  known.
- Converge to a summary, recommendation, tradeoffs, and next action.
- If the student asks a direct factual question while Guided is active, answer
  it before asking whether/how they want to explore the implication.
- End with at most one question, then wait for the student's next ordinary
  message. Do not simulate an intake form by embedding several questions in
  bullets or prose.

### 3.5 System-prompt integration

Add one narrowly scoped paragraph immediately before the Direct Answer
Contract in `config/assets/prompts/counselor.md`:

- If exactly one trusted `response-mode` workflow appears in “Explicitly
  selected workflows,” it controls interaction cadence and response depth for
  that turn.
- It cannot weaken the Honesty Contract, citation rules, authorization,
  read-only boundaries, tool constraints, or value-reading rules.
- It does not mount unavailable tools or change graph topology; questions in
  Guided/Deep are ordinary assistant prose under Agent V1.
- Without such a selection, existing automatic-depth behavior remains.

Do not duplicate any mode body in the system prompt and do not add slug-based
branching to agent control flow. The repository-owned selected-skill body
remains the source of mode behavior.

---

## 4. Backend contract and validation

### 4.1 Registry model

Modify `app/skills.py` by extension:

- Add optional immutable fields to `SkillEntry` for selection group, order, and
  default.
- Parse and validate those scalars in `_build_registry`.
- Keep `_parse_frontmatter` deliberately small; do not add a YAML dependency.
- Keep existing caches derived from the immutable registry.
- Add focused helpers that return:
  - ordinary public skill catalog entries;
  - one ordered public group catalog for `response-mode`;
  - the group membership for validation/presentation.
- Avoid repeated discovery or separate unvalidated filesystem reads.
- Validate the complete three-entry `response-mode` invariant before publishing
  the immutable registry/cache. A partial group must never enter any cache.

Suggested browser-safe mode shape:

```json
{
  "name": "guided-counselor",
  "display_name": "Guided Counselor",
  "description": "Work through it together, one thoughtful question at a time.",
  "order": 30,
  "default": false
}
```

Do not send `path`, body content, internal descriptions, or arbitrary
frontmatter to the browser.

### 4.2 `/v1/config`

Extend `api/routes/config.py` additively:

```json
{
  "skills": ["existing non-mode public catalog entries"],
  "skill_modes": ["the three ordered mode entries"],
  "max_selected_skills": 3
}
```

Compatibility requirements:

- Existing clients ignore the new key and continue seeing the same two
  specialized public skills they see today.
- Do not rename or reuse the existing Quick/Think `response_modes` key.
- Do not include mode entries in both arrays.
- Config remains authenticated and browser-safe.
- Mode catalog construction fails loudly during the existing startup registry
  preload/test for repository authoring errors; runtime request handling must
  not return a half-valid group.

### 4.3 Selected-skill validation

Extend `validate_selected_skills` without weakening existing checks:

- canonicalize aliases first as today;
- reject duplicates as today;
- reject unknown/internal names as today;
- reject more than three total as today;
- reject body-size overflow as today;
- additionally reject more than one selected skill from the same non-empty
  `selection_group`.

Use a stable non-sensitive telemetry reason such as
`conflicting_selected_skill_group`. The client-facing safe error remains
“Those selected skills aren't available.” Do not leak names or internal
metadata in validation errors.

Accept zero grouped skills for backward compatibility. The frontend treats
absence as Focused, while old clients retain current prompt behavior.

### 4.4 Persistence and resume

No schema or persistence changes are needed. Preserve current behavior in:

- `app/turns.py::_selected_skills_for_start`;
- `app/run_turn.py` parked-record validation;
- `app/records.py` user-turn records;
- `app/turn_persistence.py`;
- transcript serializers in `api/routes/sessions.py`.

The implementation should not edit these modules unless a failing focused test
proves an actual missing behavior. The plan relies on their existing validated
skill lists rather than adding parallel mode fields.

### 4.5 Prompt rendering

`render_selected_skills` continues rendering all selected skill bodies under
“Explicitly selected workflows.” For each grouped entry, render one trusted,
repository-derived metadata line such as `Selection group: response-mode`
before its body. This lets the base prompt recognize a trusted mode without
inferring status from a user-supplied slug. Do not render paths, hidden metadata,
or browser copy.

The frontend sends the mode first, then task skills, yielding deterministic
mode-first instructions on supported clients.

Do not add slug-specific branching inside `render_selected_skills`; generic
selection-group metadata and the trusted skill body are sufficient.

---

## 5. Frontend data contract

### 5.1 Types

Extend `frontend/src/api/chat/types.ts`:

```ts
export type SkillModeWire = {
  name: string;
  display_name: string;
  description: string;
  order: number;
  default: boolean;
};

export type CounselingMode = {
  skillName: string;
  displayName: string;
  description: string;
  order: number;
  isDefault: boolean;
};
```

Add optional `skill_modes` to `ChatConfigWire` and resolved `skillModes` plus
`defaultSkillMode` to `ComposerConfig`. Keep Quick/Think `ResponseMode` types
distinct if/when that local work reaches the frontend.

### 5.2 Defensive parsing

In `frontend/src/api/chat/config.ts`, parse ordinary skills and mode skills
independently:

- ordinary skill corruption disables only the ordinary picker;
- mode corruption hides only the mode menu;
- validate non-empty strings, unique names, safe integer unique orders, boolean
  default fields, exactly three entries, and exactly one default;
- sort a copied array by order without mutating wire input;
- never infer a display label from a slug for the primary mode control;
- on config-query failure, preserve the existing fallback greeting/sources and
  no-selector behavior.

Do not let malformed optional mode metadata make the entire composer unusable.

### 5.3 Shared mode helpers

Create a small focused module under `frontend/src/features/ai-composer/`, for
example `counseling-mode.ts`, containing pure helpers:

- find a mode by skill name;
- return the default mode;
- split a persisted skill list into `{ modeSkill, taskSkills }`;
- merge one mode plus task skills with mode first;
- derive the newest valid historical mode from user messages;
- filter mode names from transcript presentation.

Helpers return new arrays/objects and never mutate inputs. Do not create a
context/provider or global store for three local values.

---

## 6. Shared composer component

### 6.1 `CounselingModeMenu`

Create
`frontend/src/features/ai-composer/CounselingModeMenu.tsx`, used by both
`AiComposer.tsx` and `ai-chat/components/ChatComposer.tsx`.

Suggested props:

```ts
type CounselingModeMenuProps = {
  mode: CounselingMode;
  modes: readonly CounselingMode[];
  disabled?: boolean;
  onModeChange: (mode: CounselingMode) => void;
  onBrowseSkills: () => void;
};
```

The component owns only menu presentation and selection. It does not know about
textarea text, skill limits, network state, transcript history, or turn
inheritance.

### 6.2 Shared composer-control styling

`SourcesMenu.tsx` and both composers currently repeat a long semantic control
class string. Extract only the common toolbar-trigger styling into a narrowly
named exported constant or tiny primitive under `features/ai-composer/` if that
reduces actual duplication between Sources and the new mode trigger.

Do not refactor Button globally, change unrelated tokens, or move behavioral
logic merely because the files are touched. The extraction must remain a local
composer concern.

### 6.3 Composer props

Both composer components receive resolved mode data and callbacks:

```ts
mode: CounselingMode | null;
modes: readonly CounselingMode[];
onModeChange: (mode: CounselingMode) => void;
```

Keep existing ordinary skill props. Pass the remaining task-skill limit rather
than the backend total into `useSkillPicker`:

```ts
maxTaskSkills = Math.max(0, maxSelectedSkills - (mode ? 1 : 0));
```

If mode config is unavailable, keep the existing `maxSelectedSkills` task
limit because no mode name will be sent.

When a valid mode catalog is present, replace the rendered `@` toolbar Button,
not the picker hook or keyboard behavior, and wire `onBrowseSkills` to the
existing `picker.insertTrigger` through the controlled-close/deferred-focus
handoff in §2.3. When mode config is absent/invalid, render the current `@`
Button exactly as today so progressive enhancement never removes the mouse/touch
entry point to ordinary skills.

### 6.4 Avoid divergent duplicate behavior

`AiComposer.tsx` and `ChatComposer.tsx` are intentionally separate because
their submit/stop/clarify behavior differs. Share the new menu component and
pure helpers, but do not combine/rewrite the two composers in this feature.
That would expand regression surface without adding user value.

---

## 7. Route and state ownership

### 7.1 New-chat route

In `AiComposerRoute.tsx`:

- initialize `selectedModeSkill` only after valid config resolves, using the
  declared default;
- do not overwrite a student selection on query rerender/refetch;
- retain mode while editing the prompt;
- on successful session creation, navigate with
  `initialTurn.skills = merge(mode, taskSkills)`;
- clear prompt and task skills after success;
- no need to keep local mode after navigation because the route unmounts;
- on failure/cancel, preserve the draft mode and task skills.

The initial turn continues through the current session creation and route-state
handoff; no new session API field is added. As today, route-state draft data is
not durable: if the first turn fails before a user record persists and the
student refreshes, both draft text and draft mode are lost and the empty chat
returns to Focused. Do not add one-off draft persistence solely for mode.

### 7.2 In-session route

In `AiChatPage.tsx`:

- own `selectedModeSkill` separately from `selectedSkills` (rename the latter to
  `selectedTaskSkills` in touched code for clarity);
- initialize from the valid initial-turn skill list when present;
- after transcript load, derive the current mode from the newest persisted
  normal user message, falling back to config default;
- ensure transcript hydration does not overwrite a mode the student has already
  changed locally after load;
- preserve mode after normal send success or failure;
- clear/restore task skills exactly as today;
- keep legacy parked-clarification answers free of replacement skill lists;
- regenerate using the parent message's full historical skill list and reset
  the selected next-turn mode to that parent's historical mode (Focused when
  absent), matching the server's branch rewrite;
- pass current mode and remaining task-skill capacity to `ChatComposer`.

Use a small initialization guard/ref or reducer state with a clear invariant;
do not add effects that repeatedly derive state and clobber user interaction.

### 7.3 Message submit API

Replace the overloaded positional `skillsOrReplaceMessageId` union in
`useTurnEngine.ts` with a named input object:

```ts
type SubmitMessageInput = {
  text: string;
  modeSkill?: string;
  taskSkills?: readonly string[];
  historicalSkills?: readonly string[];
  replaceMessageId?: string;
};
```

Semantics:

- normal composer send supplies `modeSkill` and `taskSkills`;
- regeneration supplies `historicalSkills` and `replaceMessageId`;
- legacy parked clarification supplies text only;
- internal retry uses the immutable captured combined list;
- callers cannot supply both `historicalSkills` and mode/task fields; enforce
  that in the pure argument-normalization helper and tests.

This refactor is earned because adding another positional semantic argument
would make mode/skills/replacement ordering fragile. Update direct callers and
focused tests only; do not refactor unrelated engine internals.

### 7.4 Normal-turn snapshot

Immediately before `startSend`, construct one immutable ordered list:

```ts
capturedSkills = historicalSkills ?? mergeModeAndTaskSkills(modeSkill, taskSkills)
```

`startSend`, optimistic user messages, pending sends, transport requests, retry,
conflict recovery, and persisted message reconciliation all use that same
captured list. Never reread changing selector state after the send begins.

### 7.5 Active steering and local auto-forward

When a live turn exists and the message is not replacement/regeneration:

- task skills still block steering with the current safe message;
- the sticky mode alone does **not** block steering;
- call the existing steer endpoint with text only;
- the active server turn keeps its already captured selected skills;
- when `steerMessage` returns its `userMessageId`, associate that ID with the
  mode snapshot supplied to `submitMessage`; when the matching uninjected SSE
  user segment is later auto-forwarded, carry that mode alongside its ID/text;
- for an attached active turn whose pending steer predates the current browser
  instance, derive the active mode from the hydrated active user message before
  attaching and use it as the fallback for unmatched pending segment IDs;
- extend `AutoForwardMessage` and, if required to pass hydrated attach context,
  `useChatSession.ts` narrowly rather than using a mutable global/current
  selector ref;
- do not append the mode to a live steer request or replace a parked record.

This distinction is mandatory to avoid breaking the current “chat while the
agent works” behavior.

### 7.6 Legacy parked-clarification compatibility

Agent V1 does not mount `ask_student`; Focused, Deep, and Guided therefore never
create new parked clarification state. Preserve the existing compatibility
paths for sessions parked by older/future runtimes:

- inline `ClarifyWidget` answer;
- free-text answer submitted through the normal composer while
  `awaitingClarify` is true.

The frontend should derive continuation from engine state, omit mode/task
skills, and let `TurnRegistry._selected_skills_for_start` restore the parked
selection. A caller-supplied mode must never replace a parked turn's selection.
The mode selector is disabled during this continuation. Do not modify
`app/transcript.py` or expand synthesized-answer regeneration in this feature:
new mode skills cannot exist on a mode-created parked record because this
feature creates none. Any broader repair of legacy synthesized-answer
regeneration belongs to the clarification feature itself.

### 7.7 Retry, conflict, and regenerate

- Pre-stream/network retry uses the pending attempt's captured combined list.
- 409 cancel/retry uses the original captured combined list and existing
  optimistic user message; no duplicate bubble.
- Terminal error retry, if represented by existing pending state, follows the
  same snapshot rule.
- Regenerate uses the original parent user's historical skill list.
- Legacy parent messages without a grouped mode regenerate with their original
  list and select Focused as the next-turn mode; do not inject the pre-rewrite
  current selector into historical execution.
- Regeneration intentionally updates the sticky selector to the regenerated
  branch's historical mode. Retry and conflict recovery do not change it.

---

## 8. Accessibility and interaction contract

### 8.1 Keyboard

- Tab reaches the mode trigger in visual order before Sources.
- Enter/Space opens.
- Up/Down and Home/End navigate the three radio items.
- Enter/Space selects and closes according to the existing Base UI behavior.
- Escape closes and returns focus to the trigger.
- Activating “More specialized skills…” returns focus to the textarea at the
  inserted `@` caret and opens the existing listbox.
- Typing `@` remains unchanged.
- There is no keyboard trap between the menu, picker, and textarea.

### 8.2 Screen reader

- Trigger announces `Counseling mode: <name>`, expanded/collapsed state, and
  disabled state through native primitives.
- Popup uses menu radio semantics; each choice exposes name and checked state.
- Icons are `aria-hidden`/decorative.
- “More specialized skills…” has a visible accessible label.
- Existing skill-picker live announcements continue to report added/duplicate/
  limit states.
- Config errors never rely on visual color alone and never strand focus.

### 8.3 Touch and pointer

- Effective targets are at least 44×44 CSS pixels on coarse pointers.
- The shared `Button` already supplies a coarse-pointer 44px pseudo-hit-area for
  the trigger. The existing `MenuRadioItem` does not; apply an explicit
  `pointer-coarse:min-h-11` (or equivalent 44px row contract) to all three mode
  rows and the “More specialized skills…” item, then verify computed hit boxes.
- Rows are comfortably tappable and do not place a tiny check as the target.
- Click/tap anywhere on a mode row selects it.
- Menu stays clear of the software keyboard by opening upward from the composer.
- No hover-only explanation or action.

### 8.4 Visual fidelity

Follow the current Counselle design system and Impeccable product context:

- quiet, familiar, premium, precise;
- existing Geist typography;
- existing workspace composer/dropdown semantic tokens;
- opaque surfaces and restrained borders;
- no glass, blur, gradient, glow, oversized radius, decorative illustration,
  or personality-specific palette;
- no new animation system; existing short menu transition only;
- mode state communicated by text/check/icon, never color alone.

The UI/UX reference search suggested a liquid-glass treatment, but that
conflicts with Counselle's explicit anti-references and actual interface. The
repository design system wins.

---

## 9. Failure containment and compatibility

### 9.1 Old frontend against new backend

- Ignores `skill_modes`.
- Continues receiving the same ordinary `skills` entries.
- Sends messages without a mode and receives current behavior.

### 9.2 New frontend against old backend

- Missing `skill_modes` parses as no selector.
- Composer, Sources, `@` skill picker, and sending remain functional.
- Legacy chats display Focused behavior without claiming the Focused skill was
  historically selected.

### 9.3 Malformed config

- Parse ordinary skills and modes independently.
- A bad mode array cannot disable ordinary skills.
- A bad ordinary skill array cannot disable modes.
- No partially valid three-mode menu is shown.
- Log/telemetry may record a stable parsing category, never skill body content
  or student text.

### 9.4 Malicious API request

- Backend rejects multiple grouped modes even if the UI cannot produce them.
- Existing public-only, duplicate, alias, count, and body-size validation stays
  intact.
- Skill bodies remain repository-owned trusted content; the request supplies
  only validated names.

### 9.5 Rollback

This feature has no DB migration. A rollback can remove the new frontend menu,
config key, mode metadata support, prompt sentence, and three skill files while
leaving persisted historical skill names readable only if rollback timing is
controlled.

Safer rollout order:

1. Deploy backend registry/config/validation and skill files first.
2. Deploy frontend after backend availability is confirmed.
3. During rollback, remove/hide frontend first.
4. Keep backend recognition of the three names until no deployed client can send
   them and parked turns containing them have expired/completed.

Do not remove backend skills first while a frontend can still submit their
names; that would turn valid-looking selections into 422 errors.

---

## 10. Implementation phases

### Phase 0 — resolve product collision and freeze the contract

1. Owner confirms the three skills-backed modes are the only primary composer
   mode selector.
2. Record that Quick/Think will not add a second adjacent composer selector as
   part of its current plan.
3. Lock names, descriptions, ordering, default, stickiness, and “More
   specialized skills…” behavior.
4. Capture baseline wide, 375px, keyboard, and current `@` picker behavior under
   `artifacts/counseling-response-modes/` during implementation—not in source or
   docs.

Gate: no product-code implementation before this decision is explicit.

### Phase 1 — registry metadata and three skills

Files:

- modify `app/skills.py`;
- add the three `skills/*/SKILL.md` files;
- modify `tests/app/test_skills.py`.

Work:

1. Add immutable group/order/default metadata and validation.
2. Add ordinary and grouped browser-safe catalog helpers.
3. Enforce one selected skill per group.
4. Write the three compact skill contracts.
5. Add focused tests for metadata, catalog partitioning/order/default,
   conflicting modes, backward-compatible ungrouped skills, aliases, and body
   limits.

Gate: existing skill tests plus new focused tests pass; no existing skill body
changed.

### Phase 2 — config and prompt precedence

Files:

- modify `api/routes/config.py`;
- modify `config/assets/prompts/counselor.md`;
- update the focused config/API and prompt-rendering tests where they currently
  live.

Work:

1. Add `skill_modes` without altering Quick/Think `response_modes`.
2. Keep `skills` limited to non-mode public skills.
3. Add the narrow selected-mode precedence sentence to the base prompt.
4. Verify the rendered prompt contains one selected mode body once and preserves
   all higher-priority contracts.

Gate: old-style message requests remain valid; config returns exactly three
safe mode entries and the same existing ordinary skills.

### Phase 3 — frontend contract and pure helpers

Files:

- modify `frontend/src/api/chat/types.ts`;
- modify `frontend/src/api/chat/config.ts`;
- add `frontend/src/features/ai-composer/counseling-mode.ts`;
- modify/add focused config and helper tests.

Work:

1. Add wire/domain types without colliding with Quick/Think naming.
2. Parse modes independently and defensively.
3. Add immutable split/merge/default/history/filter helpers.
4. Test malformed arrays, duplicate order/name, missing/multiple default,
   legacy absence, and non-mutation.

Gate: malformed mode config cannot break messaging or ordinary skills.

### Phase 4 — mode menu and composer integration

Files:

- add `frontend/src/features/ai-composer/CounselingModeMenu.tsx`;
- modify `frontend/src/features/ai-composer/AiComposer.tsx`;
- modify `frontend/src/features/ai-chat/components/ChatComposer.tsx`;
- modify `frontend/src/features/ai-composer/SourcesMenu.tsx` only if a narrow
  shared trigger style extraction is justified;
- add/update component tests.

Work:

1. Build the top-opening three-row radio menu from existing primitives.
2. Replace the visible `@` toolbar button with the mode trigger only when mode
   config is valid; preserve the current button as the fallback otherwise.
3. Route “More specialized skills…” through a controlled-close/deferred-focus
   handoff to `picker.insertTrigger`, and disable it when task slots are full.
4. Keep direct `@` typing intact.
5. Reserve one of three skill slots for mode when mode config is valid.
6. Apply explicit 44px coarse-pointer heights to menu rows/actions.
7. Implement narrow/reflow behavior using existing tokens.

Gate: both composers have identical mode UX; no nested popover, custom ARIA,
new dependency, or duplicated picker.

### Phase 5 — route state and turn-engine lifecycle

Files:

- modify `frontend/src/features/ai-composer/AiComposerRoute.tsx`;
- modify `frontend/src/features/ai-chat/AiChatRoute.tsx` only if initial-turn
  typing needs clarification, not a parallel mode field;
- modify `frontend/src/features/ai-chat/AiChatPage.tsx`;
- modify `frontend/src/features/ai-chat/useChatSession.ts` only as needed to
  pass hydrated active-mode context into attach/auto-forward;
- modify `frontend/src/features/ai-chat/useTurnEngine.ts`;
- modify focused tests for these modules.

Work:

1. Own sticky mode separately from mention-backed task skills.
2. Preserve the combined initial-turn handoff.
3. Replace positional submit arguments with the named input object.
4. Snapshot combined skills exactly once for normal turns.
5. Preserve steering, legacy parked-continuation inheritance, queued
   auto-forward keyed by steer user-message ID, retry, conflict recovery,
   regeneration, and session switching.
6. Ensure hydration never overwrites a user's post-load selection.
7. Make regeneration reset the selected next-turn mode to the historical branch
   it restores.

Gate: the complete lifecycle matrix in §11.3 passes.

### Phase 6 — quiet transcript presentation

Files:

- modify `frontend/src/features/ai-chat/components/ChatMessage.tsx`;
- modify its focused test.

Work:

1. Filter grouped mode skills from “Invoked skills” chips using config-derived
   names or pure helper input.
2. Preserve ordinary skill chips and fallbacks for retired/unknown historical
   specialized skills.
3. Keep full historical skills in the message model.

Gate: no repetitive mode badges; regeneration/state derivation still sees mode
names.

### Phase 7 — behavior evals and manual UX verification

1. Add/extend agent eval cases rather than brittle exact-string tests:
   - Focused answers a complex-looking question directly and concisely.
   - Deep Research triangulates material axes and cites sources without padding.
   - Guided Counselor asks one useful question, gives value between questions,
     uses saved context, and converges.
2. Run focused backend/frontend suites, then routine repository checks.
3. Run real-browser desktop/mobile/zoom/keyboard/reduced-motion scenarios.
4. Record screenshots and notes in
   `artifacts/counseling-response-modes/<timestamp>/`.
5. Owner reviews the real interaction, not only component snapshots.

Gate: all acceptance criteria in §12 pass before docs graduation.

### Phase 8 — living docs and graduation

After implementation is verified and accepted:

1. Update `docs/ARCHITECTURE.md` skill catalog and composer/turn-lifecycle
   sections.
2. Update ADR 0010 or create a new ADR only if the grouped-public-skill/product
   mode decision is architecturally distinct enough to warrant it; do not
   silently contradict the current ADR.
3. Update `docs/adr/README.md` if a new ADR is added.
4. Reconcile the stale “four skills ship” wording with the actual internal
   skill set without rewriting historical specs.
5. Graduate this plan to `specs/counseling-response-modes/plan/` only after the
   feature is finished and verified.

---

## 11. Verification strategy

The repository's startup-mode rules reject reflexive test volume. These tests
earn their place because mode bugs can silently execute the wrong workflow,
break active chat, or misrepresent what the student selected.

### 11.1 Backend focused tests

In `tests/app/test_skills.py` and the existing config/turn tests:

- all three mode skills load as valid public entries;
- mode catalog order is 10/20/30 and exactly one default exists;
- ordinary catalog still contains School Comparison and School Deep Dive;
- grouped modes are not duplicated into the ordinary catalog;
- malformed public group/order/default metadata fails safely;
- two response-mode names are rejected regardless of order;
- one mode + two task skills succeeds;
- one mode + three task skills still hits the existing max-three boundary;
- no mode + three task skills remains backward compatible;
- alias canonicalization still precedes duplicate/group checks;
- rendered selected instructions include mode first exactly once and include
  the trusted `Selection group: response-mode` marker;
- existing legacy parked resume accepts the identical parked skill list and
  rejects replacement as today; no test pretends the new modes can create a
  clarify interrupt;
- unknown/internal names and body-size checks remain unchanged.

### 11.2 Frontend config/helper tests

- valid three-mode config parses and sorts without mutating input;
- missing mode key yields no menu without breaking ordinary skills;
- malformed mode entry, duplicate name/order, zero/multiple defaults, or wrong
  count disables modes only;
- ordinary skill corruption disables ordinary picker only;
- split/merge helpers preserve order and remove no unrelated names;
- a legacy skill list derives Focused fallback;
- newest valid historical mode wins;
- grouped mode names are filtered from chips while ordinary/unknown historical
  names remain renderable.

### 11.3 Turn lifecycle matrix

Cover in `useTurnEngine.test.tsx`, `AiChatPage.test.tsx`, and
`AiComposerRoute.test.tsx`:

| Scenario | Expected skill behavior |
|---|---|
| New chat default send | `focused-answer` sent once |
| New chat Guided + task skill | mode first, task second in initial turn |
| Successful follow-up | mode retained, task mentions cleared |
| Failed send | exact text/task snapshot restored; mode unchanged |
| Active steer with mode only | steer succeeds with text-only endpoint |
| Active steer with task skill | current safe rejection remains |
| Locally queued auto-forward | steer ID's captured mode used when new turn starts |
| Auto-forward after stream reattach | hydrated active mode used as fallback |
| Legacy inline clarify answer | no replacement skills sent; parked selection inherited |
| Legacy free-text clarify answer | same compatibility behavior |
| Retry before stream | exact captured combined list reused |
| 409 cancel/retry | exact list reused; no duplicate user bubble |
| Regenerate | parent's historical list reused; selector rewinds to parent mode |
| Direct session refresh | newest persisted mode displayed |
| Legacy session | Focused displayed; historical record not rewritten |
| Switch between chats | each chat derives independently |
| Delete `@task` mention | task removed; mode untouched |
| Mode + two tasks | allowed |
| Attempt third task with mode | accessible limit announcement |

### 11.4 Component/accessibility tests

- visible trigger label tracks selection;
- trigger accessible name includes “Counseling mode” and selected name;
- menu contains exactly three radio options;
- checked state changes through click and keyboard;
- Escape/focus return works through Base UI integration;
- “More specialized skills…” closes the menu, survives Base UI focus return,
  then focuses textarea at the correct caret, inserts `@`, and opens picker;
- “More specialized skills…” is disabled/announced when both task slots are
  full;
- direct typed `@` still opens picker;
- invalid/missing mode config restores the current visible `@` button;
- disabled active/legacy-clarify state does not allow changes;
- mode menu rows match the compact Sources menu treatment;
- mode is not communicated by color alone;
- no mode chips appear in messages; task skill chips do.

### 11.5 Commands

Focused during implementation:

```bash
uv run pytest tests/app/test_skills.py tests/app/test_turns.py tests/app/test_run_turn.py
cd frontend && npm test -- \
  src/api/chat/config.test.ts \
  src/features/ai-composer/AiComposerRoute.test.tsx \
  src/features/ai-chat/AiChatPage.test.tsx \
  src/features/ai-chat/useTurnEngine.test.tsx \
  src/features/ai-chat/components/ChatComposer.test.tsx \
  src/features/ai-chat/components/ChatMessage.test.tsx \
  src/features/skill-picker/SkillPicker.test.tsx
```

Routine close-out:

```bash
uv run ruff check . && uv run mypy .
uv run pytest -m "not live_llm and not live_search and not live_db"
cd frontend && npm run typecheck && npm test
```

Run the focused behavior eval set/live LLM checks only after deterministic
contracts are green and with explicit cost awareness.

### 11.6 Manual browser scenarios

Verify at 1440px, 768px, 375px, and 200% zoom:

1. Default Focused appearance before typing.
2. Open, keyboard-navigate, select each mode, close, reopen, and verify state.
3. Open “More specialized skills…”, select School Comparison, edit/delete the
   mention, and verify the mode remains.
4. Select Guided and hold a multi-turn prose conversation: every assistant
   response provides value and asks at most one natural-language question; no
   clarify widget or parked turn appears.
5. Select Deep, send, steer while work is visible, and verify no skill error.
6. Trigger/retry a network failure and confirm the exact selected mode is used.
7. Regenerate an older response created under another mode; confirm the
   selector intentionally rewinds to that historical branch's mode and remains
   there after refresh.
8. Refresh, navigate between two chats with different modes, and use Back.
9. Test coarse pointer/touch, keyboard only, screen reader announcements, and
   `prefers-reduced-motion`.
10. Confirm the menu never clips under the composer, sidebar, viewport, or
    software-keyboard-safe area.
11. Fill both specialized skill slots, verify “More specialized skills…” is
    unavailable with an understandable limit state, remove one mention, and
    verify the action becomes available again.
12. Simulate missing/malformed `skill_modes` and confirm the old visible `@`
    button—not an empty toolbar gap—returns.

---

## 12. Acceptance criteria

### Product

- Exactly three descriptive modes are exposed: Focused Answer, Deep Research,
  Guided Counselor.
- Focused is the default; mode is sticky after the first persisted normal turn,
  and regeneration intentionally rewinds it with the restored history branch.
- Specialized skills remain available without competing with the primary mode.
- No second Quick/Think control appears beside the skill-backed selector.

### UI/UX

- Current mode is visible without opening anything.
- Choosing a mode takes at most two actions: open, select.
- The menu explains outcomes in student language, not implementation language.
- “More specialized skills…” cleanly hands off to the existing searchable
  picker; typed `@` remains intact.
- Desktop, 375px mobile, 200% zoom, keyboard, touch, screen reader, and reduced
  motion are usable and visually consistent.
- The control looks native to Counselle: quiet surfaces, existing tokens,
  restrained type, no decorative mode theming.

### Behavior

- Each normal request contains exactly one mode skill plus 0–2 task skills when
  valid mode config is available.
- Steering, legacy parked-continuation compatibility, retry, conflict recovery,
  regeneration, refresh, and session switching follow the lifecycle matrix.
- Guided asks one question at a time, adds value between questions, and
  converges through ordinary messages without claiming or invoking a clarify
  widget.
- Deep researches with available current tools and never falsely claims the
  deferred subsystem.
- Focused remains direct even when the question could be expanded.

### Engineering

- No counseling-mode DB migration, endpoint field, agent runtime, global store,
  or new UI dependency.
- Existing skill bodies are unchanged.
- Backend enforces mode exclusivity rather than trusting the UI.
- New config is additive and backward compatible.
- Mode state and mention-backed task-skill state are separate.
- Captured execution inputs are immutable across async lifecycle paths.
- No repetitive transcript mode chips.
- Focused tests, routine checks, and manual evidence pass before graduation.

---

## 13. File impact summary

### Add

- `skills/focused-answer/SKILL.md`
- `skills/deep-research/SKILL.md`
- `skills/guided-counselor/SKILL.md`
- `frontend/src/features/ai-composer/CounselingModeMenu.tsx`
- `frontend/src/features/ai-composer/counseling-mode.ts`
- focused component/helper tests where existing colocated conventions call for
  them

### Modify

- `app/skills.py`
- `api/routes/config.py`
- `config/assets/prompts/counselor.md`
- `tests/app/test_skills.py`
- focused existing API/turn tests only where required
- `frontend/src/api/chat/types.ts`
- `frontend/src/api/chat/config.ts`
- `frontend/src/features/ai-composer/AiComposer.tsx`
- `frontend/src/features/ai-composer/AiComposerRoute.tsx`
- `frontend/src/features/ai-composer/SourcesMenu.tsx` only for a justified local
  shared style extraction
- `frontend/src/features/ai-chat/AiChatPage.tsx`
- `frontend/src/features/ai-chat/useChatSession.ts` only if hydrated attach
  context is required for pre-refresh queued steering
- `frontend/src/features/ai-chat/useTurnEngine.ts`
- `frontend/src/features/ai-chat/components/ChatComposer.tsx`
- `frontend/src/features/ai-chat/components/ChatMessage.tsx`
- focused frontend tests for the touched behavior
- living docs/ADR index only after verified implementation

### Deliberately do not modify

- existing skill bodies;
- database migrations/session schema for counseling modes;
- PydanticAI/LangGraph topology;
- turn persistence/backend resume modules unless a focused test proves a real
  missing contract;
- `app/graph.py`, `app/clarify.py`, or `app/transcript.py`; Guided is prose-only
  and this feature does not expand the legacy parked-clarification surface;
- source-selection semantics;
- auth/authz, DB tools, evidence rendering, workspace features;
- Quick/Think implementation as an incidental side effect.

---

## 14. Complexity and risk assessment

Overall complexity: **medium-high**, driven by lifecycle correctness rather
than component complexity.

| Risk | Level | Control |
|---|---|---|
| Sticky mode breaks active steering | High | separate mode/task inputs; text-only live steer; lifecycle tests |
| Guided conflicts with Direct Answer system rule | High | narrow trusted-mode precedence sentence; evals |
| Guided accidentally relies on an unmounted clarify tool | High | prose-only skill/prompt/evals; no graph/tool changes |
| Retry/regenerate use changing selector state | High | immutable retry snapshot; regenerate deliberately rewinds selector with branch |
| Quick/Think creates duplicate/confusing controls | High | Phase 0 product gate; distinct names/wire keys; no second composer control |
| Mention cleanup deletes mode | High | separate React state; merge only at send boundary |
| Malformed optional config disables chat | Medium | independent defensive parsers and graceful hiding |
| Mode UI crowds mobile composer | Medium | replace `@` trigger; progressive disclosure; 375px/200% review |
| Closing mode menu steals focus back from `@` picker | Medium | controlled close/deferred handoff; final-focus integration test |
| Conflicting modes submitted outside UI | Medium | backend selection-group validation |
| Repetitive mode chips create transcript noise | Medium | presentation filtering only; retain historical data |
| Deep mode overpromises deferred research | Medium | skill explicitly limited to current tools; eval copy |
| Broad composer refactor introduces regressions | Medium | shared menu/helpers only; keep composers separate |

The implementation is complete only when the high-risk lifecycle paths are
proven, not when the menu renders.

---

## 15. Owner confirmation required

Before implementation, confirm:

1. The three skills-backed modes are the sole primary composer mode control.
2. Quick/Think will not add a second adjacent composer selector.
3. Mode is sticky after the first persisted normal turn; regeneration rewinds
   the selected mode with the restored historical branch.
4. The visible `@` toolbar button is replaced by the labeled mode selector,
   while `@` remains available through typing and “More specialized skills…”.
5. One mode reserves one of the existing three selected-skill slots.
6. Guided Counselor asks through ordinary prose only; this feature does not
   mount or advertise the clarification widget.

After confirmation, implement phase by phase and stop at each gate if the
captured contract fails. Do not silently change these decisions during coding.
