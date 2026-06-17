# Wave 1 Audit — Frontend Correctness & UX

Scope: `frontend/src/` — the chat render path, the honesty surface (activity
timeline / cited cards / citation grammar / reveal toggle / sources panel), the
composer, rendering correctness, re-renders, accessibility, edge/empty/error
states. Read-only analysis. Every finding cites real code at `file:line`.

A framing note up front: **`src/app/MessagePreview.tsx` is a DEV-only preview
harness** (mounted at `/message-preview`, DEV-gated, excluded from prod — see its
header comment, lines 35–49). The brief named it as the "message rendering"
file, but the **live** assistant render path is
`vendor/.../Content/MessageContent.tsx` → `Markdown.tsx`/`MarkdownBlocks.tsx`
with the citation remark plugins. Most findings below are against the live path;
MessagePreview is flagged separately for maintainability/drift.

---

## Severity summary

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 5 |
| MEDIUM | 9 |
| LOW | 8 |
| **Total** | **23** |

---

## CRITICAL

### FE-C1 — Reveal highlight can light an external-source clause as "from Counselle's verified data"
**Severity:** CRITICAL
**Category:** Honesty / citation correctness
**Location:**
- `src/components/citations/remarkDbSpans.ts:87-109` (`wrapClauses`)
- `src/components/citations/DbClaim.tsx:52-60`
- `src/components/cards/.../markdownConfig.ts:48` (plugin order)

**Evidence.** `remarkDbSpans` wraps "the clause preceding each citationRef" into a
`<db-claim>` node stamped with **that citationRef's index** (lines 91-103). The
clause is only bounded on the left by the *previous sibling node* — and a
preceding `citationRef` does NOT split text or bound the clause; only a sentence
boundary (`.?!`) does (`splitAtLastBoundary`, lines 70-80). So for prose like:

> `…US News reports 1480–1570 [5], close to our own figure of 1490 [1].`

(where `[5]` = a `web` source, `[1]` = a `cds`/DB source, no sentence boundary
between them), the clause wrapped for `[1]` is the **entire run since the last
`.`** — i.e. `"…US News reports 1480–1570 , close to our own figure of 1490 "`.
`DbClaim` then sees `index=1`, resolves it to a DB source, and on reveal lights
the *whole* clause — including the part that is explicitly attributed to US News
— with the brand wash + the "From Counselle's verified data" hovercard
(`DbClaim.tsx:68-100`).

For a product whose one non-negotiable is "never lie to a student" (CLAUDE.md
principle 3, ADR 0006), visually certifying an external-sourced phrase as
Counselle's own verified data is the worst class of bug here. The
plugin-comment's own claim that "any prior citationRef split the text, bounding
the clause on the left" (remarkDbSpans.ts:14-16) is **false** — `remarkCitations`
splits text around `[n]` into `text | citationRef | text`, but the trailing
text after `[5]` and the leading text before `[1]` are the **same** uninterrupted
sentence, so the wrap swallows the `[5]` attribution text.

**Why it matters.** Mis-attributes external claims as verified DB data — a
direct honesty violation, the exact thing the citation grammar exists to prevent.

**Fix direction.** Bound the clause on the left by the previous `citationRef` as
well as by sentence boundaries: in `wrapClauses`, when the immediately-preceding
*non-text* sibling is a `citationRef`, start the clause at the text node's
beginning only (never reach across an earlier citation). More simply: stop at the
previous citationRef OR the last `.?!`, whichever is closer to the end. Add a
test with two adjacent citations of different source classes in one sentence.

---

## HIGH

### FE-H1 — Favicons are fetched from `google.com/s2/favicons` for every external source (privacy leak + honesty/availability)
**Severity:** HIGH
**Category:** Privacy / security / reliability
**Location:** `src/components/citations/SourceFavicon.tsx:64-66`

