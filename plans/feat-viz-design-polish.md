# Plan — Land the redesigned comparison table + citation system

Branch: `feat/viz-design-polish`

## 1. Problem statement

The comparison-table viz card (`ComparisonTableCard`) and the citation system
(`CitationPopover`, `SourcesFooter`, plus new `SourceTag` and `TierChip`
helpers) were redesigned in place and verified in an isolated `/viz-preview`
harness. The redesigned components are already on the live render path
(SSE `viz` → turn reducer → `MessageContent` → `VizCard` → `ComparisonTableCard`),
so there is no preview→prod migration. The remaining work is to **land the
change safely**: fix the defects the review surfaced, make it production- and
design-system-clean, remove the temporary scaffolding, and verify on the real
chat path in both themes.

**Non-goals:** redesigning `StatBlockCard` (a later pass);
changing the SSE/wire protocol; changing the backend; committing/PR (separate
step once the user approves).

## 2. Ordered task list (revised after review; dependencies marked)

Two implementation groups touch **disjoint file sets** so they can run in
parallel. Group A = citations/; Group B = cards/. Verification + scaffolding
removal happen after both, in the main loop.

### Group A — citations (opus)
A1. **[a11y/honesty] Popover trigger accessible name** — in `CitationPopover`,
   change `aria-label={`Source: ${citation.source}`}` →
   `aria-label={`Source: ${sourceDisplayName(citation.source)}`}`.
   `aria-haspopup="dialog"` is already supplied by Radix `Popover.Trigger`
   (verified) — do NOT add it manually.
A2. **[a11y/honesty] Audit `CitationRef`** — `CitationRef.tsx` has its OWN
   `Popover` (not via `CitationPopover`). Check its trigger `aria-label`/popover
   content; if it shows the raw enum, apply `sourceDisplayName` for parity.
