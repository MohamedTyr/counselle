# Reveal DB Provenance Toggle Plan

## Status

Draft plan. Do not move to `specs/` until implemented, verified, and accepted.

Branch: `investigate-db-sources-button`

## Problem

The action-row button `Show what's from Counselle` is missing on answers where
Counselle database content appears in rendered artifacts, especially comparison
tables and stat blocks.

The current implementation treats the button as a prose-only affordance:

- `MessageRender` shows `RevealDbToggle` only when
  `dbIndicesForMessage(msg).size > 0`.
- `dbIndicesForMessage` only finds prose `[n]` markers that resolve to DB
  sources (`cds`, `ipeds`, `scorecard`).
- Viz cards render DB values from `CitationEnvelope`s, but they do not produce
  prose `[n]` markers and they do not react to the reveal state.

So a response can genuinely use DB data and still hide the reveal button.

The user-facing intent is broader:

> `Show what's from Counselle` should act like an alternate citation mode. When
> toggled, it should visibly mark every final-answer thing that came from our DB.

That means:

- DB-backed prose claims should highlight.
- DB-backed table/stat-card values should highlight.
- External web/.edu/Reddit claims must not highlight.
- Unavailable values must not highlight.
- Failed DB/viz attempts must not highlight.
- Historical/cumulative `sources` entries from prior turns must not cause the
  current message to look DB-backed.

## Current Behavior

### Relevant Files

- `frontend/src/vendor/librechat/app/components/Chat/Messages/ui/MessageRender.tsx`
  owns the action row and the reveal toggle gate.
- `frontend/src/components/citations/RevealDbToggle.tsx` renders the button.
- `frontend/src/components/citations/RevealStateContext.tsx` stores the
  per-message `revealed` state.
- `frontend/src/components/citations/remarkCitations.ts` finds citation markers
  and currently exposes `dbIndicesForMessage`.
- `frontend/src/components/citations/remarkDbSpans.ts` wraps cited prose clauses
  into `db-claim` nodes.
- `frontend/src/components/citations/DbClaim.tsx` decides whether a prose
  `db-claim` actually highlights.
- `frontend/src/components/cards/ComparisonTableCard.tsx` renders comparison
  table values from `CitationEnvelope`s.
- `frontend/src/components/cards/StatBlockCard.tsx` renders stat-card values
  from `CitationEnvelope`s.
- `frontend/src/components/cards/VizCard.tsx` dispatches known card types and
  renders the unknown-card fallback.

### Current Reveal Gate

Current gate in `MessageRender`:

```ts
const showRevealToggle = useMemo(
  () => !!msg && !isUser && dbIndicesForMessage(msg).size > 0,
  [isUser, msg],
);
```

This is too narrow. It only means:

> This assistant message has at least one prose citation marker whose source is
> DB-backed.

It does not mean:

> This assistant message contains visible DB-backed content.

### Current Prose Path

The markdown pipeline is:

1. `remarkCitations` turns `[n]` text into `citationRef` nodes.
2. `remarkDbSpans` wraps the preceding clause before each `citationRef`.
3. `DbClaim` highlights only if reveal is on and source `n` is DB-backed.
4. `InlineCitation` renders DB citations as `null`, so DB markers are hidden
   while still available to the reveal pipeline.

This path is basically correct for DB-cited prose. It should not be broadened by
guessing from nearby text.

### Current Viz Path

The card path is:

1. Backend emits `viz` events with `RenderSpec`.
2. Each rendered value is a `CitationEnvelope`.
3. `CitationEnvelope.citation.source` says whether the value is `cds`, `ipeds`,
   `scorecard`, `web`, `edu`, or `reddit`.
4. Cards display source tags/popovers, but do not read `RevealStateContext`.

This path has the exact provenance needed, but reveal currently ignores it.

## Required Product Contract

The toggle is an alternate citation/provenance mode for the final answer.

When off:

- The answer remains calm.
- DB inline markers stay hidden.
- Cards keep their normal source tags/popovers.

When on:

- Every DB-backed prose span that can be mapped to a DB citation marker gets the
  reveal wash.
- Every rendered DB-backed card value gets the reveal wash.
- Non-DB prose and non-DB card values stay unchanged.
- Unavailable values stay unchanged.
- The button label changes to `Hide`, as it already does.

The toggle should show only when there is something visible and truthful to
reveal in this message.

## Non-Negotiable Honesty Rules

1. Do not highlight external prose as DB-backed.
2. Do not infer current-message DB usage from cumulative `message.sources`.
3. Do not highlight failed DB/tool/viz attempts.
4. Do not highlight unavailable cells.
5. Do not highlight card cells whose envelope source is `web`, `edu`, or
   `reddit`.
6. Do not use raw step details like `field_keys` or `row_count` in
   student-facing provenance.