**Evidence.**
```tsx
src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
```
Every source row, inline pill, and strip badge issues a request to Google
carrying the **domain of each source the student is reading** (US News, a
specific subreddit, a school site, `nces.ed.gov`, etc.). For an
admissions-advice product, the set of schools/subreddits a student researches is
sensitive; this silently ships that browsing signal to a third party on every
answer. There is also no CSP (`index.html` has none — see FE-M9), so nothing
constrains this. Secondary: if Google's endpoint is blocked/down, every favicon
falls back to the neutral tile (handled, but the network churn remains).

**Why it matters.** Leaks student research interest to Google; runs counter to
the product's trust posture; adds a third-party dependency on the critical
render path.

**Fix direction.** Proxy favicons through the backend, or have the backend
supply favicon bytes/data-URIs in the source envelope (the step chips already
carry `source.favicon` — `StepSourceChip.tsx:30`), or drop remote favicons in
favor of the source-tier glyph. At minimum add a CSP `img-src` allowlist and
document the trade-off.

### FE-H2 — `useElapsed` has a stale-`elapsed` closure and never resets across turns; the "Thought for N" timer can be wrong
**Severity:** HIGH
**Category:** Rendering correctness / hooks
**Location:** `src/components/timeline/ReasoningTrace.tsx:161-173`

**Evidence.**
```tsx
function useElapsed(live: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!live) return;
    const start = performance.now() - elapsed;   // reads elapsed
    const id = setInterval(() => setElapsed(performance.now() - start), 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);                                     // but elapsed not a dep
  return elapsed;
}
```
The effect reads `elapsed` but excludes it from deps (suppressed). On a
live→done transition `elapsed` freezes (intended). But the hook **never resets to
0**: a `ReasoningTrace` instance reused for a *new* live turn (React reconciles
it to the same position — same component, props change) restarts the interval
with `start = now - <frozen previous elapsed>`, so the new turn's timer begins at
the *previous* turn's duration and the displayed "Thought for N" is the sum.
`useActivityTicker` was explicitly written to survive instance reuse (the
`enqueued` reset comment at lines 116-122), so reuse is a real expected case —
but `useElapsed` was not given the same treatment.

**Why it matters.** The work-visibility surface can show a visibly wrong elapsed
time, which undercuts the "show the real work" promise.

**Fix direction.** Reset `elapsed` to 0 when transitioning idle→live (key the
timer on a turn id, or `setElapsed(0)` at the top of the live branch and base
`start` on `performance.now()` only). Drop the stale read.

### FE-H3 — `ThinkNode` uses the array index as its React key
**Severity:** HIGH
**Category:** Rendering correctness / list keys
**Location:** `src/components/timeline/ReasoningTrace.tsx:415-420`

**Evidence.**
```tsx
timeline.map((entry, i) =>
  entry.type === 'step'
    ? <StepNode key={`step-${entry.step.step_id}`} step={entry.step} />
    : <ThinkNode key={`thinking-${i}`} text={entry.text} />,
)
```
The timeline is built in **arrival order** with steps and thinking lines
interleaved (`turn-reducer.ts:56-58, 146-151`). A thinking entry's key is its
*positional index in the mixed array*. As steps merge in and new thinking lines
arrive, the same `i` maps to different thinking text over time (and steps
inserted before a thinking line shift every following thinking index). React then
reuses the wrong DOM node / mis-associates text. This is a textbook index-key
bug, made worse by the live interleaving.

**Why it matters.** During streaming, thinking lines can visibly swap/duplicate
text or animate incorrectly.

**Fix direction.** Give thinking entries a stable id. Either have the reducer
assign each `thinking` entry a monotonic id, or key on a content+ordinal hash
that's stable across re-renders. Avoid raw index keys in an append-and-merge
list.

### FE-H4 — DB-only "Counselle data" appears in the sources strip/panel even when the prose cited no DB source — overcounting verified data
**Severity:** HIGH
**Category:** Honesty / citation correctness
**Location:**
- `src/components/citations/MessageSources.tsx:27,51`
- `src/components/citations/SourcesList.tsx:28-32, 66`
- `src/components/citations/remarkCitations.ts:90-101` (`citedSourcesForMessage`)

