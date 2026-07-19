# Plan: polish visible school-data tool calls

**Status:** Implemented and verified  
**Date:** 2026-07-19  
**Surface:** AI chat chronological activity trace  
**Scope:** `resolve_school`, `get_school_profile`, `get_domain`

## 1. Outcome

Turn the three official school-data calls into quiet, production-grade activity rows that
show useful progress without reading like a debugger. A student should understand what
Counselle is doing in one glance, trust that the work happened, and then return attention
to the answer.

The target is not a richer card. It is less interface, executed precisely:

```text
▸ Thought

  ✓  Found Yale University
  ✓  Read Yale University’s admissions data                 72 values
```

During execution, the same row remains in place and changes state:

```text
  ◌  Finding “Yale”…
  ◌  Reading Yale University’s admissions data…
```

## 2. Product and visual direction

- **User:** a student comparing schools in a high-stakes, repeated-use workflow.
- **Primary job:** confirm that Counselle is reading the right school data without making
  the student inspect implementation details.
- **Color strategy:** Restrained. Existing dark workspace neutrals; semantic red only for
  true failures. Completed work is deliberately not bright green.
- **Scene:** a focused student reviews an answer on a laptop in a dim study environment;
  the trace should be legible when inspected and nearly disappear when ignored.
- **Anchors:** Linear activity rows for density, Raycast for state clarity, and Notion for
  calm typography. Counselle keeps its own warmer dark tokens and admissions voice.
- **Fidelity:** production-ready, responsive, keyboard/screen-reader complete, and polished
  until it can ship.
- **Anti-goals:** no cards, pills, timeline rails, decorative glow, success confetti,
  raw JSON, tool names, durations, duplicate school chips, or permanent `Details` rows.

## 3. Scope boundary

### Included now

- `resolve_school`
- `get_school_profile`
- `get_domain`
- Hiding the internal `read_tool_result` activity from the public trace
- Start, success, zero-result/unavailable, and error states
- Live-stream and stored-transcript rendering
- Focused tests and visual verification

### Explicitly deferred

- `query_database`
- Workspace reads and all workspace mutations
- Tavily web, school-site, and Reddit searches
- `load_skill`, `render_viz`, and `write_plan`
- Redesigning Thought, narration, answers, citations, or source panels
- Grouping multiple calls into a synthetic parent activity

The generic tool renderer remains intact for every deferred tool.

## 4. Visual specification

### 4.1 Anatomy

Each call is one borderless row with three columns:

```text
[14px status] [student-facing label, minmax(0, 1fr)] [optional metadata]
```

- Row padding: `4px 0`; minimum visual height around `28px`.
- Icon-to-label gap: `10px`.
- Adjacent tool rows: `4–6px` of vertical rhythm, inherited from the chronological stream.
- Label: Geist, `13px`, `20px` line height, regular/medium only where state needs it.
- Metadata: `12px`, tabular numerals, muted foreground, never allowed to dominate the verb.
- No background, border, radius, shadow, badge, or source chip.
- Long labels wrap; metadata stays intact and moves beneath the label when width is tight
  instead of squeezing it. No horizontal overflow at 320–375px.

Use existing semantic tokens from `frontend/src/index.css`; do not add raw colors or a new
tool-specific palette.

### 4.2 Status icons

Use the existing Lucide vocabulary at `14px`, consistent stroke weight:

- **Running:** `LoaderCircle`, rotating only while the turn is genuinely live.
- **Complete:** bare `Check`, in muted foreground—not a filled circle and not green.
- **Unavailable / zero result:** `CircleMinus` or `SearchX`, paired with explicit copy.
- **Error:** `CircleAlert` or `X`, using the existing destructive token.

The icon never carries meaning alone; the label also changes tense/state.

### 4.3 Motion

- Keep the React key stable so the start row settles in place rather than remounting.
- Crossfade icon and color over roughly `160–180ms` with ease-out; no translation or scale.
- The spinner is the only continuous motion. Do not pulse the whole row.
- Under `prefers-reduced-motion: reduce`, show a static partial-circle running icon and make
  the text carry the active state.
- State changes must not alter row height or shift surrounding content.

## 5. Exact content behavior

Presentation copy is derived from typed `StepData`, never parsed from the current English
label and never from raw tool output.

### `resolve_school`

| State | Visible row | Metadata |
|---|---|---|
| Running | `Finding “Yale”…` | none |
| One match | `Found Yale University` | none |
| Multiple matches | `Found possible matches for “Yale”` | `3 matches` |
| No match | `No school found for “Yale”` | none |
| Error | `Couldn’t search the school database` | none |

Candidate names stay out of the trace; the agent’s clarification is the correct place to
present them. A valid zero-result state is neutral, not a red failure.

