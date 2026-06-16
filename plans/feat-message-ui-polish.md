# Plan — Move `feat/message-ui-polish` preview UI into the real app

**Branch:** `feat/message-ui-polish`  ·  **Tier:** Large  ·  **Date:** 2026-06-16

## 1. Problem statement

On this branch we built a rich chat UI inside a **dev-only preview harness**
(`frontend/src/app/MessagePreview.tsx`, route `/message-preview`). The real chat
surface (`ChatView` → vendored LibreChat `MessagesView` → `MessageRender` →
`MessageContent` → `Markdown`) must render **pixel-identical** to that preview.

Four explorer passes established that the **structural surfaces already landed**
on this branch (sources strip in the action row, `SourcesPanel`/`SourcesSheet`
mounted in `ChatView`, `counselle-answer.css` imported globally and applied to
the assistant answer container, the `snippet` backend field wired end-to-end,
`MessageSources` glue). But the **behavioral core is net-new and 0% wired**: the
three context providers (dejargon / citation-activate / reveal), the `DbClaim`
decision logic, the `InlineCitation` swap, and the `activeIndex`/`dbSchools`
panel plumbing. The remaining work wires those into the live render path and the
one truthful envelope-derived feature (the reveal), then removes the code the
preview superseded.

**Non-goals:** redesigning any component; changing the agent graph; touching
auth, turn registry, or chat CRUD; altering the viz-card internals beyond the
two styling deltas already committed. We are **moving** an approved look into the
live path, not re-deciding it. The `MessagePreview.tsx` harness itself stays
(DEV-only) as the reference; it is not deleted by this work.

**Honesty carve-out (decided 2026-06-16):** the "Show what's from Counselle"
reveal toggle will be **built truthfully** — DB-grounded spans are derived from
the citation envelope (a sentence the model cited to a DB source IS "from
Counselle"), NOT from hand-authored `==…==` markers the live model never emits.
No fabricated highlights. See task 4.

## 2. Ordered task list (dependencies marked)

- **T1. `remarkDbSpans` clause-wrapping plugin** *(replaces the `==…==` hack;
  NEW file `remarkDbSpans.ts`, leave `remarkDbClaim.ts` untouched for the
  preview)* — a plain, **un-parameterized cached singleton** plugin that runs
  AFTER `remarkCitations` and operates on the `citationRef` nodes it produced
  (NOT on raw `[n]` text — that text is already consumed). For each `citationRef`,
  wrap the clause in its **immediately-preceding text sibling** (trimmed to the
  last `.?!` boundary within that sibling) into a `dbClaim` node carrying
  `hProperties.index = n`. Clause boundaries fall out of the mdast structure —
  any prior `citationRef` already splits the text, so the wrap can never reach
  across a different citation. No `dbIndices` needed at parse time.
  *(depends on: nothing; precedes T2, T4)*
- **T2. `markdownConfig.ts` rewire** *(cached singleton stays intact)* — swap
  `'citation-ref': CitationRefMarkdown` → `InlineCitationMarkdown` (drop the
  `CitationRefMarkdown` import); add `remarkDbSpans` to the cached
  `getRemarkPlugins()` array AFTER `remarkCitations`; register
  `'db-claim': DbClaim` in `getMarkdownComponents()`. **No `Markdown.tsx` /
  `MarkdownBlocks.tsx` changes** — the plugin is unconditional, so no per-message
  threading and no memo-comparator hazard. *(depends on T1)*
- **T3. `DbClaim` becomes the decision point** — change its signature to accept
  `index` (react-markdown forwards `hProperties.index`; the new `remarkDbSpans`
  node MUST carry `data.hProperties.index` — the preview's `remarkDbClaim` node
  shape lacks it). `DbClaim` reads `useSources()` + `useRevealDb()`:
  `const entry = sources.find(s => s.index === index)`. Highlight (wash class +
  hovercard) **iff** `entry !== undefined && isDbSource(entry.citation.source) &&
  revealed`. **Undefined (source not yet streamed) OR external ⇒ render children
  plainly** — never highlight an unresolved/external clause (honesty). Toggle is
  then a pure context re-render of `DbClaim` nodes — no markdown re-parse.
  *(depends on T1)*
- **T4. Panel state shape (atomic)** — change `sourcesPanelAtom` to
  `{ sources: SourceEntry[]; activeIndex: number | null; dbSchools: string[] } |
  null`; update `openSourcesPanelAtom`'s writer; update **all** call sites in the
  **same change** so typecheck stays green: `ChatView` (destructure
  `{sources, activeIndex, dbSchools}` and pass **all three** to both panels),
  `SourcesPanel`/`SourcesSheet` **and their internal `SourcesChrome`** (accept +
  forward `activeIndex`/`dbSchools` to `SourcesList`, which already accepts both),
  and `MessageSources` (new call shape). *(depends on: nothing; precedes T5, T7)*
- **T5. Per-message reveal state + providers** — own `revealed` as plain React
  state in `MessageRender` (`const [revealed, setRevealed] = useState(false)`),
  exposed to both its body and its `SubRow` via a small per-message
  `RevealStateContext` provider wrapping `MessageRender`'s return. (No Jotai
  `atomFamily` — it's deprecated in jotai v2.20 and would accumulate per-message
  atoms; `useState` re-renders `MessageRender` internally, bypassing its
  prop-only memo.) In `MessageContent`, wrap assistant-only content
  (`!isCreatedByUser`) in `DejargonProvider value={true}`,
  `CitationActivateProvider value={activate}`, and `RevealDbProvider value={{
  revealed, style: 'wash' }}` (reads `revealed` from `RevealStateContext`).
  `activate(entry)` sets the panel atom to `{ sources: cited, activeIndex:
  entry.index, dbSchools }`. *(depends on T2, T3, T4)*