**Evidence.** `citedSourcesForMessage` filters `message.sources` to the subset
whose index appears in the prose `[n]` grammar (good). But DB figures
deliberately carry **no inline `[n]` marker** in prose — they live only in viz
cards (`InlineCitation.tsx:30-31` returns null for DB sources; the whole design
in `DbClaim` / MessagePreview header). So a DB source entry only ends up in
`cited` if the model happened to also emit a literal `[n]` for it in prose, which
the grammar says it should not. Conversely, an answer whose numbers live entirely
in a viz card (the common dossier case) may have its DB `[n]` markers present or
absent depending on model behavior. The result is inconsistent: `displaySourceCount`
(`SourcesList.tsx:28-32`) adds **+1 for "Counselle data" whenever any DB entry is
in the cited set**, and the panel pins a "Counselle data" card. Whether that card
appears is thus coupled to an inline-marker convention the product says shouldn't
exist for DB facts. The `dbSchoolsForMessage` fallback (`dbSchools.ts:45-53`)
only trusts `cds` labels, so a Scorecard/IPEDS-only answer can show the generic
"from our own college database" card with no school even when a viz card names
the school — the two derivations disagree.

**Why it matters.** The count/inclusion of the verified-data attestation is
non-deterministic w.r.t. the actual source mix; either the student sees
"Counselle data" attributed to an answer that didn't use it, or a DB-grounded
answer hides it. This is the honesty surface being driven by a fragile
text-scan.

**Fix direction.** Decouple DB-source inclusion from prose `[n]` scanning. Derive
"this answer used Counselle data" from the presence of viz blocks / DB source
entries directly (the authoritative signal), not from whether a `[n]` happened to
appear in prose. Single-source the strip count, the panel header, and the
`dbSchools` set off the same derivation.

### FE-H5 — No top-level error boundary; a render throw in the chat tree blanks the app
**Severity:** HIGH
**Category:** Error handling / resilience
**Location:** `src/app/ChatView.tsx` (whole tree), `src/app/AppShell.tsx`,
`src/main.tsx` (no boundary wrapping routes)

**Evidence.** The markdown body is wrapped in `MarkdownErrorBoundary`
(`Markdown.tsx:33`), but the surrounding honesty surface — `ReasoningTrace`,
`VizCard`, `SourcesPanel`, `ClarifyWidget`, the citation providers — has no error
boundary above it. A malformed `RenderSpec` reaching a card path that the
`MarkdownFallbackCard` doesn't cover (e.g. `spec.rows` undefined —
`VizCard.tsx:24` maps `spec.rows` with no guard; `StatBlockCard` guards `school`
but not `rows`), or any thrown error in these components, unwinds to the router
with nothing to catch it and white-screens the conversation. For a product that
streams partial/oddly-shaped backend data into clickable cards, this is a real
availability risk.

**Why it matters.** One bad payload field can take down the whole chat view
instead of degrading one card.

**Fix direction.** Add a React error boundary around `MessagesView` (and ideally
per-message and per-card) that renders an honest "this part couldn't be shown"
fallback. Guard `spec.rows` in `VizCard`/cards before `.map`.

---

## MEDIUM

### FE-M1 — `SourcesStripPreview` and the live `SourcesStrip` aria-labels are misleading for mixed/DB sources
**Severity:** MEDIUM
**Category:** Accessibility
**Location:** `src/app/MessagePreview.tsx:364` (`aria-label={`Sources: ${externals.length} web sources`}`); `src/components/citations/SourcesStrip.tsx:76`

**Evidence.** The preview strip announces "N web sources" using only the external
count, even though the panel it opens leads with the Counselle-data card. The
live strip is better ("View N sources for this answer") but `displayCount`
(externals + 1 for the DB card) can differ from the favicon stack a screen-reader
user perceives. Minor mismatch between announced and visible content.