7. Do not use loose text heuristics to guess whether prose came from the DB.
8. Preserve the existing hardening behavior where `remarkDbSpans` bounds DB
   prose claims at citation and sentence boundaries.

## Important Limitation

Frontend can only reveal DB-backed prose if the prose carries a hidden DB
citation marker.

Example:

```md
MIT's acceptance rate is 4.6% [1].
```

If `[1]` resolves to `scorecard`, `DbClaim` can highlight the sentence while
`InlineCitation` hides the DB citation chip.

But if the model writes:

```md
MIT's acceptance rate is 4.6%.
```

there is no reliable frontend signal that this sentence came from the DB.

Therefore, fixing this feature end-to-end has two parts:

1. Rendering: highlight DB-backed prose and DB-backed card cells.
2. Generation discipline: ensure DB-derived prose claims include hidden DB
   citation markers.

## Proposed Architecture

Add one small frontend provenance helper and one passive reveal wrapper.

### New Helper: `dbReveal.ts`

Create:

```txt
frontend/src/components/citations/dbReveal.ts
```

Responsibilities:

- Decide whether a cell is revealable DB content.
- Enumerate only cells that are actually rendered by a given card type.
- Decide whether a message has revealable DB-backed content.
- Keep reveal eligibility separate from the broader sources-panel
  `usedDbData()` concept.

Suggested API:

```ts
import type { ChatMessage } from '@/app/ChatContext';
import type { CitationEnvelope, RenderSpec } from '@/api/protocol';

export function isRevealableDbCell(cell: CitationEnvelope | undefined): boolean;

export function renderedCellsForSpec(spec: RenderSpec): Array<CitationEnvelope | undefined>;

export function hasDbVizCells(message: Pick<ChatMessage, 'content'>): boolean;

export function hasDbCitedProse(
  message: Pick<ChatMessage, 'content' | 'text' | 'sources'>,
): boolean;

export function hasRevealableDbContent(
  message: Pick<ChatMessage, 'content' | 'text' | 'sources'>,
): boolean;
```

Rules:

- `isRevealableDbCell(cell)` returns true only when:
  - `cell` exists,
  - `cell.available === true`,
  - `isDbSource(cell.citation.source)` is true.
- `renderedCellsForSpec(spec)` must use `spec.rows ?? []` to preserve the
  existing malformed-spec resilience.
- `stat_block` returns only `row.cells[0]` for each row, because that is all
  `StatBlockCard` renders.
- `comparison_table` returns `row.cells[col]` only for rendered school columns:
  `col < spec.schools.length`.
- Unknown/fallback types return only `row.cells[0]`, because the fallback card
  visibly renders only that value.
- `hasDbCitedProse(message)` delegates to `dbIndicesForMessage(message).size > 0`.
- `hasRevealableDbContent(message)` is:

```ts
hasDbCitedProse(message) || hasDbVizCells(message)
```

Do not use:

```ts
message.sources?.some((s) => isDbSource(s.citation.source))
```

as a standalone reveal signal. `sources` can be cumulative.

### Shared Reveal Style

Extract the existing wash class from `DbClaim.tsx` into:

```txt
frontend/src/components/citations/revealStyles.ts
```

Suggested export:

```ts
export const DB_REVEAL_WASH_CLASS = '...';
```

Then update `DbClaim.tsx` to consume that shared constant.

Reason: prose reveal and card reveal should not drift visually.

### New Passive Wrapper: `DbRevealValue`

Create:

```txt
frontend/src/components/citations/DbRevealValue.tsx
```

Responsibilities:

- Read `revealed` from `RevealStateContext`.
- Decide whether a given cell should currently be revealed.
- Add reveal styling and test attributes.

Constraints:

- Passive wrapper only.
- Use `span` or `div`, depending on local layout needs.
- No button.
- No popover.
- No focus handling.
- No hover behavior.
- Must not create nested interactive controls around existing popover triggers.

Suggested props:

```ts
type DbRevealValueProps = {
  cell: CitationEnvelope | undefined;
  children: ReactNode;
  className?: string;
};
```

Behavior:

- Always render children.
- Add `data-db-viz-cell=""` when wrapping an available rendered value cell.
- Add `data-revealed=""` only when:

```ts
revealed && isRevealableDbCell(cell)
```

- Apply `DB_REVEAL_WASH_CLASS` only under the same condition.

## UI Rendering Changes

### `MessageRender.tsx`

Replace the current reveal-toggle gate with a settled, revealable-content gate.

Important: match `MessageSources` settled behavior.

Suggested shape:

```ts
const isSettled =
  msg?.turnStatus === 'complete' || msg?.turnStatus === 'cancelled';

const showRevealToggle = useMemo(
  () => !!msg && !isUser && isSettled && hasRevealableDbContent(msg),
  [isUser, isSettled, msg],
);
```