A3. **[a11y/contrast] SourceTag** — the resting label `text-text-tertiary`
   (#595959) on the card surface (#171717 dark) is **2.51:1 — a confirmed WCAG
   fail**. Bump to `text-text-secondary` **unconditionally** (passes both
   themes: 9.9:1 light, 10.8:1 dark; still quieter than the value). Keep the dot
   tier-colored. **[a11y/touch-target]** bump vertical padding so the hit area
   is ≥24px (`py-1.5`, WCAG 2.5.8).
A4. **[a11y/contrast] Popover footnote** — the `raw_table` footnote band in
   `CitationPopover` uses `text-text-tertiary` (same 2.51:1 dark fail). Bump to
   `text-text-secondary`.
A5. **[a11y/motion] Reduced-motion** — add `motion-reduce:animate-none` to the
   Radix `Popover.Content` (the `zoom-in/out` classes aren't gated by
   counselle.css) and `motion-reduce:transition-none` to the link-arrow `<a>`.
A6. **[test] SourceTag unit test** — assert `data-tier` for official/community,
   renders the children text node, is a `<button>`. Scope queries with a
   `selector`/`within` so they never collide with TierChip's identical label
   text elsewhere (R4).

### Group B — cards (opus)
B1. **[a11y/contrast] "Metric" header** — the sticky `<th scope="col">` uses
   `text-text-tertiary` (same 2.51:1 dark fail). Bump to `text-text-secondary`.
B2. **[a11y] Table accessible name** — give the `<table>` a name tied to the
   title: `const headingId = useId()` on the `<h3 id={headingId}>` and
   `aria-labelledby={headingId}` on the `<table>` (no visual change; `useId`
   avoids duplicate-id bugs when multiple cards render).
B3. **[design-system] Extract `NotAvailableValue`** — move it from
   `StatBlockCard` into `src/components/cards/NotAvailable.tsx`, **className and
   text byte-identical** (`text-sm italic text-text-secondary underline
   decoration-dashed underline-offset-4`, text `not available`), so the honesty
   tests that match `getByText('not available')` and check `.italic` still pass.
   Update imports in `StatBlockCard` and `ComparisonTableCard`. No card imports
   from a sibling card afterward.
B4. **[test] Table a11y assertion** — in `honesty.test.tsx`, add
   `expect(screen.getByRole('table', { name: <spec.title> })).toBeInTheDocument()`
   to the comparison-table block.

### Main loop (after A + B)
M1. **[verify] Build gates** — `npm run typecheck`, `npm test` (citations +
   honesty + new), `npm run lint`. All green BEFORE browser work.
M2. **[verify] Browser** — on `/viz-preview` (still present), widen the fixture
   to MANY schools / narrow the viewport and confirm: first column stays pinned
   on horizontal scroll despite the outer `overflow-hidden` (Risk R1), hover
   backgrounds on the sticky cell match the row, popover layers correctly, both
   themes. Then sanity-check a real chat render if feasible.
M3. **[cleanup] Remove scaffolding (LAST)** — remove the `/viz-preview` route +
   `VizPreview` import in `routes.tsx` AND delete `VizPreview.tsx` in the same
   step (atomic, or typecheck breaks); delete repo-root screenshot PNGs.
M4. **[verify] Final gates** — re-run typecheck + tests + lint after removal.

## 3. Behavior list (numbered, testable)

1. Opening any citation popover (in a card, the footer, or a `CitationRef`)
   announces a human source name (e.g. "Source: Common Data Set"), never the
   raw enum, to assistive tech.
2. The comparison `<table>` exposes an accessible name equal to the card title
   (`getByRole('table', { name })`).
3. With more schools than fit the width, value columns scroll horizontally while
   the dimension (first) column stays pinned and legible.
4. The resting source label passes WCAG AA contrast (≥4.5:1 for <14px non-bold)
   in BOTH themes.
5. The SourceTag tap target is ≥24px tall.
6. No card module imports a component from a sibling card module.
7. `/viz-preview` route and `VizPreview.tsx` no longer exist; app builds,
   typechecks, all card/citation tests pass.
8. The existing honesty contracts still hold: no winner-highlighting (identical
   cell classNames), NA distinct from zero, tier fidelity (`data-tier`),
   unknown-type → markdown fallback. (The score band was later deleted — ADR 0024.)
9. Reduced-motion users get no popover zoom animation or link-arrow transition.

## 4. Risk register

- **R1 (HIGH) — `overflow-hidden` vs sticky.** The outer card div has
  `overflow-hidden` (for rounded corners). The first column is
  `position: sticky; left: 0` inside the inner `overflow-x-auto`. Because the
  OUTER div does not itself scroll, horizontal sticky within the inner scroll
  container is expected to work — but `overflow-hidden` ancestors are a classic
  sticky-killer, so this MUST be browser-verified with a wide table (M2).
  **Remedy if broken:** remove `overflow-hidden` from the outer div and round
  the inner scroll container instead; then re-verify the card's top-left/right
  corner radius is still clipped and the sticky-cell hover bg still matches.
- **R2 (MEDIUM) — popover z-index over chat chrome.** Popover is `z-40` (not a
  regression). Verify it layers above the message area; raise to `z-50` if the
  sidebar/composer overlaps.
- **R3 (MEDIUM) — `not-prose` vs prose table styles.** The card uses `not-prose`
  to escape LibreChat's `.prose` table resets (pre-existing, not a regression);
  verify the elaborate new chrome isn't overridden inside a real message.
- **R4 (LOW→addressed) — test multiple-match.** Both TierChip and SourceTag can
  render the label "CDS"; a single `render()` of both would make
  `getByText('CDS')` ambiguous. New SourceTag test MUST scope its queries.
- **R5 (LOW) — screenshots/preview committed.** Ensure removed, not staged.

## 5. File change manifest

- `frontend/src/components/citations/CitationPopover.tsx` — modify (A1, A4, A5).
- `frontend/src/components/citations/SourceTag.tsx` — modify (A3).
- `frontend/src/components/citations/CitationRef.tsx` — modify if audit (A2)
  finds a raw-enum label.
- `frontend/src/components/citations/__tests__/sourceTag.test.tsx` — **new** (A6).
- `frontend/src/components/cards/ComparisonTableCard.tsx` — modify (B1, B2, B3
  import; possible R1 remedy).
- `frontend/src/components/cards/NotAvailable.tsx` — **new** (B3).
- `frontend/src/components/cards/StatBlockCard.tsx` — modify (B3 import).
- `frontend/src/components/cards/__tests__/honesty.test.tsx` — modify (B4).
- `frontend/src/app/VizPreview.tsx` — **delete** (M3).
- `frontend/src/app/routes.tsx` — modify (M3, remove import + route).
- Repo-root `cmp-*.png`, `popover-*.png` — **delete** (M3).

## Deferred (explicit, with rationale)
- **`tierLabel`/`sourceDisplayName` residency** — they live in `TierChip.tsx`
  and are imported by `SourceTag`/`ComparisonTableCard` (mild coupling smell).
  Extracting to `citations/labels.ts` is deferred to the broader 3-card pass to
  keep this landing focused; pure-function imports are acceptable for now.
- **Broader `cards/primitives` module** — only `NotAvailable` is shared today;
  revisit when a third shared primitive appears.
- **`/sampler` route** — a pre-existing FE-0 scaffold, NOT part of this branch;
  left as-is.