### `get_school_profile`

| State | Visible row | Metadata |
|---|---|---|
| Running | `Reading Yale University’s profile…` | none |
| Complete | `Read Yale University’s profile` | `18 values` when known |
| No available values | `Profile data unavailable for Yale University` | none |
| Error | `Couldn’t read Yale University’s profile` | none |

### `get_domain`

| State | Visible row | Metadata |
|---|---|---|
| Running | `Reading Yale University’s admissions data…` | none |
| Complete | `Read Yale University’s admissions data` | `72 values` |
| No available values | `No admissions data available for Yale University` | none |
| Error | `Couldn’t read Yale University’s admissions data` | none |

Domain ids are converted to readable labels (`financial_aid` → `financial aid`) without a
hardcoded domain inventory. Counts use locale-aware formatting and singular/plural grammar.

## 6. Interaction model

- The normal row is not interactive. It has no fake affordance and no hover decoration.
- Do not show `Details` when the row already contains every useful public fact.
- Do not render school source chips under these three calls. The answer’s citation/source
  surfaces remain the provenance owner.
- Errors may add one short, wrapped recovery line only when the backend supplied a safe,
  actionable error. No raw exception strings.
- The surrounding chat log remains the scroll and announcement surface; do not create a
  nested scroll region or an independently focusable row.
- Give the changing row `aria-live="polite"` and `aria-atomic="true"`; icons are decorative
  and `aria-hidden`, so assistive technology hears the complete state sentence once.

## 7. Internal overflow behavior

`read_tool_result` is model/runtime plumbing, not student activity. Mark it `visible: false`
in `config/assets/step_labels.yaml`, carry that flag through the frozen `ToolSpec`, and have
the step router suppress its public start/end/error events. Leave the actual tool call,
result retrieval, model history, overflow store, and usage accounting untouched.

This must produce:

```text
◌  Reading Yale University’s admissions data…
✓  Read Yale University’s admissions data                      72 values
```

Never:

```text
✓  Read Yale University’s admissions data
●  Reading an oversized tool result
```

Hiding it only in React is insufficient: it must not briefly flash during streaming or be
persisted into new transcripts. Add a small frontend compatibility guard as well so old
stored transcripts containing `read_tool_result` also render nothing.

## 8. Implementation plan

### Phase 1 — Public event cleanup

1. Add `visible: bool = true` to the frozen `ToolSpec` and read the optional value from the
   labels asset.
2. Mark only `read_tool_result` as `visible: false`; keep `ask_student` on its existing
   interrupt-specific exclusion path.
3. Let the router skip invisible tools before opening a public step. Its result then follows
   the existing unmatched-result path without changing actual tool execution.
4. Update focused router/run-turn expectations: the overflow read still occurs and counts
   toward usage, but emits and persists no public step.

### Phase 2 — Stable tool identity

1. Add an optional top-level `tool` identifier to `StepData` and emit it on both start and
   terminal events. This is safe presentation identity, not raw arguments or output.
2. Extend the frontend type and SSE validation/fixtures. Keep it optional so protocol v1 and
   stored transcripts remain backward-compatible; no protocol version bump.
3. Resolve identity as `step.tool ?? step.detail?.tool` in the frontend. The fallback lets
   settled historical rows use the new renderer; start rows without identity use the generic
   renderer rather than guessing from prose.

### Phase 3 — Focused presentation model

1. Add a small pure presentation helper beside the chat components that accepts `StepData`
   and returns an immutable view model: visual state, label, optional metadata, and optional
   safe error line.
2. Allowlist exactly `resolve_school`, `get_school_profile`, and `get_domain`.
3. Return `null` for incomplete legacy data, unknown tools, or any event that cannot be
   presented truthfully; the caller then uses the existing generic widget.
4. Keep domain-label humanization generic; do not hardcode the manifest’s domain ids.

### Phase 4 — Dedicated row component

1. Add a focused `SchoolDataToolRow` component rather than expanding the already-broad
   generic widget.
2. Route only the three target tools/family to it from `ToolWidgets.tsx`.
3. Reuse Lucide icons and existing typography/color tokens.
4. Keep `DefaultToolWidget`, search source chips, workspace widgets, and the registered
   `task_added` widget behavior unchanged.
5. Remove `Details` and source-chip rendering only from the new school-data row, not from
   the generic renderer.

### Phase 5 — Product copy

1. Keep the editorial voice in `config/assets/step_labels.yaml`. Extend the three target
   rows with state-aware templates rather than scattering literal status copy through JSX.
2. Tighten the running templates:
   - `Finding “{query}”…`
   - `Reading {school}'s profile…`
   - `Reading {school}'s {category} data…`