- **T6. Reveal toggle in action row** — render `RevealDbToggle` in
  `MessageRender`'s `SubRow` **only when** `dbIndicesForMessage(msg).size > 0`
  (behavior 7 gate); `active`/`onToggle` come from `RevealStateContext`.
  *(depends on T5)*
- **T7. `MessageSources` — schools + strip split** — derive `dbSchools` via new
  `dbSchoolsForMessage(message)`: viz-block `spec.schools[].name` first; fall
  back to `schoolFromDbLabel(entry.label)` for DB sources **only when it returns
  non-null** (T8 hardens `schoolFromDbLabel` to return `null` when the label has
  no ` — ` separator, so a raw dataset string can never masquerade as a school).
  Pass **external-only** sources to `SourcesStrip` for the favicon set; add a new
  `displayCount?: number` prop to `SourcesStrip` (when present it overrides the
  internal `cited.length` for the `"{n} sources"` label) and have `MessageSources`
  pass `displaySourceCount(cited)` so the strip and the panel header **agree**
  (Counselle card counts as one). Pass the **full cited** set + `dbSchools` +
  `activeIndex: null` to `openSourcesPanelAtom`. *(depends on T4)*
- **T8. Dead-code removal** — delete `SourcesFooter.tsx`; delete `CitationRef.tsx`
  and remove the `CitationRefMarkdown` export + `CitationRef` import from
  `remarkCitations.ts` (do this AFTER T2 drops `markdownConfig.ts`'s import, so
  the build never breaks); remove the **entire `TierChip` component incl. its
  default export** (keep `tierLabel`/`tierWord`/`sourceDisplayName`/
  `isCommunityTier` utils — still used by `SourceTag`/`CitationPopover`); harden
  `schoolFromDbLabel` to return `null` with no ` — ` separator. Update
  `__tests__/citations.test.tsx`: drop the `SourcesFooter`/`CitationRef`/
  `CitationRefMarkdown`/`TierChip`-JSX cases, and **keep/relocate** a
  `remarkCitations` core test (so its `[n]`→`citation-ref` behavior stays
  covered after the swap). *(depends on T2, T3 verified)*