**Fix direction.** Announce the same `displayCount` everywhere; describe mixed
content ("N sources including Counselle data") when a DB entry is present.

### FE-M2 — `+N more` source-overflow indicator is not focusable and conveys count only via aria-label on a non-interactive span
**Severity:** MEDIUM
**Category:** Accessibility / UX
**Location:** `src/components/timeline/ReasoningTrace.tsx:193-200`

**Evidence.** When a step has >4 sources, the overflow renders a plain `<span>`
with `aria-label="and N more sources"` and no way to reveal the hidden chips —
they're simply unreachable. Keyboard/AT users can't get to sources 5+.

**Fix direction.** Make the "+N more" a button that expands the remaining chips
(or links into the sources panel). At minimum it shouldn't carry an `aria-label`
on a static span (it reads as a labelled element with no role).

### FE-M3 — Composer file-size/type rejections fail silently with no user feedback
**Severity:** MEDIUM
**Category:** Edge-case / UX honesty
**Location:** `src/components/composer/CounselleComposer.tsx:76-86`

**Evidence.**
```tsx
if (!isImageFile(file)) return;
if (file.size > MAX_FILE_BYTES) return;
```
A student who drops a PDF or a 20 MB photo gets *nothing* — no toast, no
shake, no message. The comment rationalizes it ("no user-facing error channel"),
but a silent drop reads as a broken upload. Also, the whole image-upload path is
decorative: files are never transmitted (the turn endpoint has no image channel
per the recorder comment at line 149), so the Paperclip + drag/paste UI promises
a capability the backend can't fulfill — itself a small honesty/UX smell.

**Fix direction.** Surface a brief inline error on rejection; and either wire
images to a real endpoint or hide the upload affordance until it does something.

### FE-M4 — `useActivityTicker` reads `Math.random()` in render-adjacent effect; placeholder reduced-motion path still re-renders
**Severity:** MEDIUM
**Category:** Performance / reduced-motion
**Location:** `src/components/timeline/ReasoningTrace.tsx:139-154`