Keep existing behavior where the action row does not render during active
submitting state because `PlaceholderRow` is shown.

The toggle should not show for:

- user messages,
- active latest submitting messages,
- `awaiting_input`,
- error turns,
- messages with only external rendered content,
- messages with only unavailable DB cells,
- messages that only have historical DB entries in `sources`.

### `ComparisonTableCard.tsx`

Current rendered value:

```tsx
<span className={VALUE_TEXT_CLASS}>{cell.display}</span>
```

Wrap the rendered value/stack for available cells:

```tsx
<DbRevealValue cell={cell}>
  <span className={VALUE_TEXT_CLASS}>{cell.display}</span>
</DbRevealValue>
```

Do not wrap `NotAvailableValue`.

Keep `CitationPopover` and `SourceTag` unchanged.

If wrapping only the value span looks too subtle in dense tables, wrap the
value-plus-source stack in a passive `div`. The wrapper must remain non-
interactive.

### `StatBlockCard.tsx`

Current paths:

- Dejargon mode uses `DejargonValue`.
- Non-dejargon mode renders value plus `CitationPopover`/`SourceTag`.

Wrap the rendered available value in both modes with `DbRevealValue`.

Be careful with `DejargonValue`: it may render a button when there is a caveat.
`DbRevealValue` must remain passive so it does not create illegal nested
interactive behavior.

Do not wrap `NotAvailableValue`.

### `VizCard.tsx` Fallback

The fallback card visibly renders `row.cells[0]`.

Make the fallback reveal-aware by wrapping that visible fallback value with
`DbRevealValue`.

This keeps eligibility aligned with rendering for unknown/future card types.

### `StatBlockCard` Verified Badge

There is an existing honesty issue:

```tsx
const verified =
  dejargon && !isPanel ? <CounselleVerifiedBadge ... /> : null;
```

If mixed-source stat blocks ever exist, that badge claims the whole card is
verified Counselle data even when some rows are external.

Fix while touching this file.

New rule:

Show `CounselleVerifiedBadge` only when:

- `dejargon === true`,
- `isPanel === false`,
- there is at least one available rendered stat cell,
- every available rendered stat cell is DB-sourced.

For normal DB-generated stat blocks, behavior stays the same.

For mixed or external stat blocks, the badge disappears.

For all-unavailable stat blocks, the badge disappears.

## Backend / Agent Generation Discipline

The frontend cannot reveal DB-backed prose unless DB prose carries hidden DB
markers. To make this feature work from start to end, the agent must preserve DB
provenance when it turns DB facts into prose.

### Required Behavior

When the final prose states a DB-derived fact, it must include a citation marker
whose source resolves to DB.

Good:

```md
MIT's acceptance rate is 4.6% [1].
```

If `[1]` is `scorecard`, the visible DB citation chip remains hidden, but the
reveal toggle can highlight the clause.

Bad:

```md
MIT's acceptance rate is 4.6%.
```

No marker means no reliable reveal.

### What To Inspect

Inspect:

- `app/prompt.py`
- agent instructions or system prompt text that governs citations
- tests under `tests/app/` that assert citation/source behavior
- eval expectations that check DB citation use

### Likely Prompt Change

Add or tighten instruction language:

```txt
When you state a fact derived from Counselle database tools in prose, attach the
matching source marker even if the UI hides DB citation chips. Do not omit DB
markers from DB-derived prose. Do not attach DB markers to external web/.edu/
Reddit claims.
```

Need to keep this separate from card values:

- Card/table values already carry `CitationEnvelope`s.
- Prose that summarizes or interprets those values still needs hidden markers if
  it repeats specific DB facts.

### Backend Tests / Evals

Add or update tests only where feasible without live LLM dependence:

- If prompt text is tested, assert the DB-marker discipline appears in the
  rendered prompt.
- If there are deterministic fake-agent tests around sources/prose, add a case
  where DB source markers survive into final answer text.
- Add an eval expectation or scorer note only if the eval harness already checks
  DB citation discipline.

Do not add a brittle live LLM test just for this bug.

## Test Plan

### Helper Tests

Create:

```txt
frontend/src/components/citations/__tests__/dbReveal.test.tsx
```

Test cases:

1. `hasRevealableDbContent` is true for a viz-only `comparison_table` with a
   rendered available DB cell and no DB prose citation.
2. True for DB-cited prose.
3. False for external-only prose.
4. False for a viz with only external rendered cells.
5. False for unavailable DB cells.
6. False when `message.sources` contains a DB source from history but current
   message has no DB-cited prose and no DB-backed rendered viz cell.
7. False for hidden extra raw DB cells beyond rendered school columns.
8. True for unknown/fallback specs only when `row.cells[0]` is a revealable DB
   cell.