- **T9. Tests** — `remarkDbSpans` (clause boundary, marker-at-start, multiple
  markers/sentence, no-citation no-op); `DbClaim` DB-vs-external highlight gating;
  `dbIndicesForMessage`; `dbSchoolsForMessage` (viz path + label fallback +
  empty); strip externals-only; panel `activeIndex` scroll/flash. *(depends on
  all)*
- **T10. Build/lint/typecheck + live verify** — `npm run typecheck && npm test`,
  `uv run pytest -m "not live_llm and not live_search"`, ruff/mypy; then live
  E2E at :5173 comparing real chat vs `/message-preview`, both themes. *(depends
  on all)*

## 3. Behavior list (numbered, testable)

1. A `[n]` marker whose source is `cds|ipeds|scorecard` renders **nothing**
   inline in the live answer.
2. A `[n]` marker whose source is `web|edu|reddit` renders a `SourcePill`
   (favicon + friendly name) in the live answer.
3. Clicking a `SourcePill` opens the sources panel/sheet scrolled to that source
   (row gets the `source-flash` animation), via the `activeIndex` on the panel atom.
4. The sources strip in the action row shows **only external** sources' favicons
   (DB sources excluded), with the `"{n} sources"` count; the panel it opens
   still shows the Counselle card + externals.
5. Opening the panel shows the "Counselle data" card; its subline names schools
   when derivable (viz `spec.schools[].name`, else `schoolFromDbLabel`), and
   falls back to the generic truthful "…from our own college database." when not.
6. Source names render **dejargoned** in the live answer ("Counselle data", not
   "CDS 2025-26 (C1)") — `useDejargon()` returns `true` under each assistant msg;
   the panel still exposes real provenance (url, snippet, tier) per external row.
7. The reveal toggle appears in the action row **iff** `dbIndicesForMessage > 0`.
8. With reveal **on**, exactly the clauses a DB citation annotates highlight
   (`wash`); a clause backed by an external citation, or one whose source has not
   yet streamed (`entry === undefined`), does **not** highlight even if in the
   same sentence (clause boundary = preceding citation/sentence start). Hover
   shows "From Counselle's verified data". Off → clean prose.
9. No `[n]`, no `==`, and no raw `cds_c`/`IPEDS`/`adm2024` jargon is ever visible
   in a live answer.
10. User (human) message bubbles are unaffected (all providers + `counselle-answer`
    are `!isCreatedByUser`-gated).
11. `pytest` sources suite still green; `snippet` round-trips (already true).
12. Toggling reveal re-renders only `DbClaim` nodes (no markdown re-parse); a
    completed/streamed block reveals correctly (no stale memo).

## 4. Truthful reveal design (tasks T1 + T3 detail)

**Why operate on `citationRef`, not `[n]` text:** `remarkCitations`
(`splitTextNode`) replaces every `[n]` in `text` nodes with `citationRef` nodes
*before* our plugin runs. A text-scanning `remarkDbSpans` placed after it would
match nothing (the critical ordering bug). So `remarkDbSpans` walks parents and
keys off `citationRef` children.

**Why clause-level is truthful (not sentence-level):** after `remarkCitations`,
`"X. Y [1] and Z [2]."` is `text("X. Y ") · ref(1) · text(" and Z ") · ref(2) ·
text(".")`. Each `citationRef`'s preceding text sibling is already its own
clause — bounded on the left by any prior citation. We wrap only that preceding
sibling (further trimmed to the last `.?!` inside it, so `"X. Y "` → `"Y "`).
A clause backed by an external citation is wrapped too but `DbClaim` renders it
inert (not a DB source), so it never highlights. The highlighted set is exactly
the clauses the model attached a DB citation to — no over-claim. (Resolves the
honesty + ordering findings together; the granularity is structural, not regex.)