3. Add completed, ambiguous/unavailable, and error templates matching §5. Let `StepMapper`
   choose the terminal label from safe receipt data (`result_count`, canonical school names,
   `value_count`, and `domain_id`). The frontend owns layout and metadata, not product voice.
4. Verify curly apostrophes/quotes render correctly and long school names wrap cleanly.

### Phase 6 — Verification and polish loop

1. Add focused component tests for all rows in §5, including singular/plural counts,
   long names, legacy fallback, and the absence of `Details`, source chips, and tool jargon.
2. Add parameterized mapper/router tests for stable identity and state-aware copy across the
   three tools.
3. Add the backend regression that proves `read_tool_result` executes without emitting or
   persisting a public step, plus the frontend guard for historical overflow rows.
4. Run frontend typecheck/tests and the routine backend suite relevant to steps/protocol.
5. Exercise a real or fixture-driven live turn so start → end replacement is verified, not
   merely static end-state rendering.
6. Capture screenshots in `artifacts/` at 375px and the normal desktop chat width, including
   running, complete, unavailable, and error states.
7. Check keyboard traversal, screen-reader names, 200% zoom, reduced motion, contrast, and
   no layout shift.
8. Perform a final design review against the screenshot that motivated this work. Do not
   ship until the trace feels quieter than the answer and every repeated/debug-only element
   is gone.

## 9. Files expected to change

- `app/steps.py`
- `app/tool_specs.py`
- `config/assets/step_labels.yaml`
- `domain/events.py`
- `frontend/src/api/chat/types.ts`
- Frontend SSE validation and protocol fixtures
- `frontend/src/features/ai-chat/components/ToolWidgets.tsx`
- `frontend/src/features/ai-chat/components/SchoolDataToolRow.tsx` (new)
- `frontend/src/features/ai-chat/school-data-tool-presentation.ts` (new, if extraction keeps
  the component focused)
- `frontend/src/features/ai-chat/components/AgentRunView.test.tsx`
- Focused backend step/run-turn tests that currently expect overflow steps

No database, agent prompt, agent tool schema, SSE version, or workspace code changes are
needed. The optional event field is an additive protocol-v1 extension.

## 10. Acceptance criteria

1. The three target calls render as one-line, borderless activity rows with stable geometry.
2. Running rows use active language and a restrained live indicator; completed rows settle
   to past tense with a quiet check.
3. Canonical school name, readable domain name, and authoritative available-value count are
   shown when known—never guessed.
4. Zero values read as unavailable data, not successful discovery and not a tool failure.
5. `read_tool_result`, raw tool names, duration, `Schools:`, `Domain:`, `Details`, and duplicate
   school chips never appear for the target flow.
6. Tavily, workspace, visualization, plan, skill, and unknown tool rendering is unchanged.
7. The row is clean at 320–375px, desktop width, 200% zoom, and reduced motion.
8. WCAG AA contrast and non-color status cues are preserved.
9. Focused frontend/backend tests, typecheck, lint, and the routine suite pass.
10. Final screenshots look deliberate and calm beside both Thought rows and the answer—not
    like a card, log viewer, or generic AI activity timeline.

## 11. Build and verification record

The approved plan shipped in five focused commits:

| Phase | Commit | Result |
|---|---|---|
| Public event cleanup | `fadfa36` | Hid `read_tool_result` from live and persisted public activity without changing tool execution or accounting. |
| Stable tool identity | `93bee41` | Added optional safe tool identity to step events, frontend types, validation, and fixtures. |
| Presentation model | `18415f5` | Added the allowlisted, immutable school-data presentation helper and state coverage. |
| Dedicated row | `4137e14` | Added `SchoolDataToolRow` and routed only the three school readers through it. |
| Product copy | `a197500` | Added asset-owned running and terminal copy selected from safe receipt data. |

The protocol remained version 1. The optional `tool` field was an additive,
backward-compatible extension, so no protocol bump was required.

Phase 6 verified the real reducer/message rendering path, concurrent starts, stable
start-to-terminal replacement, long names, unavailable and error states, reduced motion,
keyboard semantics, and 200% zoom. Evidence is retained under the gitignored
`artifacts/tool-row-verification-20260719/` directory.

Final verification evidence:

- Frontend post-final suite: 50 files and 586 tests passed; typecheck and lint passed.
- Focused backend school-tool suites: 238 tests passed.
- Routine backend suite: 1,301 tests passed and one unrelated, previously established
  prompt-content baseline assertion failed in
  `tests/app/test_skills.py::test_prompt_pins_ranking_columns_and_manifest_retry`.
- Ruff and mypy passed across the repository.
- Desktop, 375px, reduced-motion, and 200%-scale captures showed no overflow, layout shift,
  misleading status treatment, or accessibility regression.

The generic renderer and every deferred tool family remained outside this change.