9. Does not throw when `rows` is missing.
10. Does not throw when `schools` is missing or empty in malformed specs.

### Card Reveal Tests

Add to `frontend/src/components/cards/__tests__/honesty.test.tsx` or create a
focused card reveal test.

Test cases:

1. With `RevealStateProvider({ revealed: true })`, DB comparison cells get
   `data-revealed`.
2. External comparison cells do not get `data-revealed`.
3. Unavailable cells do not get `data-revealed`.
4. With `revealed: false`, no card cells get `data-revealed`.
5. Stat block DB value gets `data-revealed` in non-dejargon mode.
6. Stat block DB value gets `data-revealed` in dejargon mode.
7. Unknown/fallback card DB value gets `data-revealed`.
8. Source tags and citation popovers still render.
9. No nested interactive warning is introduced by wrapping `DejargonValue`.

### Stat Badge Tests

Test cases:

1. Badge appears for inline dejargon stat block with at least one available
   rendered cell and all available cells DB-sourced.
2. Badge does not appear for mixed DB/external available rows.
3. Badge does not appear for all-external rows.
4. Badge does not appear for all-unavailable rows.
5. Badge does not appear in panel variant, preserving current behavior.

### `MessageRender` Regression Tests

Add a render-level test near existing vendored message tests, or create a
focused test file that renders `MessageRender` with required providers/mocks.

Test cases:

1. Completed assistant message with viz-only available DB cell shows
   `Show what's from Counselle`.
2. Clicking it changes label to `Hide` and DB card cells get `data-revealed`.
3. Completed assistant message with external-only prose hides the toggle.
4. Completed assistant message with unavailable-only DB viz hides the toggle.
5. Latest submitting assistant message hides the toggle because the action row is
   replaced by `PlaceholderRow`.
6. `awaiting_input` assistant message hides the toggle.
7. Error turn hides the toggle.
8. Message whose `sources` contains historical DB entries but whose current
   content is external-only hides the toggle.

### Existing Tests That Should Stay Green

These should not be weakened:

- `frontend/src/components/citations/__tests__/dbIndices.test.tsx`
- `frontend/src/components/citations/__tests__/remarkDbSpans.test.tsx`
- `frontend/src/components/citations/__tests__/dbClaim.test.tsx`
- `frontend/src/components/citations/__tests__/messageSources.test.tsx`
- `frontend/src/components/cards/__tests__/honesty.test.tsx`
- `frontend/src/components/cards/VizCard.test.tsx`

## Verification Commands

Run targeted frontend tests:

```bash
cd frontend && npm test -- --run src/components/citations src/components/cards
```

Run the new `MessageRender` regression test explicitly if it is outside those
folders.

Run typecheck:

```bash
cd frontend && npm run typecheck
```

If prompt/backend wording changes are made, also run routine backend tests:

```bash
uv run pytest -m "not live_llm and not live_search and not live_db"
```

## Implementation Order

Use TDD.

1. Add failing `dbReveal` helper tests.
2. Implement `dbReveal.ts`.
3. Add failing card reveal tests.
4. Extract shared reveal style and add `DbRevealValue`.
5. Wire cards.
6. Add stat badge tests.
7. Fix stat badge gate.
8. Add failing `MessageRender` regression tests.
9. Update `MessageRender` gate.
10. Inspect/update agent prompt for DB-marker discipline.
11. Add any prompt/backend tests that are practical without live LLM.
12. Run targeted frontend tests.
13. Run frontend typecheck.
14. Run backend routine tests if backend prompt/tests changed.

## Acceptance Criteria

The feature is fixed only when all of these are true:

- A DB-backed comparison table answer with no DB prose citation shows
  `Show what's from Counselle`.
- Toggling it visibly highlights DB-backed table cells.
- DB-backed stat-card values highlight.
- DB-backed prose claims highlight when they carry hidden DB source markers.
- External web/.edu/Reddit prose does not highlight.
- External card cells do not highlight.
- Unavailable values do not highlight.
- Historical/cumulative DB sources do not trigger reveal on unrelated current
  messages.
- `awaiting_input`, active submitting, and error states do not show the toggle.
- Stat-block verified badge does not claim mixed/external stat blocks are fully
  Counselle-verified.
- Existing source panel behavior still works.
- Existing citation popovers still work.
- Frontend tests and typecheck pass.
- Any backend prompt change is covered by a non-live test where practical.

## Out Of Scope

- Threading reveal state into expanded artifact panels. Artifact panels currently
  store only the spec and render outside the message's `RevealStateProvider`.
  Making panel reveal mirror message reveal requires a separate state/threading
  decision.
- Rewriting the citation protocol.
- Adding live LLM tests.
- Changing the visual design of the reveal button.
- Revealing DB activity timeline steps. This feature is about final-answer
  content provenance, not work-visibility events.