- **Decision point is `DbClaim` (React), not the plugin.** The plugin wraps every
  cited clause unconditionally and stamps `index`. `DbClaim` reads `useSources()`
  → `isDbSource(entry.source)` to decide if it *can* highlight, and `useRevealDb()`
  → `revealed` to decide if it *does*. So: the plugin is a plain cached singleton
  (no `dbIndices` param, no `Markdown.tsx`/`MarkdownBlocks` prop threading, no
  memo-comparator hazard), and the toggle is a context-driven CSS re-render of the
  `DbClaim` nodes only — never a markdown re-parse. Streamed/completed blocks
  reveal correctly because nothing about their parse changes.
- **`dbIndicesForMessage(message)`** (new selector in `remarkCitations.ts`, beside
  `citedIndexesForMessage`): unions the prose `[n]` indices ∩ DB sources. It MUST
  mirror `citedIndexesForMessage`'s exact scan path (content blocks + the `text`
  fallback) so the toggle's visibility is identical between streaming and
  completed states. Used ONLY for the action-row toggle visibility gate
  (behavior 7) — not in the parse.
- **Why not backend:** the envelope already carries the truth; deriving clauses
  client-side from `citationRef` position is KISS, needs no prompt/model change,
  and cannot fabricate (a clause lights up only if the model attached a DB
  citation to it). The `remarkDbClaim` author's own comment specifies this path.

## 5. Risk register

1. **Vendored-file drift** — `MessageContent.tsx`, `MessageRender.tsx`,
   `markdownConfig.ts` are pinned LibreChat (`197a1dc4`). (`Markdown.tsx`/
   `MarkdownBlocks.tsx` are now **untouched** — the singleton design avoids them.)
   Keep each change minimal, Counselle-namespaced, commented as an addition.
2. **Toggle re-render across the `MessageRender`/`MessageContent` boundary** —
   *Mitigation:* `revealed` is `useState` in `MessageRender`, shared to both its
   body (→ `MessageContent` → `RevealDbProvider`) and its `SubRow` (→
   `RevealDbToggle`) via a `RevealStateContext` wrapping `MessageRender`'s return.
   A `setState` re-renders `MessageRender` from the inside, so the prop-only memo
   (`areMessageRenderPropsEqual`) is irrelevant. No Jotai, no per-message atom
   accumulation, no deprecated `atomFamily`.
3. **Clause-boundary correctness** in `remarkDbSpans`. *Mitigation:* boundaries
   come from mdast structure (prior `citationRef` splits text) + a `.?!` trim;
   unit tests on marker-at-start, multiple markers/sentence, mixed DB+external in
   one sentence (only the DB clause highlights), and no-citation no-op.
4. **`sourcesPanelAtom` shape change** touches `state.ts`, `ChatView`,
   `SourcesPanel`, `SourcesSheet`, `MessageSources` (which currently calls
   `openSources(cited)` with a bare array). *Mitigation:* land T4 as ONE atomic
   change; typecheck gates it before T5/T7.
5. **Dead-code deletion breaks `citations.test.tsx`** (imports `CitationRef`,
   `CitationRefMarkdown`, `SourcesFooter`, `TierChip`). *Mitigation:* T8 updates
   that test file in the same step as the deletions; `npm test` is the gate.
6. **Honesty regression** — a reveal highlighting a non-DB clause would lie.
   *Mitigation:* `DbClaim` gates on `isDbSource`; clause boundary stops at the
   prior citation; behavior-8 test asserts external clauses never highlight.
7. **`dbSchools` empty for prose-only DB answers** (no viz block) — accepted
   trade-off: subline falls back to the truthful generic string; `schoolFromDbLabel`
   recovers names from DB source labels where present. Not a fabrication.

## 6. File change manifest

**Modify**
- `frontend/src/vendor/.../Content/markdownConfig.ts` — `citation-ref` →
  `InlineCitationMarkdown`; add `remarkDbSpans` to cached `getRemarkPlugins()`;
  add `'db-claim': DbClaim`; drop `CitationRefMarkdown` import.