**Evidence.** The dead-air placeholder rotates words on a 1.9s `setInterval`,
causing a re-render of the trace header ~every 1.9s for the entire pre-first-event
window. That's acceptable, but it runs unconditionally while `live && activities
=== empty`; on a slow first token this is a steady re-render cadence on a
component that also hosts the 100ms wall-clock interval (`useElapsed`). Combined,
the header re-renders ~10×/s during dead air. Reduced-motion correctly holds one
word (line 143-146), good — but `useElapsed` has **no** reduced-motion gate and
still ticks 10×/s (line 168), which is motion (a changing number) that some
reduced-motion users want suppressed.

**Fix direction.** Consider a coarser clock tick (e.g. 250-500ms) and/or pausing
the visible timer under reduced motion. Verify the header is isolated enough that
these intervals don't re-render the step list.

### FE-M5 — `MessagePreview` (568 lines) duplicates production logic and overrides the honesty gate
**Severity:** MEDIUM
**Category:** Maintainability / drift risk
**Location:** `src/app/MessagePreview.tsx` (whole file; esp. 226-294 `DbClaimPreview`)

**Evidence.** `DbClaimPreview` deliberately **restores the old unconditional
highlight behavior** ("highlight whenever revealed is on, regardless of source",
lines 239-269), `previewHighlightClass` re-copies the private `highlightClass`
from `DbClaim`, and `SourcesStripPreview`/`SourcesPanelPreview`/`PanelHeader`
re-implement live components. This is 568 lines of near-duplicate that can drift
from prod silently — and it visually demonstrates a *different* (less honest)
highlight rule than production ships. A reviewer eyeballing the preview would
conclude the reveal lights all claims, which is not the live behavior.

**Fix direction.** Trim the preview to import the real components with sample
props; delete the duplicated styling/override. If the unconditional-highlight
demo is needed, label it loudly as not-production behavior.

### FE-M6 — `proseOf` joins markdown blocks with `\n\n`, which can split a `[n]` citation marker or a sentence across the fallback text
**Severity:** MEDIUM
**Category:** Citation correctness (fallback path)
**Location:** `src/api/turn-reducer.ts:183-188`; consumed by
`citedIndexesForMessage` fallback (`remarkCitations.ts:55`)

**Evidence.** `proseOf` concatenates only markdown blocks with `\n\n`, dropping
viz blocks from the middle. The `message.text` fallback is used by
`citedIndexesForMessage` when `content` blocks are absent, and by `dbIndicesForMessage`.
Because a viz block between two markdown blocks is elided, a sentence/citation
that the model split around a card is glued with `\n\n` — generally harmless for a
digit scan, but the fallback no longer reflects render order. More importantly,
the primary path uses `content` blocks (fine); the fallback is only for legacy
entries, so impact is limited — flagging as a latent correctness gap if the
fallback ever becomes load-bearing.

**Fix direction.** Document that the `text` fallback is digit-scan-only and never
used for clause wrapping; ensure all live turns carry `content` so the fallback
isn't exercised.

### FE-M7 — Inline `SourcePill` uses `translate-y` + `align-baseline` hack that can clip/misalign in tables and small line-heights
**Severity:** MEDIUM
**Category:** Layout / overflow
**Location:** `src/components/citations/SourcePill.tsx:38-43`

**Evidence.** The pill is `inline-flex … translate-y-[0.12em] … leading-none`
with `max-w-[14rem]` and `truncate`. Inside the editorial answer prose this is
tuned, but the same `citation-ref` renderer runs inside GFM table cells and list
items where line-height and cell padding differ; the fixed `translate-y` and
`leading-none` can push the pill out of the cell's vertical rhythm or cause
baseline jitter on wrapped lines. There's no test for the pill in a table cell.

**Fix direction.** Verify the pill in a table cell and a tight list; prefer
`vertical-align` over a fixed `translate-y` em offset, or scope the offset to
prose context.

### FE-M8 — Sources panel and artifact panel share one right rail; opening one silently closes the other with no announcement
**Severity:** MEDIUM
**Category:** Accessibility / UX
**Location:** `src/app/ChatView.tsx:71-77, 141-151`; `src/app/state.ts` (write atoms clear the other)

**Evidence.** `rightPanelOpen` shows at most one of artifact/sources; the write
atoms clear the other (per the comment at lines 50-53). For a sighted user this
is fine; for AT users, the panel mount/unmount isn't announced and focus
management across the swap isn't handled here (the panels use `useEscToClose` but
nothing moves focus into the opened panel or restores it on close). Opening the
sources panel from an inline pill (`MessageContent.tsx:166-169`) doesn't move
focus to the flashed row either.

**Fix direction.** On panel open, move focus to the panel heading/close button;
on close, restore focus to the trigger. Consider `aria-live` for the swap.

### FE-M9 — No Content-Security-Policy and no security headers on the SPA shell
**Severity:** MEDIUM
**Category:** Security (defense-in-depth)
**Location:** `frontend/index.html` (no `<meta http-equiv>`; no CSP), confirmed
no CSP anywhere in `index.html`/`public/`

**Evidence.** `isSafeUrl` (`api/url.ts`) correctly gates `href` sinks against
`javascript:`/`data:` (good, and clearly intentional per its header). But there's
no CSP backstop, and the favicon path (FE-H1) plus markdown image rendering load
arbitrary remote origins. With user-influenced data flowing into the DOM, a CSP
is the cheap second layer the web security rules call for.

**Fix direction.** Ship a production CSP (script-src self, img-src allowlist,
connect-src to the API origin, frame/object none) at the server or via meta as a
stopgap. This belongs with the deferred deploy (B6) but should be tracked.

---

## LOW

### FE-L1 — `useElapsed` exhaustive-deps suppression masks the FE-H2 bug
**Severity:** LOW · **Category:** Code quality
**Location:** `ReasoningTrace.tsx:170`
The `eslint-disable react-hooks/exhaustive-deps` is what hides the stale `elapsed`
read. Removing the suppression and fixing the reset (FE-H2) is the clean path.

### FE-L2 — `debouncedHandleScroll` builds a throttled fn with a suppressed deps lint
**Severity:** LOW · **Category:** Code quality
**Location:** `useQuestionAnchoredScroll.ts:48-52`
`throttle(...)` inside `useCallback` with disabled exhaustive-deps; works because
deps are stable, but fragile. Prefer `useMemo(() => throttle(...), [deps])` with a
real dep array.

### FE-L3 — Anchor scroll uses a magic `window.setTimeout(applyAnchor, 600)`
**Severity:** LOW · **Category:** Code smell / timing fragility
**Location:** `useQuestionAnchoredScroll.ts:155`
A 600ms guess to wait out composer-resize relayout. On slow devices the layout
may not have settled; on fast ones it's wasted. Prefer a `ResizeObserver` on the
composer or `requestAnimationFrame` chaining.

### FE-L4 — `ComparisonTableCard` keys school `<col>`/cells on `school.unitid`; duplicate unitids would collide
**Severity:** LOW · **Category:** List keys
**Location:** `ComparisonTableCard.tsx:107, 116, 132`
Reasonable (unitid is unique per school), but a malformed spec with a repeated
school would produce duplicate keys with no guard. Row keys correctly fall back to
`label-i`.

### FE-L5 — `StatBlockCard`/`ComparisonCell` key rows on `${row.label}-${i}` — fine, but label-collision relies on index suffix
**Severity:** LOW · **Category:** List keys
**Location:** `StatBlockCard.tsx:118`, `ComparisonTableCard.tsx:125`
Acceptable; noting the pattern is index-tainted, so reordering rows mid-stream (not
expected for viz) would remount.

### FE-L6 — `SourceRow` renders a non-link `<div>` row (no URL) that is visually identical to a clickable row but inert
**Severity:** LOW · **Category:** UX affordance
**Location:** `SourceRow.tsx:60-68`
A source with no safe URL renders the same hover styling (`hover:bg-surface-secondary`)
as a real link but does nothing on click — a small affordance lie. Consider
suppressing the hover treatment when there's no URL.

### FE-L7 — `ClarifyWidget` "Other" free-text input has no label/aria and no max length
**Severity:** LOW · **Category:** Accessibility / validation
**Location:** `ClarifyWidget.tsx:66-78`
The input relies on placeholder only (no `aria-label`/`<label>`); placeholder is
not an accessible name. Add `aria-label="Your answer"`.

### FE-L8 — Composer file preview keys on array index and only ever holds one file
**Severity:** LOW · **Category:** Dead generality / keys
**Location:** `CounselleComposer.tsx:179-180` (`key={index}`)
`files` is always a single-element array (`setFiles([file])`), yet the code maps
with an index key and a `flex-wrap` multi-file layout — speculative generality
(YAGNI) plus an index key. Simplify to a single preview.

---

## Notes / things checked that are OK

- `isSafeUrl` gating on every `href` sink (SourceRow, SourcePill, StepSourceChip,
  markdown `a`) is consistently applied — good honesty/XSS hygiene.
- `MarkdownBlocks` per-block memoization with prefix-summed base indices is a
  sound streaming-perf design; completed blocks correctly skip re-parse.
- `remarkCitations`/`remarkDbSpans` correctly avoid `code`/`inlineCode` nodes.
- `dbSchoolsForMessage` correctly refuses to treat IPEDS/Scorecard em-dash heads
  as school names (honesty) — though it disagrees with the strip's DB-inclusion
  logic (FE-H4).
- Reduced-motion is gated in many places (`motion-reduce:` classes,
  `useReducedMotion` in the ticker) — except `useElapsed` (FE-M4).
- The turn reducer is pure/immutable and shares one path for live + transcript —
  a clean design.