- `frontend/src/vendor/.../Content/MessageContent.tsx` — `DejargonProvider` +
  `CitationActivateProvider` + `RevealDbProvider` (reads `revealed` from
  `RevealStateContext`), all `!isCreatedByUser`.
- `frontend/src/vendor/.../ui/MessageRender.tsx` — own `revealed` `useState`;
  wrap return in `RevealStateContext.Provider`; `RevealDbToggle` in `SubRow`
  gated on `dbIndicesForMessage(msg).size > 0`.
- `frontend/src/app/state.ts` — sources panel state shape only (NO
  `revealedFamily`; reveal state is React-local, not an atom).
- `frontend/src/app/ChatView.tsx` — destructure `{sources, activeIndex,
  dbSchools}`; pass all three to `SourcesPanel`/`SourcesSheet`.
- `frontend/src/components/citations/SourcesPanel.tsx` — `SourcesPanel`,
  `SourcesSheet`, AND internal `SourcesChrome` accept + forward
  `activeIndex`/`dbSchools` to `SourcesList`.
- `frontend/src/components/citations/MessageSources.tsx` — derive `dbSchools`;
  externals → `SourcesStrip` (favicons), count via `displaySourceCount`; full
  cited + `dbSchools` + `activeIndex:null` → `openSourcesPanelAtom`.
- `frontend/src/components/citations/SourcesStrip.tsx` — add `displayCount?:
  number` prop; when set it overrides `cited.length` for the count label so
  strip/panel counts agree.
- `frontend/src/components/citations/DbClaim.tsx` — add `index` prop; decide
  highlight from `useSources()` (`isDbSource`) + `useRevealDb()`; undefined/
  external ⇒ inert.
- `frontend/src/components/citations/sourceName.ts` — harden `schoolFromDbLabel`
  to return `null` when no ` — ` separator.
- `frontend/src/components/citations/remarkCitations.ts` — add
  `dbIndicesForMessage`; remove `CitationRefMarkdown` export + `CitationRef`
  import (T8).
- `frontend/src/components/citations/__tests__/citations.test.tsx` — drop
  superseded `CitationRef`/`CitationRefMarkdown`/`SourcesFooter`/`TierChip` cases;
  keep a `remarkCitations` core test.

**Create**
- `frontend/src/components/citations/remarkDbSpans.ts` — clause-wrapping plugin
  emitting `dbClaim` nodes with `data.hProperties.index` (NEW; `remarkDbClaim.ts`
  stays untouched for the DEV preview).
- `frontend/src/components/citations/RevealStateContext.tsx` — per-message
  `{revealed, setRevealed}` React context owned by `MessageRender`.
- `frontend/src/components/citations/dbSchools.ts` — `dbSchoolsForMessage`
  (or co-locate with `dbIndicesForMessage`).
- Tests under `frontend/src/components/citations/__tests__/`.

**Delete (in T8, same step as the test update)**
- `frontend/src/components/citations/SourcesFooter.tsx`.
- `frontend/src/components/citations/CitationRef.tsx`.
- `TierChip` JSX component only (keep its util exports).

**Unchanged on purpose:** `Markdown.tsx`, `MarkdownBlocks.tsx` (singleton plugin
design avoids them); `MessagePreview.tsx` (DEV reference, keeps using
`remarkDbClaim.ts`); all backend files.

**Backend:** none. `snippet` is already wired end-to-end; DB-span derivation is
client-side from the existing envelope. (Confirmed by explorer 4.)

## 7. Verification

- `cd frontend && npm run typecheck && npm test`
- `uv run pytest -m "not live_llm and not live_search"` (sources suite)
- `uv run ruff check . && uv run mypy .`
- Live: start :8000 + :5173, ask a real school question, screenshot the answer +
  open panel + toggle reveal; diff against `/message-preview`. Both themes.
