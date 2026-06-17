# Phase 4 — Frontend Correctness, Resilience & UX/A11y

> Execution: follow the per-phase loop in `plans/audit/REMEDIATION-PLAN.md` §2
> (DISPATCH Opus implementers → GATE → ≥3 Sonnet reviewers, non-leading →
> FIX↔RE-REVIEW until unanimous SHIP → COMMIT). This file is the authoritative
> spec for Phase 4. **Implement EVERYTHING below; miss nothing.** Every finding,
> every before/after snippet, every test, every acceptance checkbox.
>
> **Method note (read first — it governs every fix here):** line numbers in this
> file drift; the snippets are the *intended shape*, not a verbatim patch. Read
> the real file before editing and adapt. Two facts verified against the live
> tree on 2026-06-16 that change where you work:
>
> 1. **`src/app/MessagePreview.tsx` is a DEV-ONLY preview harness** (lazy +
>    `import.meta.env.DEV`-gated, mounted at `/message-preview`, excluded from
>    prod — header lines 35–49). It re-implements live components and deliberately
>    demonstrates a *different* (less honest) highlight rule. **It is NOT the
>    render path.** The LIVE assistant render path is
>    `src/vendor/librechat/app/components/Chat/Messages/Content/MessageContent.tsx`
>    → `Markdown.tsx` / `MarkdownBlocks.tsx` + the remark plugins
>    (`remarkCitations.ts`, `remarkDbSpans.ts`). **Target the live path.** Where a
>    finding touches MessagePreview (FE-M1, FE-M5) the scope is *trim/label only* —
>    do not invest in it.
> 2. The wave1 report referenced an event-dedup at `ChatContext.tsx:885` and a
>    20-field context value; the live `consumeStream` (≈367–491) and `attachTurn`
>    (≈538–580) are what you actually patch for FE-ATTACH-CURSOR. Verify before
>    editing.

---

## Scope & files touched

**Owned findings (cover EVERY one):** FE-FEEDBACK-STALE, FE-ATTACH-CURSOR
(HIGH, from 04); FE-H1, FE-H2, FE-H3, FE-H5 (HIGH, from 05); FE-SSE-NOSCHEMA
(MEDIUM, from 04); FE-M1…FE-M9 (MEDIUM, from 05); FE-L1, FE-L3…FE-L8 (LOW, from
05; FE-L2 moved to Phase 5).

Note: FE-C1 (reveal mis-certifies external clause) and FE-H4 (DB overcount) are
**honesty findings owned by Phase 2** — do NOT fix them here. FE-H4's text-scan
shares files with this phase (`remarkCitations.ts`, `MessageSources.tsx`,
`SourcesList.tsx`); leave those derivations alone in Phase 4 except where a
finding below explicitly names them.

| File | Findings touching it |
|---|---|
| `src/vendor/librechat/app/hooks/Messages/useMessageActions.tsx` | FE-FEEDBACK-STALE |
| `src/api/http/transport.ts` | FE-ATTACH-CURSOR |
| `src/app/ChatContext.tsx` | FE-ATTACH-CURSOR |
| `src/components/citations/SourceFavicon.tsx` | FE-H1 |
| `src/components/timeline/ReasoningTrace.tsx` | FE-H2, FE-H3, FE-M2, FE-M4, FE-L1 |
| `src/api/turn-reducer.ts` | FE-H3 (stable thinking id), FE-M6 (doc) |
| `src/app/ChatView.tsx` | FE-H5 (error boundary), FE-M8 (focus) |
| `src/components/error/MessagesErrorBoundary.tsx` (new) | FE-H5 |
| `src/components/cards/VizCard.tsx` | FE-H5 (`spec.rows` guard) |
| `src/api/http/sse.ts` | FE-SSE-NOSCHEMA |
| `src/app/MessagePreview.tsx` | FE-M1 (aria), FE-M5 (trim/label) |
| `src/components/composer/CounselleComposer.tsx` | FE-M3, FE-L8 |
| `src/components/citations/SourcePill.tsx` | FE-M7 |
| `src/components/citations/SourcesPanel.tsx` | FE-M8 (focus) |
| `src/components/citations/SourceRow.tsx` | FE-L6 |
| `src/components/clarify/ClarifyWidget.tsx` | FE-L7 |
| `src/app/useQuestionAnchoredScroll.ts` | FE-L3 |
| `src/components/cards/ComparisonTableCard.tsx` | FE-L4, FE-L5 |
| `src/components/cards/StatBlockCard.tsx` | FE-L5 |
| `index.html` / docs | FE-M9 (CSP — coordinate w/ Phase 6) |

**New test files** (vitest + jsdom, mirroring `src/api/__tests__/`,
`src/test/setup.ts`): `ReasoningTrace.test.tsx`, `sse-validate.test.ts`,
`MessagesErrorBoundary.test.tsx`, `useMessageActions.test.tsx`,
`turn-reducer-thinking.test.ts`.

---

## Gate commands (for this phase)

```bash
cd frontend && npm run typecheck && npm test && npm run build
```

All four must be green before review. Run `npm test` after every fix — several
fixes here (FE-H2, FE-H3, FE-SSE-NOSCHEMA, FE-H5) ship with their own tests.

---

## Findings & fixes

Order: CRITICAL/HIGH → MEDIUM → LOW. (No Phase-4 CRITICALs — FE-C1 is Phase 2.)

---

### FE-H1 — Favicons fetched from `google.com/s2/favicons` leak which schools/subreddits a student researches  [HIGH]

- **Files:** `src/components/citations/SourceFavicon.tsx` (the `<img src=…google.com/s2/favicons…>`).
- **Problem:** Every source row / inline pill / strip badge issues a request to
  `https://www.google.com/s2/favicons?domain=<domain>&sz=64`, carrying the host
  of each source the student is reading (US News, a specific subreddit, a school
  site, `nces.ed.gov`) to Google on every answer. For an admissions product the
  *set of schools/subreddits a student researches* is sensitive; this silently
  ships that browsing signal to a third party. No CSP backstops it (FE-M9).
- **Decision (recommended fix — chosen):** **Drop the remote favicon entirely;
  render the source-tier glyph (the existing fallback tile) for every source.**
  Rationale (CLAUDE.md value×ease + honesty): the neutral-tile fallback already
  exists and is already shown for CDS / no-domain sources, so the glyph path is
  battle-tested and on-brand; removing the remote fetch is the *only* option that
  fully closes the leak with zero new infrastructure and zero third-party
  dependency on the critical render path. A backend favicon-proxy is higher value
  but **hard** (new endpoint, caching, the same privacy question moves to our
  server) → defer it to Phase 6 as a tracked option, not this phase. The CSP
  `img-src` allowlist (FE-M9) is a *backstop*, not a fix — it doesn't stop the
  leak, it only constrains it; we still ship it (below) as defense-in-depth.
- **Fix:** collapse `SourceFavicon` to always render the glyph tile. Keep
  `citationDomain` exported (other code may import it) but stop using its result
  to build a remote URL. Remove the `failed` state and the `<img>` branch.

  **Before** (`SourceFavicon.tsx`, the component body):
  ```tsx
  export default function SourceFavicon({ citation, sizeClass = 'h-8 w-8', className }: SourceFaviconProps) {
    const [failed, setFailed] = useState(false);
    const domain = citationDomain(citation);
    const Icon = sourceIcon(citation.source);

    if (!domain || failed) {
      return (
        <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-border-light bg-surface-primary-alt text-text-tertiary', sizeClass, className)}>
          <Icon className="h-[55%] w-[55%]" />
        </span>
      );
    }

    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt="" aria-hidden="true" loading="lazy" onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-full border border-border-light bg-white object-contain p-0.5', sizeClass, className)}
      />
    );
  }
  ```

  **After:**
  ```tsx
  // The source-tier glyph is the source mark. We deliberately do NOT fetch a
  // remote favicon (e.g. google.com/s2/favicons): doing so would ship the host
  // of every source a student reads to a third party — a privacy leak this
  // product's trust posture forbids (FE-H1). If a first-party favicon channel
  // ever lands (a backend proxy / bytes in the source envelope, Phase 6/CFG-04),
  // wire it here; until then the glyph is the honest, zero-leak default.
  export default function SourceFavicon({ citation, sizeClass = 'h-8 w-8', className }: SourceFaviconProps) {
    const Icon = sourceIcon(citation.source);
    return (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full border border-border-light bg-surface-primary-alt text-text-tertiary',
          sizeClass,
          className,
        )}
      >
        <Icon className="h-[55%] w-[55%]" />
      </span>
    );
  }
  ```
  Remove the now-unused `useState` import. Keep `citationDomain` + `KNOWN_DOMAINS`
  exported (do not delete — they're a stable export surface and harmless).
  Also drop the now-dead `import { useState } from 'react'` if nothing else uses it.
- **Cross-phase note (FE-H1 ↔ Phase 6 CFG-04):** FE-H1 removes the Google s2 remote
  favicon fetch from `SourceFavicon.tsx` **entirely** (the component collapses to the
  glyph tile, above). Phase 6 CFG-04's `SourceFavicon.tsx` sub-step is therefore
  **void** — CFG-04 only creates `frontend/src/config.ts` + DRYs `schoolLogo.ts`.
  **Do not re-introduce a remote favicon here** (or anywhere) under the guise of
  config externalisation; there is no favicon URL left to externalise once FE-H1
  lands. A first-party favicon channel (backend proxy / envelope bytes) is the only
  acceptable way it ever comes back, and that is a separate, deferred Phase-6 option
  — not this finding and not CFG-04.
- **CSP backstop (FE-M9 partner):** add a stopgap `<meta http-equiv="Content-Security-Policy">`
  to `index.html` (see FE-M9 below); with the remote favicon gone, `img-src` can
  be `'self' data:` plus only the origins markdown images legitimately use. The
  server-header CSP is the real control and is **deferred to Phase 6 / deploy**.
- **Note on `StepSourceChip.tsx`:** it renders `source.favicon` (a backend-supplied
  URL, gated to `https://` only via `safeFavicon`). That favicon is *supplied by
  our backend in the step envelope*, not fetched from Google — it does NOT leak
  the same way. Leave `StepSourceChip` as-is; this finding is only about the
  Google endpoint in `SourceFavicon`.
- **Tests to add:** none strictly required (behavior is "no network request").
  Optional guard in `sse-validate` style is overkill; instead add a one-line
  assertion-free render smoke if a `SourceFavicon.test.tsx` is cheap — but the
  **acceptance criterion is the grep below**, enforced in review.
- **Acceptance criteria:**
  - [ ] `grep -rn "s2/favicons" frontend/src/components/citations` returns **zero**
        matches. (Scoped to the citation path — what FE-H1 actually closes. The
        residual `schoolLogo.ts` school-logo fetch is a separate surface, deferred
        to Phase 6 CFG-04 — see TODOS.md. The repo-wide `grep -rn "s2/favicons"
        frontend/src` will still match `schoolLogo.ts`; that match is expected and
        deferred, not a Phase-4 failure.)
  - [ ] `SourceFavicon` renders no `<img>` to any third-party host; the glyph
        tile renders for every source (verify by reading the component).
  - [ ] `npm run typecheck` clean (no unused-import error).
  - [ ] CSP stopgap meta present in `index.html` (shared with FE-M9).

---

### FE-H2 — `useElapsed` stale-closure + never resets across turns → wrong "Thought for N"  [HIGH]

- **Files:** `src/components/timeline/ReasoningTrace.tsx` (`useElapsed`, ≈161–173).
- **Problem:** The effect reads `elapsed` (`const start = performance.now() - elapsed`)
  but excludes it from deps via a suppressed lint, and the hook **never resets to
  0**. When a `ReasoningTrace` instance is reused for a new live turn (React
  reconciles it to the same position), the new turn restarts the interval with
  `start = now - <frozen previous elapsed>`, so the new turn's timer begins at the
  previous turn's duration — the displayed "Thought for N" is the *sum* of both
  turns. `useActivityTicker` was explicitly hardened for instance reuse;
  `useElapsed` was not.
- **⚠️ AUTHORITATIVE-VERSION NOTE (FE-H2 vs FE-M4 — read before coding):** Both
  FE-H2 (here) and FE-M4 (below) show a `useElapsed` snippet, and they differ —
  **FE-M4's version is the FINAL authoritative form and SUPERSEDES the snippet in
  this section.** FE-M4 adds the `reduceMotion` param/gate (coarse tick under
  reduced motion) plus the `TICK_MS`/`TICK_MS_REDUCED` named constants on top of
  this section's cross-turn reset. **Apply FE-H2's reset-logic intent (reset
  `elapsed` to 0 on idle→live, base `start` on `performance.now()` only, drop the
  stale read, remove the lint suppression) but land FE-M4's version as the final
  code.** Do not commit this section's snippet as-is — it is the reset-only
  intermediate; the implementer must end with ONE coherent `useElapsed` that
  contains BOTH the cross-turn reset (FE-H2) AND the reduced-motion gate (FE-M4).
- **Fix:** on every idle→live transition reset `elapsed` to 0 and base `start` on
  `performance.now()` only (drop the stale read). Remove the lint suppression
  (FE-L1) — with `elapsed` no longer read inside the effect, the dep array is
  honest with just `[live]`. **(Final code: see FE-M4 — its `[live, reduceMotion]`
  version is what actually ships; this snippet shows the reset intent only.)**

  **Before:**
  ```tsx
  function useElapsed(live: boolean): number {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
      if (!live) {
        return;
      }
      const start = performance.now() - elapsed;
      const id = setInterval(() => setElapsed(performance.now() - start), 100);
      return () => clearInterval(id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [live]);
    return elapsed;
  }
  ```

  **After:**
  ```tsx
  // The live wall-clock. On every idle→live transition the timer RESTARTS from
  // zero (a reused ReasoningTrace instance must not carry a previous turn's
  // elapsed into the next — FE-H2). `start` is the moment we went live; we never
  // read `elapsed` inside the effect, so the dep array is honest ([live] only)
  // and no lint suppression is needed (FE-L1).
  function useElapsed(live: boolean): number {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
      if (!live) {
        return;
      }
      setElapsed(0);
      const start = performance.now();
      const id = setInterval(() => setElapsed(performance.now() - start), 100);
      return () => clearInterval(id);
    }, [live]);
    return elapsed;
  }
  ```
  Note: a done turn freezes at the last `elapsed` tick (the cleanup stops the
  interval; `live=false` skips the reset), so `TraceHeader`'s
  `formatDurationMs(elapsed > 0 ? elapsed : durationMs)` still prefers the true
  measured wall-clock for turns that ran this session — unchanged behavior, fixed
  reset.
- **Tests to add** (`ReasoningTrace.test.tsx`, with `vi.useFakeTimers()` +
  a `performance.now` advance helper):
  - `resets elapsed to 0 when a reused trace goes idle→live→idle→live` — render
    `<ReasoningTrace status="streaming" …/>`, advance fake timers ~2s, rerender
    with `status="complete"`, then rerender with `status="streaming"` again, and
    assert the displayed timer started near 0 (not ~2s). Drive `performance.now`
    via a monotonic stub so `start` and the interval are deterministic.
- **Acceptance criteria:**
  - [ ] `useElapsed` no longer reads `elapsed` inside its effect.
  - [ ] The `eslint-disable react-hooks/exhaustive-deps` on `useElapsed` is gone
        and `npm run typecheck` / lint stays clean.
  - [ ] The reset test passes (re-live starts the timer at ~0).

---

### FE-H3 — `ThinkNode` keyed on array index in an interleaved append-merge timeline  [HIGH]

- **Files:** `src/components/timeline/ReasoningTrace.tsx` (≈415–420, the
  `timeline.map`); `src/api/turn-reducer.ts` (the `thinking` reduce + the
  `TimelineEntry` type + transcript synthesis).
- **Problem:** The timeline is built in arrival order with steps and thinking
  interleaved. Steps key on `step-${step.step_id}` (stable), but thinking keys on
  `thinking-${i}` — the *positional index in the mixed array*. As steps merge in
  and new thinking lines arrive, the same `i` maps to different thinking text over
  time, and a step inserted before a thinking line shifts every following thinking
  index. React then reuses the wrong DOM node / mis-associates text → during
  streaming, thinking lines can visibly swap/duplicate/animate wrong.
- **Fix:** give every `thinking` timeline entry a **stable id assigned in the
  reducer** (monotonic, never reused), and key on it. The id must be stable across
  re-renders (assign once when the entry is created) and unique. Use a per-entry
  counter derived from the current `thinking.length` at creation — but because
  thinking text can repeat, the id is the ordinal, not the text.

  **`turn-reducer.ts` — extend the timeline entry shape:**
  ```ts
  export type TimelineEntry =
    | { type: 'step'; step: StepData }
    | { type: 'thinking'; id: string; text: string };
  ```

  **`turn-reducer.ts` — the `thinking` case** (the ordinal is the count of
  thinking lines already present, which is monotonic and never reused because the
  reducer only ever appends):
  ```ts
  case 'thinking': {
    const id = `think-${state.thinking.length}`;
    return {
      ...state,
      thinking: [...state.thinking, event.data.text],
      timeline: [...state.timeline, { type: 'thinking', id, text: event.data.text }],
    };
  }
  ```
  (`state.thinking.length` is the next ordinal; it increments by exactly one per
  thinking event and is independent of how many steps interleave, so two thinking
  entries can never collide and an entry's id never changes once created.)

  **`ReasoningTrace.tsx` — the render keys:**
  ```tsx
  {timeline.map((entry) =>
    entry.type === 'step' ? (
      <StepNode key={`step-${entry.step.step_id}`} step={entry.step} />
    ) : (
      <ThinkNode key={entry.id} text={entry.text} />
    ),
  )}
  ```
  (Drop the `, i` index param — it's no longer used.)
- **Transcript path:** `transcriptEntryToEvents` already synthesizes `thinking`
  events from `record.thinking` and replays them through `reduce`, so the same id
  assignment runs for persisted turns automatically — **no separate change
  needed**, but verify the synthesis still routes through `reduce` (it does).
- **Tests to add** (`turn-reducer-thinking.test.ts`):
  - `thinking entries get stable, unique ids that survive interleaved steps` —
    reduce a sequence `thinking("a") → step(start s1) → thinking("b") → step(end
    s1) → thinking("a")`, then assert the three thinking entries have ids
    `think-0`, `think-1`, `think-2` (distinct even though text `"a"` repeats), and
    that re-reducing a later event does not change an earlier entry's id (object
    identity / id stability).
  - `a duplicate thinking text does not collide on key` — two identical thinking
    texts produce two distinct ids.
- **Acceptance criteria:**
  - [ ] `TimelineEntry`'s thinking variant carries an `id: string`.
  - [ ] `ReasoningTrace` keys `ThinkNode` on `entry.id`, never on the array index.
  - [ ] The reducer test proves id stability + uniqueness across interleaving and
        duplicate text.
  - [ ] No other consumer of `TimelineEntry` breaks (`grep -rn "type === 'thinking'"`
        — only `ReasoningTrace` reads `.text`; the new `.id` is additive).

---

### FE-H5 — No error boundary above the honesty surface; a malformed RenderSpec white-screens the chat  [HIGH]

- **Files:** `src/app/ChatView.tsx` (wrap `MessagesView`); new
  `src/components/error/MessagesErrorBoundary.tsx`; `src/components/cards/VizCard.tsx`
  (guard `spec.rows`).
- **Problem:** Only the markdown body is wrapped (`MarkdownErrorBoundary` inside
  `Markdown.tsx`). The surrounding honesty surface — `ReasoningTrace`, `VizCard`,
  `SourcesPanel`, `ClarifyWidget`, the citation providers — has **no** boundary. A
  malformed `RenderSpec` (`spec.rows` undefined → `VizCard`'s `MarkdownFallbackCard`
  does `spec.rows.map` with no guard, and the card components also map `spec.rows`)
  or any thrown error unwinds to the router and white-screens the whole
  conversation. The product streams partial/oddly-shaped backend data into
  clickable cards, so this is a real availability risk.
- **Fix (two layers):**

  **1. A reusable class error boundary** (React boundaries must be class
  components). New file `src/components/error/MessagesErrorBoundary.tsx`:
  ```tsx
  /**
   * MessagesErrorBoundary — catches a render throw anywhere in the chat honesty
   * surface (timeline / cards / sources / clarify / citation providers) and shows
   * an honest "this part couldn't be shown" panel instead of white-screening the
   * whole conversation (FE-H5). Honesty rule: we never fabricate the answer; we
   * say plainly that a piece failed to render.
   */
  import { Component, type ErrorInfo, type ReactNode } from 'react';

  type Props = {
    children: ReactNode;
    /** Optional custom fallback; defaults to the honest inline panel. */
    fallback?: ReactNode;
  };
  type State = { hasError: boolean };

  export default class MessagesErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
      return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
      // Diagnostic only — this is an unexpected render failure, not a normal path.
      // (Routed through console deliberately; the logger seam is Phase 5/FE-CONSOLE-WARN.)
      console.error('[chat] a message failed to render', error, info.componentStack);
    }

    render(): ReactNode {
      if (this.state.hasError) {
        return (
          this.props.fallback ?? (
            <div
              role="alert"
              className="not-prose my-3 rounded-xl border border-border-light bg-surface-primary-alt px-4 py-3 text-sm text-text-secondary"
            >
              Something in this conversation couldn’t be displayed. The rest of
              your chat is unaffected — try reloading if it persists.
            </div>
          )
        );
      }
      return this.props.children;
    }
  }
  ```

  **2. Wrap `MessagesView` in `ChatView.tsx`** (the in-conversation branch only —
  Landing has no messages):
  ```tsx
  import MessagesErrorBoundary from '@/components/error/MessagesErrorBoundary';
  // …
  {isLandingPage ? (
    <Landing centerFormOnLanding={CENTER_FORM_ON_LANDING} />
  ) : (
    <MessagesErrorBoundary>
      <MessagesView />
    </MessagesErrorBoundary>
  )}
  ```
  (Per-card boundaries are *nice-to-have*; the MessagesView-level boundary is the
  required floor. If cheap, also wrap the docked `SourcesPanel`/`ArtifactPanel`
  render in the right pane — same component — so a bad panel spec can't take the
  chat with it. This is optional but encouraged.)

  **3. Guard `spec.rows` in `VizCard.tsx`** so the common malformed-payload case
  degrades to an honest card instead of throwing. `RenderSpec.rows` is the field
  the wave1 report flagged as unguarded.

  **Before** (`MarkdownFallbackCard`):
  ```tsx
  <div className="space-y-1">
    {spec.rows.map((row, i) => (
      <div key={`${row.label}-${i}`} …>
        {row.label}: {row.cells[0]?.available ? row.cells[0].display : 'not available'}
      </div>
    ))}
  </div>
  ```
  **After:**
  ```tsx
  <div className="space-y-1">
    {(spec.rows ?? []).map((row, i) => (
      <div key={`${row.label}-${i}`} …>
        {row.label}: {row.cells[0]?.available ? row.cells[0].display : 'not available'}
      </div>
    ))}
  </div>
  ```
  Apply the same `(spec.rows ?? [])` defensive read in `StatBlockCard` and
  `ComparisonTableCard` where they `spec.rows.map(...)` (both currently assume
  `rows` is an array). Also keep their existing `spec.schools[0]` / `school`
  guards. This makes a `rows`-less spec render an empty-but-titled card (degrade,
  per PRD story 35) rather than throw — and the boundary catches anything else.
- **Tests to add** (`MessagesErrorBoundary.test.tsx`):
  - `renders the honest fallback when a child throws` — render
    `<MessagesErrorBoundary><Thrower/></MessagesErrorBoundary>` where `Thrower`
    throws on render; assert the `role="alert"` fallback text is present and the
    thrown content is NOT. (Silence the expected `console.error` with a
    `vi.spyOn(console, 'error').mockImplementation(() => {})` in the test.)
  - `renders children normally when no throw`.
  - Optionally a `VizCard.test.tsx`: `renders without throwing when spec.rows is
    undefined` (cast a partial spec) — asserts the title renders and no throw.
- **Acceptance criteria:**
  - [ ] `MessagesErrorBoundary` exists and is a class component using
        `getDerivedStateFromError`.
  - [ ] `ChatView` wraps `MessagesView` in it.
  - [ ] `VizCard` (+ StatBlock + ComparisonTable) read `spec.rows ?? []` before `.map`.
  - [ ] Boundary test proves the fallback renders on a child throw; the children
        render normally otherwise.

---

### FE-FEEDBACK-STALE — Feedback thumb copied into `useState` once, never re-synced to server truth  [HIGH]

- **Files:** `src/vendor/librechat/app/hooks/Messages/useMessageActions.tsx`
  (≈49–51 the `useState` initializer; no sync effect anywhere).
- **Problem:** `useState(() => message?.feedback ? {rating} : undefined)` runs the
  initializer **once at mount**. `message.feedback` comes from ChatContext's
  transcript projection. The row's `key={message.messageId}` is stable, so the
  instance survives across `message.feedback` changes (a `retryTranscript()` /
  `invalidateQueries([chats])`-driven re-read that replaces the entry with a
  server-joined rating; or navigating away and back without unmount). The local
  state ignores the new server truth → the displayed thumb can show a rating that
  was cleared/changed server-side. The optimistic *write* path is correct; the
  *read/refresh* path is missing. This is the "never claim a feedback state the
  backend didn't persist" honesty rule failing on refresh.
- **Fix (recommended — minimal, preserves the optimistic write):** add a sync
  effect that re-pulls `message.feedback` whenever the *server's* rating changes.
  Keep the optimistic `setFeedback` in `handleFeedback` exactly as-is (it paints
  immediately and rolls back on error); the effect only re-aligns to server truth
  when the projection updates.

  **Add** (after the `useState`, ≈line 51):
  ```tsx
  import { useCallback, useEffect, useMemo, useState } from 'react';
  // …
  const [feedback, setFeedback] = useState<TFeedback | undefined>(() =>
    message?.feedback ? { rating: message.feedback.rating } : undefined,
  );

  // Re-sync the thumb to server truth when the projection's rating changes
  // (a transcript re-read / chats invalidation can replace this message with a
  // server-joined rating after mount; the instance survives the stable key, so
  // without this the local copy drifts and could show a rating the backend no
  // longer holds — FE-FEEDBACK-STALE). The optimistic write in handleFeedback
  // is unaffected: it sets local state synchronously, and a successful write
  // makes the next projection match, so this effect is a no-op then.
  useEffect(() => {
    setFeedback(message?.feedback ? { rating: message.feedback.rating } : undefined);
  }, [message?.feedback?.rating]);
  ```
  **Why key the effect on `message?.feedback?.rating` (the scalar) and not the
  object:** `message.feedback` is a fresh object each projection even when the
  rating is unchanged, which would re-run the effect every render and could clobber
  an in-flight optimistic value with the same scalar (harmless) — keying on the
  scalar rating runs the effect only on a real change. An optimistic write that is
  later confirmed produces a projection whose `rating` equals the optimistic one,
  so the effect's `setFeedback` is value-equal and React bails out of the re-render.
  An optimistic write that is *rolled back* (server rejected) already restores
  `previous` in `onError`, and the projection never changed, so the scalar dep
  doesn't fire — consistent.
- **Tests to add** (`useMessageActions.test.tsx`, using
  `@testing-library/react`'s `renderHook` with a small wrapper that provides
  `ChatContext` + the feedback-mutation query client — or, if wiring the full
  context is heavy, a thin unit that exercises the effect by rerendering the hook
  with changed `message.feedback.rating` and asserting the returned `feedback`
  tracks it). Minimum:
  - `feedback re-syncs when message.feedback.rating changes after mount` — mount
    with `rating: 'thumbsUp'`, rerender props with `rating: undefined` (cleared
    server-side), assert the hook's returned `feedback` becomes `undefined`.
  - If the full mutation context is impractical to stand up, document that and
    cover the sync logic via a tiny extracted pure helper instead — but prefer the
    hook test.
- **Cross-phase note:** Phase 5's FE-CHATCONTEXT-GOD may later lift feedback fully
  into the projection (render as a pure prop, drive optimism through React Query's
  mutation cache). Phase 4 does the **contained** fix (sync effect); do NOT do the
  larger lift here — leave the seam for Phase 5.
- **Acceptance criteria:**
  - [ ] A `useEffect` syncing `setFeedback` from `message?.feedback?.rating` exists.
  - [ ] The optimistic write + rollback in `handleFeedback` is unchanged.
  - [ ] The re-sync test passes.

---

### FE-ATTACH-CURSOR — Reattach on a fresh page load can't resume mid-turn (cursor only in-memory; `attachTurn` passes no Last-Event-ID)  [HIGH]

- **Files:** `src/api/http/transport.ts` (the in-memory `cursors` map +
  `streamEvents` cursor writes + `attach`); `src/app/ChatContext.tsx`
  (`attachTurn`, ≈538–580, calls `transport.attach(convoId)` with no second arg).
- **Problem:** `HttpTransport.cursors` is an instance `Map`; `httpTransport` is a
  module singleton, so the map is wiped on every full page load / hard refresh.
  `attach()` resolves its cursor from `lastEventId ?? this.cursors.get(sessionId)`,
  and the only caller (`attachTurn`) passes no `lastEventId`. So on a fresh load
  the cursor is empty and no Last-Event-ID is threaded → the backend either
  replays the entire turn from seq 0 (duplicate events) or, if it treats a missing
  Last-Event-ID as "start fresh", loses the already-streamed prefix. "Reattach
  across a refresh" — the most important case (user reloads while a turn runs) — is
  effectively non-functional.
- **Fix (recommended — persist the cursor durably in `sessionStorage`):** make the
  transport's cursor survive a reload by mirroring it to `sessionStorage` keyed by
  session id, and read it back on `attach`. `sessionStorage` (not `localStorage`)
  is correct: a turn's seq cursor is per-tab/per-session ephemeral state, not a
  user preference; it must NOT bleed across tabs or persist after the tab closes.

  **`transport.ts` — replace the in-memory map's writes/reads with a durable seam.**
  Keep the in-memory `Map` as a fast cache, but persist on write and fall back to
  `sessionStorage` on read:
  ```tsx
  export class HttpTransport implements Transport {
    private readonly cursors = new Map<string, string>();

    /** sessionStorage key for a session's Last-Event-ID cursor (per-tab, ephemeral). */
    private cursorKey(sessionId: string): string {
      return `counselle:cursor:${sessionId}`;
    }

    private setCursor(sessionId: string, id: string): void {
      this.cursors.set(sessionId, id);
      try {
        sessionStorage.setItem(this.cursorKey(sessionId), id);
      } catch {
        // sessionStorage unavailable (privacy mode / SSR) — the in-memory map
        // still works within this page load; durability is best-effort.
      }
    }

    private getCursor(sessionId: string): string | undefined {
      const mem = this.cursors.get(sessionId);
      if (mem !== undefined) {
        return mem;
      }
      try {
        return sessionStorage.getItem(this.cursorKey(sessionId)) ?? undefined;
      } catch {
        return undefined;
      }
    }

    private clearCursor(sessionId: string): void {
      this.cursors.delete(sessionId);
      try {
        sessionStorage.removeItem(this.cursorKey(sessionId));
      } catch {
        // best-effort
      }
    }
    // …
  }
  ```
  **Route `streamEvents` through these:**
  ```tsx
  for await (const frame of parseSseStream(response.body)) {
    if (frame.id !== undefined) {
      this.setCursor(sessionId, frame.id);
    }
    yield frame.event;
    if (frame.event.type === 'done' || frame.event.type === 'error') {
      this.clearCursor(sessionId);   // terminal — the next turn restarts seq
    }
  }
  ```
  **`sendMessage` drops the stale cursor** (a new turn restarts seq):
  ```tsx
  this.clearCursor(sessionId);
  ```
  **`attach` reads the durable cursor:**
  ```tsx
  async *attach(sessionId: string, lastEventId?: string) {
    const cursor = lastEventId ?? this.getCursor(sessionId);
    const headers: Record<string, string> = cursor !== undefined ? { 'Last-Event-ID': cursor } : {};
    // … (unchanged below)
  }
  ```
- **Backend contract — DECIDE + DOCUMENT (required by this finding):** the FE now
  always supplies a Last-Event-ID *when it has streamed at least one frame this
  session-tab before reloading*. But on a **brand-new tab that never streamed this
  turn** (e.g. another tab started it), there is still no cursor → `attach` sends
  no `Last-Event-ID`. The contract for "attach with no Last-Event-ID" must be
  pinned. **Recommended contract:** *the backend replays the FULL turn from seq 0
  when no Last-Event-ID is present, and replays only events after the cursor when
  it is present (tail-only).* This is the safe default — full replay never *loses*
  the prefix; the FE already dedups identity via meta-id reconciliation in
  `consumeStream` (it adopts backend ids; a re-sent prefix re-reduces idempotently
  because the reducer merges steps by `step_id` and appends deltas — note: a full
  delta replay would *double* prose, so the FE must also guard, see below).
  - **FE replay-safety guard (add to `consumeStream` / the attach replay):** when
    attaching with no cursor and the backend full-replays, the reducer would
    append delta text twice if any prefix was already shown. Since `attachTurn`
    starts from `initialTurnState()` (a fresh reducer) and the transcript read
    already populated `persisted` separately, the *attach* stream reduces into a
    fresh turn state — so a full replay reduces cleanly into one coherent turn (no
    doubling within the attach stream itself). The dedup concern is only if the
    same physical frame is yielded twice within one stream, which the backend
    contract forbids. **Document this in the wire-contract** (see below) and add a
    code comment at `attachTurn` stating the assumed contract.
  - **Where to document:** add the resolved contract to
    `specs/mvp2/plan/wire-contract.md` §6 (Last-Event-ID) — one paragraph:
    "GET `/sessions/{id}/stream` with no `Last-Event-ID` ⇒ full replay from seq 0;
    with a `Last-Event-ID` ⇒ tail-only (events with seq > cursor). The FE persists
    the cursor in `sessionStorage` per tab so a reload threads the tail; a
    never-streamed tab gets the full replay." **This is a doc note only — no wire
    version bump** (consistent with REMEDIATION-PLAN §5 non-goals). If Phase 1's
    backend Last-Event-ID work (BC-06) contradicts this, defer to Phase 1's
    resolution and update this note — coordinate (cross-phase note below).
- **Tests to add** (`transport.test.ts` if one exists, else a focused new file):
  - `attach reads a persisted cursor from sessionStorage after a simulated reload`
    — set `sessionStorage['counselle:cursor:S'] = '7'`, construct a *new*
    `HttpTransport` (simulating a reload's fresh singleton), stub `fetch` to
    capture headers, call `attach('S')`, assert the request carried
    `Last-Event-ID: 7`.
  - `a terminal event clears the persisted cursor` — drive `streamEvents` (or
    `sendMessage`) through a `done` frame, assert `sessionStorage` no longer holds
    the key.
  - `sendMessage clears a stale cursor before streaming`.
  - (Use `jsdom` `sessionStorage`; `src/test/setup.ts` installs a memory
    `localStorage` — add a `sessionStorage` in-memory stub to `setup.ts`, mirroring
    the existing `localStorage` stub (jsdom's is inert).)
- **Cross-phase note:** the backend side of Last-Event-ID is **Phase 1 (BC-06)**.
  Phase 4 only does the FE durability + the documented FE-side contract assumption.
  If Phase 1 changes the contract, reconcile. Also: `attachTurn` lives in
  ChatContext, which Phase 5 (FE-CHATCONTEXT-GOD) refactors — keep this change
  surgical so it survives the later extraction.
- **Acceptance criteria:**
  - [ ] The transport persists/reads/clears the cursor via `sessionStorage`
        (`counselle:cursor:<id>`), with try/catch around every storage call.
  - [ ] `attach` supplies `Last-Event-ID` from the durable cursor when present.
  - [ ] `sendMessage` and terminal events clear the cursor (mem + storage).
  - [ ] The "attach with no Last-Event-ID" contract is documented in
        `wire-contract.md` §6 and referenced by a comment at `attachTurn`.
  - [ ] The reload-cursor and terminal-clear tests pass.
  - [ ] `src/test/setup.ts` provides a working `sessionStorage` for tests.

---

### FE-SSE-NOSCHEMA — SSE frames cast to `ProtocolEvent` with only a `type`-membership check  [MEDIUM]

- **Files:** `src/api/http/sse.ts` (`parseFrame`, ≈84–92 the trust-boundary cast).
- **Problem:** Only `obj.type` is validated against `KNOWN_TYPES`; `obj.data` is
  `as unknown as ProtocolEvent` — no per-type payload validation. The reducer and
  projection then read `event.data.text`, `event.data.message_id`,
  `event.data.step_id` as if typed. A backend bug or version skew (a `meta`
  without `message_id`, a `step` without `step_id`) flows straight into identity
  reconciliation as `undefined` — e.g. `assistantMessageId = event.data.message_id`
  becomes `undefined`, corrupting addressing — with no guard. The SSE path is the
  *primary* data path and is the only place not defensive (`fromWire` in
  `source-config.ts` is carefully validated; the SSE path is the gap).
- **Fix:** add **lightweight per-type guards** for the **identity-bearing /
  load-bearing** events (`meta`, `step`, `done`, `error`), and drop frames that
  fail validation (same `console.warn` + `return null` as the existing
  malformed-frame handling — the stream survives; the reducer never sees a
  half-typed identity event). Keep it dependency-free (no Zod needed for four
  small shapes; hand-rolled guards match the repo's `fromWire` discipline and the
  KISS rule). Non-identity events (`delta`, `thinking`, `viz`, `clarify`,
  `sources`, `usage`) keep the trust cast — the reducer tolerates their shapes and
  a malformed one degrades visually rather than corrupting identity.

  **Add to `sse.ts` (above `parseFrame`):**
  ```ts
  function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null;
  }
  function isNonEmptyString(v: unknown): v is string {
    return typeof v === 'string' && v.length > 0;
  }

  /**
   * Per-type validation for the IDENTITY-BEARING events whose missing fields
   * would silently corrupt identity reconciliation in consumeStream (FE-SSE-
   * NOSCHEMA). A frame that fails is dropped like any malformed frame — the
   * stream survives, the reducer never sees a half-typed meta/step/done/error.
   * Non-identity events (delta/thinking/viz/clarify/sources/usage) keep the
   * trust cast: the reducer tolerates their shapes and degrades visually.
   */
  function validatePayload(type: ProtocolEventType, obj: Record<string, unknown>): boolean {
    const data = obj.data;
    switch (type) {
      case 'meta':
        // message_id is load-bearing (assistantMessageId); user_message_id is
        // adopted but may legitimately differ — require message_id only.
        return isObject(data) && isNonEmptyString(data.message_id);
      case 'step':
        return isObject(data) && isNonEmptyString(data.step_id) && isNonEmptyString(data.status as string);
      case 'done':
        return isObject(data) && isNonEmptyString(data.status as string);
      case 'error':
        return isObject(data) && isNonEmptyString(data.message);
      default:
        return true; // non-identity events: trusted (degrade-tolerant)
    }
  }
  ```
  **Wire it into `parseFrame` (after the `isKnownType` check):**
  ```ts
  if (!isKnownType(obj.type)) {
    console.warn(`[sse] dropped a frame with unknown type: ${String(obj.type)}`);
    return null;
  }
  if (!validatePayload(obj.type, obj)) {
    console.warn(`[sse] dropped a malformed ${obj.type} frame (missing identity field)`);
    return null;
  }
  return { event: obj as unknown as ProtocolEvent, id };
  ```
- **Tests to add** (`sse-validate.test.ts` — feed raw frame strings through
  `parseSseStream` over a `ReadableStream` built from a `TextEncoder`, mirroring
  any existing sse test harness; if none exists, build a tiny
  `streamOf(...frames: string[])` helper):
  - `drops a meta frame missing message_id` — a `meta` frame with `data: {}` is
    not yielded; a well-formed `meta` is.
  - `drops a step frame missing step_id`.
  - `drops a done frame missing status`; `drops an error frame missing message`.
  - `passes a delta/thinking frame unchanged` (non-identity events still flow).
  - Each drop logs a `console.warn` (spy it; assert called) and does NOT throw.
- **Acceptance criteria:**
  - [ ] `validatePayload` exists and is called in `parseFrame` for meta/step/done/error.
  - [ ] Malformed identity frames are dropped (return null) with a `console.warn`;
        the stream is not aborted.
  - [ ] Non-identity events are unaffected.
  - [ ] The validation tests pass; no new dependency added (no Zod).

---

### FE-M1 — Misleading aria source counts (preview strip + live strip)  [MEDIUM]

- **Files:** `src/app/MessagePreview.tsx` (≈364, `aria-label={"Sources: N web
  sources"}` — DEV-only); `src/components/citations/SourcesStrip.tsx` (≈76, the
  live `aria-label`).
- **Problem:** The preview strip announces "N web sources" using only the external
  count, even though its panel leads with the Counselle-data card. The **live**
  strip is already better — `aria-label={"View ${countLabel} for this answer"}`
  where `countLabel` uses `displayCount` (externals + 1 for the DB card). The
  residual live issue: when a DB entry is present the announced count includes the
  Counselle card but the *favicon stack* a screen-reader user perceives is
  externals-only, so "N sources" can exceed the visible logos with no explanation.
- **Fix:**
  - **Live (`SourcesStrip.tsx`) — the real fix:** when the cited set includes a DB
    source, phrase the label so the extra count is explained. Thread a small
    `hasDbSource` signal (or derive it: `displayCount > cited.length` already means
    "a DB card is counted beyond the external favicons"). Change `countLabel` /
    `aria-label`:
    ```tsx
    const labelCount = effectiveCount;
    const includesData = displayCount !== undefined && displayCount > cited.length;
    const countLabel = `${labelCount} ${labelCount === 1 ? 'source' : 'sources'}`;
    const ariaLabel = includesData
      ? `View ${countLabel} for this answer, including Counselle data`
      : `View ${countLabel} for this answer`;
    // …
    aria-label={ariaLabel}
    ```
    (Visible text stays `countLabel`; only the accessible name gains the
    "including Counselle data" clause when a DB card is counted.)
  - **Preview (`MessagePreview.tsx`) — DEV-only, trim per FE-M5:** if `SourcesStripPreview`
    survives the FE-M5 trim, fix its aria to use `displaySourceCount(...)` and the
    same "including Counselle data" phrasing; if FE-M5 deletes it in favor of the
    real `SourcesStrip`, this is moot. Do **not** invest beyond a one-line aria
    correction — it's excluded from prod.
- **Tests to add:** a `SourcesStrip.test.tsx` assertion:
  - `announces "including Counselle data" when displayCount exceeds the external
    cited count` — render with `sources=[1 external]`, `displayCount={2}`, assert
    the button's accessible name contains "including Counselle data".
  - `announces a plain count when there is no DB card` — `displayCount` equals
    externals → no extra clause.
- **Acceptance criteria:**
  - [ ] The live strip's accessible name explains the count when a Counselle-data
        card is included.
  - [ ] The preview strip's aria is corrected or removed (FE-M5).
  - [ ] The strip aria test passes.

---

### FE-M2 — "+N more" source-overflow indicator is unreachable and labels a non-interactive span  [MEDIUM]

- **Files:** `src/components/timeline/ReasoningTrace.tsx` (`SourceChips`, ≈186–202).
- **Problem:** When a step has >4 sources, the overflow renders a plain `<span>`
  with `aria-label="and N more sources"` and no way to reveal the hidden chips —
  sources 5+ are unreachable for keyboard/AT users, and an `aria-label` on a
  static span reads as a labelled element with no role.
- **Fix:** make "+N more" a real `<button>` that expands the remaining chips
  inline (toggle local state). Keyboard-focusable, `aria-expanded`, real role.
  ```tsx
  function SourceChips({ sources, kind, query }: { sources: StepSource[]; kind: StepKind; query?: string; }) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? sources : sources.slice(0, MAX_VISIBLE_CHIPS);
    const extra = sources.length - visible.length;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visible.map((s, i) => (
          <StepSourceChip key={s.url ?? `${s.label}-${i}`} source={s} kind={kind} index={i} query={query} />
        ))}
        {extra > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            className="rounded px-1 py-0.5 text-xs text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy"
          >
            +{extra} more
          </button>
        )}
      </div>
    );
  }
  ```
  (One-way expand is fine — once revealed there's no "show less" need; if a
  collapse toggle is trivial, add it with `aria-expanded={expanded}` and a
  "Show fewer" label. Keep it simple.) Note `useState` is already imported in this
  file.
- **Tests to add:** in `ReasoningTrace.test.tsx`:
  - `+N more reveals the hidden chips on click` — render a step with 6 sources,
    assert 4 chips + a "+2 more" button, click it, assert 6 chips and the button
    gone.
- **Acceptance criteria:**
  - [ ] "+N more" is a focusable `<button>`, not an aria-labelled span.
  - [ ] Clicking it reveals the remaining chips.
  - [ ] The expand test passes.

---

### FE-M3 — Composer silently rejects files; decorative upload promises a capability the backend can't fulfill  [MEDIUM]

- **Files:** `src/components/composer/CounselleComposer.tsx` (`processFile`, ≈76–86;
  the Paperclip upload affordance ≈222–240; the voice/recording affordance).
- **Problem:** `processFile` does `if (!isImageFile(file)) return; if (file.size >
  MAX_FILE_BYTES) return;` — a student who drops a PDF or a 20 MB image gets
  *nothing* (no toast, no message). Worse, the whole image-upload path is
  **decorative**: files are never transmitted (the turn endpoint has no image
  channel — the recorder comment confirms voice is decorative too). The Paperclip
  + drag/paste UI promises a capability the backend can't fulfill — a small
  honesty/UX smell.
- **Fix (recommended — honesty-first, value×ease):** **hide the upload + voice
  affordances** rather than wire a fake error channel for a fake capability.
  Per CLAUDE.md (don't promise what the backend can't do; never lie to a student),
  the honest move is to not show an upload button that drops everything silently
  and never sends anything. This is *easier* and *more honest* than adding toast
  plumbing for a dead feature.
  - Gate the Paperclip `<PromptInputAction tooltip="Upload image">…</PromptInputAction>`
    block and the file `<input>` behind a `IMAGE_UPLOAD_ENABLED` constant set
    `false` (a named constant, not a magic literal — and a clean re-enable seam for
    when a real image channel lands). Same for the voice/`Mic` path: the send
    button's `else setIsRecording(true)` fallback should not start a decorative
    recording — when there's no content, the button should be disabled or omitted
    rather than entering a recording UI that submits nothing.
  - Keep the drag/paste handlers harmless (they currently `processFile` which now
    no-ops with the feature off) — but since the affordance is hidden, also make
    `processFile` a no-op or drop the drop/paste wiring when `IMAGE_UPLOAD_ENABLED`
    is false, so a dropped PDF doesn't even appear to do anything.
  - Add a short comment citing FE-M3 and the missing backend channel.
  ```tsx
  // No image/voice channel exists in the MVP2 turn endpoint, so these affordances
  // are hidden rather than shown as silent no-ops that drop files / record nothing
  // (FE-M3 — never promise a capability the backend can't fulfill). Flip to true
  // when a real upload/voice channel lands (and add the send-side wiring + an
  // honest rejection toast then).
  const IMAGE_UPLOAD_ENABLED = false;
  const VOICE_ENABLED = false;
  ```
  Wrap the Paperclip block in `{IMAGE_UPLOAD_ENABLED && (…)}` and the recording /
  Mic fallback behind `VOICE_ENABLED`. With both off, the send button is
  enabled only when `hasContent` (text), and disabled otherwise — no Mic fallback.
- **Alternative (only if the team wants to keep the affordances):** surface a brief
  inline rejection message on `processFile` bail (a small text under the composer,
  not a global toast) AND keep them — but this still promises a capability that
  does nothing, so the recommended path (hide) is preferred. Pick one; document
  the choice in the commit.
- **⚠️ SHARED-FILE cross-phase note (Phase 4 ↔ Phase 5 — `CounselleComposer.tsx`):**
  `CounselleComposer.tsx` is touched by **both** phases — Phase 4 here (FE-M3: hide
  the dead upload/voice affordances + the FE-L8 file-preview cleanup) and Phase 5
  (FE-SOURCECFG-DUAL: remove the `handleSourcesReread`/`onSourcesReread` plumbing).
  `src/components/source-control/SourceDropdown.tsx` is also in this plumbing's
  blast radius, but note: it has **no** `onSourcesReread` prop — its signature is
  `SourceDropdown({ conversationId })` and it re-reads source config via its own
  internal popover-open effect, not a parent callback. (`onSourcesReread` is a
  prop on `CounselleComposer.tsx`, wired by `ChatComposer.tsx`.) Phase 4 does not
  modify `SourceDropdown.tsx`; its precise disposition is owned by Phase 5 — see
  Phase 5 FE-SOURCECFG-DUAL / FE-DEAD-CHATFORM (deleting `ChatForm.tsx`, its only
  importer, may render `SourceDropdown.tsx` dead). Phase 4 lands first (its tests are Phase 5's safety net), so the
  Phase-4 FE-M3/FE-L8 edits are the baseline. **Phase 5 MUST read the current state
  of `CounselleComposer.tsx` after Phase 4 has landed and merge cleanly — it must
  NOT revert FE-M3's `IMAGE_UPLOAD_ENABLED`/`VOICE_ENABLED` gating or FE-L8's
  preview cleanup while ripping out the source-reread plumbing.** This file appears
  in the "shared files" check in the phase completion checklist below.
- **Tests to add:** a `CounselleComposer.test.tsx` smoke:
  - `does not render the upload affordance while image upload is disabled` —
    render the composer, assert no "Upload image" control.
  - `the send button is not a Mic/record fallback when there is no content and
    voice is disabled` — render with empty text, assert the action is disabled (or
    not a Mic-record trigger).
- **Acceptance criteria:**
  - [ ] No silent file drop reaches the user (either the affordance is hidden, or
        a rejection is surfaced — recommended: hidden).
  - [ ] `IMAGE_UPLOAD_ENABLED` / `VOICE_ENABLED` are named constants, defaulting
        false, with a re-enable comment.
  - [ ] The composer no longer presents a Paperclip/upload that drops everything,
        nor a Mic that records nothing.
  - [ ] The composer smoke test passes.

---

### FE-M4 — Elapsed timer ticks 10×/s with no reduced-motion gate; dead-air ticker re-renders the header  [MEDIUM]

- **Files:** `src/components/timeline/ReasoningTrace.tsx` (`useElapsed` ≈161–173
  after the FE-H2 fix; `useActivityTicker`'s dead-air interval ≈139–154).
- **Problem:** `useElapsed` ticks every 100ms (a changing number = motion) with
  **no** reduced-motion gate, while the dead-air placeholder rotates words every
  1.9s — combined, the header re-renders ~10×/s during dead air. Reduced-motion
  users who want suppressed motion still see the number churn. (The ticker's word
  rotation IS already reduced-motion-gated — good.)
- **⚠️ AUTHORITATIVE-VERSION NOTE (FE-M4 vs FE-H2 — this is the final form):**
  This section's `useElapsed` snippet is the **FINAL authoritative form** and
  **SUPERSEDES the snippet in FE-H2.** It already incorporates FE-H2's cross-turn
  reset (`setElapsed(0)` on idle→live, `start = performance.now()`, no stale read,
  no lint suppression) AND adds the reduced-motion gate (`reduceMotion` param,
  `TICK_MS`/`TICK_MS_REDUCED`, `[live, reduceMotion]` deps). **Apply FE-H2's
  reset-logic intent but land THIS version as the final code** — the implementer
  must end with ONE coherent `useElapsed` containing both the cross-turn reset
  (FE-H2) and the reduced-motion gate (FE-M4). Do not ship two `useElapsed`
  variants; this is the single one.
- **Fix:**
  - **Reduced-motion gate on the visible timer:** under `useReducedMotion()`, tick
    the *displayed* elapsed coarsely (e.g. once per second) — or freeze the visible
    number and only update on settle. Simplest honest option: when reduced motion
    is on, use a **1000ms** interval instead of 100ms (the duration is still
    correct; it just doesn't animate sub-second). Thread `reduceMotion` into
    `useElapsed`:
    ```tsx
    import { useReducedMotion } from 'framer-motion'; // already imported

    const TICK_MS = 100;
    const TICK_MS_REDUCED = 1000;

    function useElapsed(live: boolean): number {
      const [elapsed, setElapsed] = useState(0);
      const reduceMotion = useReducedMotion();
      useEffect(() => {
        if (!live) {
          return;
        }
        setElapsed(0);
        const start = performance.now();
        const period = reduceMotion ? TICK_MS_REDUCED : TICK_MS;
        const id = setInterval(() => setElapsed(performance.now() - start), period);
        return () => clearInterval(id);
      }, [live, reduceMotion]);
      return elapsed;
    }
    ```
    (Replace the inline `100` magic number with `TICK_MS` — also satisfies the
    no-magic-numbers rule.)
  - **Header isolation:** verify the two intervals re-render only the header, not
    the step list. `StepNode` is already `memo`'d and the timeline maps stable
    keys (after FE-H3), so the `setShown`/`setElapsed` state lives in `TraceHeader`
    and the `Collapsible.Content` step list does not depend on it — confirm by
    reading the component tree (the header state is in `TraceHeader`; the content
    maps `timeline` which is a prop, unaffected by header state). If the list *does*
    re-render, extract `TraceHeader`'s timer state so it's truly isolated. Document
    the verification in the commit; no code change if already isolated.
- **Tests to add:** (optional, low value) a `ReasoningTrace.test.tsx` case under a
  mocked `useReducedMotion → true` asserting the timer updates at the coarse
  cadence — only if cheap with fake timers; otherwise the acceptance criterion is
  code review of the gate.
- **Acceptance criteria:**
  - [ ] `useElapsed` uses a coarse tick under reduced motion.
  - [ ] The `100` literal is a named constant.
  - [ ] Header timer/ticker state is confirmed isolated from the step list (noted
        in the commit) or extracted to make it so.

---

### FE-M5 — `MessagePreview` (DEV-only) duplicates production logic and demonstrates a less-honest highlight rule  [MEDIUM]

- **Files:** `src/app/MessagePreview.tsx` (whole file; esp. `DbClaimPreview` and
  the re-implemented `SourcesStripPreview` / `SourcesPanelPreview` / `PanelHeader`).
- **Problem:** `MessagePreview` re-implements live components and **deliberately
  restores the old unconditional-highlight behavior** ("highlight whenever revealed
  is on, regardless of source"), re-copies the private `highlightClass`, and
  re-implements live strips/panels. It's ~560 lines of near-duplicate that can
  drift from prod silently and visually demonstrates a *different, less honest*
  reveal rule than production ships — a reviewer eyeballing it would conclude the
  reveal lights all claims, which is false.
- **Scope (TRIM only — it's DEV-only, excluded from prod):** do **not** rebuild it
  and do not invest. Two cheap, high-value moves:
  1. **Import the real components** where the preview re-implements them — replace
     `SourcesStripPreview`/`SourcesPanelPreview`/`PanelHeader` with the real
     `SourcesStrip` / `SourcesPanel` fed sample props, and the `previewHighlightClass`
     copy with the real `DbClaim` path. Delete the duplicated styling.
  2. **If the unconditional-highlight demo must stay** (to show the *old* behavior
     for comparison), **label it loudly** in the on-screen UI and a header comment:
     "NOT PRODUCTION BEHAVIOR — production lights only DB-sourced clauses (FE-C1)."
     Prefer deleting the demo over keeping a misleading one.
- **Cross-phase note:** FE-C1 (Phase 2) fixes the *live* reveal-clause bounding;
  this finding only stops the DEV harness from advertising the wrong rule. Don't
  pre-empt Phase 2's live fix here.
- **Tests to add:** none (DEV-only, not on the prod path; no test budget).
- **Acceptance criteria:**
  - [ ] `MessagePreview` no longer re-copies the private `highlightClass` /
        re-implements `SourcesStrip`/`SourcesPanel` (imports the real ones), OR the
        remaining demo is loudly labeled "NOT PRODUCTION BEHAVIOR".
  - [ ] No new production code depends on `MessagePreview`.
  - [ ] The file's net line count drops materially (duplication removed).

---

### FE-M6 — `proseOf` joins markdown blocks with `\n\n`, eliding viz blocks; fallback can mis-reflect render order  [MEDIUM]

- **Files:** `src/api/turn-reducer.ts` (`proseOf`, ≈183–188); consumed by
  `citedIndexesForMessage`'s fallback (`remarkCitations.ts`) and `dbIndicesForMessage`.
- **Problem:** `proseOf` concatenates only markdown blocks with `\n\n`, dropping
  viz blocks from the middle. The `message.text` fallback is used by the citation
  digit-scan when `content` blocks are absent. A viz block between two markdown
  blocks is elided, so a sentence/citation split around a card is glued with
  `\n\n` — harmless for a *digit scan* (the only consumer), but the fallback no
  longer reflects render order. The primary path uses `content` blocks (fine); the
  fallback is legacy-only, so impact is limited.
- **Fix (documentation + invariant, not behavior change):** this is a latent
  correctness gap, not a live bug — the fix is to **document the contract** so it
  doesn't become load-bearing, and ensure live turns always carry `content`.
  - Add a doc comment to `proseOf` stating it is the persisted `text` field and is
    **digit-scan-only** (never used for clause wrapping; clause wrapping always
    uses `content` blocks). Add a matching note to `citedIndexesForMessage`'s
    fallback branch: "the `fallbackText` path is digit-scan-only for legacy entries
    without `content`; live turns always carry `content`."
  - No code behavior change. (Per REMEDIATION-PLAN, FE-H4's deeper DB-overcount
    rework is Phase 2 — do not touch the derivation logic here.)
- **Tests to add:** none required (doc-only). Optionally a one-line assertion that
  `proseOf` joins markdown blocks (already covered indirectly) — skip if no value.
- **Acceptance criteria:**
  - [ ] `proseOf` and the `citedIndexesForMessage` fallback carry the
        "digit-scan-only, never clause-wrapping" doc note.
  - [ ] No behavior change to the derivation (verified by existing tests staying green).

---

### FE-M7 — Inline `SourcePill` uses a fixed `translate-y` em offset that can clip/misalign in table cells  [MEDIUM]

- **Files:** `src/components/citations/SourcePill.tsx` (≈38–43, the `translate-y-[0.12em]
  … leading-none … align-baseline` block).
- **Problem:** The pill is tuned for editorial answer prose, but the same
  `citation-ref` renderer runs inside GFM table cells and tight list items where
  line-height/cell padding differ; the fixed `translate-y` + `leading-none` can
  push the pill out of vertical rhythm or cause baseline jitter on wrapped lines.
  No test exercises the pill in a table cell.
- **Fix:** prefer `vertical-align` (baseline-relative, context-aware) over a fixed
  `translate-y` em offset. Replace the `translate-y-[0.12em]` + `align-baseline`
  with a baseline alignment that doesn't impose a fixed pixel/em nudge:
  ```tsx
  className={cn(
    'not-prose mx-px inline-flex max-w-[14rem] items-center gap-1',
    'rounded-full border border-border-light bg-surface-primary-alt py-[1px] pl-[3px] pr-2',
    'align-[-0.18em] text-[0.82em] font-medium leading-none text-text-secondary no-underline',
    'transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  )}
  ```
  Using `align-[-0.18em]` (CSS `vertical-align`) instead of `translate-y-[0.12em]`
  keeps the pill seated on the text baseline and scales with the surrounding
  `font-size` (the pill is `0.82em`), so it behaves in both prose and table cells.
  Tune the exact em value by eye against the answer prose so resting appearance is
  unchanged. (If a single value can't satisfy both contexts, scope the offset:
  the answer surface is `.counselle-answer`; a `.counselle-answer :is(td,li)`
  selector could relax it — but try the single `vertical-align` first; KISS.)
- **Tests to add:** visual-regression is out of scope for vitest; instead a render
  smoke (`SourcePill.test.tsx`): `renders inside a table cell without throwing`
  (mount a `<table><tbody><tr><td><SourcePill …/></td></tr></tbody></table>`).
  The real verification is a manual/Playwright check (Phase 7 visual regression) —
  note it.
- **Acceptance criteria:**
  - [ ] The pill uses `vertical-align` (not a fixed `translate-y` em transform) for
        baseline seating.
  - [ ] Resting appearance in answer prose is visually unchanged (eyeball / screenshot).
  - [ ] The table-cell render smoke passes; a Playwright table-cell check is noted
        for Phase 7.

---

### FE-M8 — Sources/artifact panels share one rail; opening one closes the other with no focus management or announcement  [MEDIUM]

- **Files:** `src/app/ChatView.tsx` (≈71–77, 141–165 the rail render); `src/app/state.ts`
  (the open atoms clear the other — keep); `src/components/citations/SourcesPanel.tsx`
  (focus on open/close); also the inline-pill open path (`MessageContent.tsx:166–169`).
- **Problem:** `rightPanelOpen` shows at most one of artifact/sources; the write
  atoms clear the other. For sighted users this is fine; for AT users the panel
  mount/unmount isn't announced and focus isn't managed — nothing moves focus into
  the opened panel or restores it on close (`useEscToClose` only handles Esc).
  Opening the sources panel from an inline pill doesn't move focus to the flashed
  row either.
- **Fix:**
  - **Move focus into the panel on open:** in `SourcesPanel` (the docked variant),
    focus the panel heading or the close button on mount. Give the `<h2>` a `tabIndex={-1}`
    and `ref`, focus it in a mount effect (the mobile `SourcesSheet` is a Radix
    `Dialog` which already manages focus — leave it). Mirror in `ArtifactPanel` if
    cheap (same pattern), but Sources is the required one for this finding.
    ```tsx
    function SourcesChrome({ sources, activeIndex, dbSchools, onClose }: SourcesViewProps) {
      const count = displaySourceCount(sources);
      const headingRef = useRef<HTMLHeadingElement>(null);
      useEffect(() => {
        headingRef.current?.focus();
      }, []);
      return (
        <>
          <header …>
            <h2 ref={headingRef} tabIndex={-1} className="… focus:outline-none">
              {count} {count === 1 ? 'source' : 'sources'}
            </h2>
            …
          </header>
          …
        </>
      );
    }
    ```
- **⚠️ Cross-phase note (FE-M8 ↔ Phase 2 FE-H4 — `displaySourceCount` signature):**
  Phase 2 (FE-H4) changes `displaySourceCount` from the one-arg
  `displaySourceCount(sources)` to a two-arg `(externals, dbUsed)` signature and
  updates `SourcesPanel.tsx`'s call site accordingly. The snippet above shows
  `const count = displaySourceCount(sources)` for **pre-Phase-2 context only** —
  Phase 4 lands after Phase 2. **Read the post-Phase-2 `SourcesPanel.tsx` before
  editing and do NOT revert the FE-H4 two-arg call.** FE-M8 only ADDS focus
  management (the `headingRef` + mount-focus effect, the `tabIndex={-1}` heading);
  it must not touch the count derivation. Adapt the focus wiring onto whatever
  `displaySourceCount(...)` shape exists in the tree after Phase 2.
  - **Restore focus on close:** the trigger that opened the panel should regain
    focus. The simplest contained approach: in `ChatView`, capture the
    `document.activeElement` (or the strip/pill button) when the panel opens and
    restore it in the `closeSources` callback. A pragmatic minimum: after
    `setSources(null)` the previously-focused trigger is the natural target; if the
    pill/strip button still exists, call `.focus()` on a stored ref. Given the
    open is dispatched via a jotai atom from many call sites, a lightweight
    approach is to store the trigger element in the panel state
    (`SourcesPanelState`) — but that couples DOM into state. **Recommended
    contained fix:** since the docked panel unmounts on close, restore focus to the
    chat region: focus the `<main role="main">` container (give it `tabIndex={-1}`)
    on close, so AT focus isn't stranded on a removed node. Document that
    per-trigger restore is a follow-up (TODOS.md) if it can't be done cleanly here.
  - **Announce the swap:** wrap the right rail's content in a region with
    `aria-live="polite"` is too chatty; instead the panel `<aside aria-label="Sources panel">`
    already names itself — ensure it has `role="complementary"` (implicit on
    `<aside>`) and that focus moving into it on open is the announcement. The
    mount-focus above is the primary AT signal.
  - **Inline-pill open → flashed row:** `SourcesList` already scrolls the
    `activeIndex` row into view and flashes it; add focus to that row when opened
    from a pill (set `tabIndex={-1}` on the active `SourceRow`'s `<li>`/`<a>` and
    focus it in the existing `activeIndex` effect). This lands AT focus on the
    right source, matching the visual flash.
- **Tests to add:** `SourcesPanel.test.tsx` (jsdom):
  - `moves focus to the heading on open` — render `<SourcesPanel …/>`, assert
    `document.activeElement` is the `<h2>`.
  - (Focus-restore-on-close is hard to assert in jsdom without a full mount tree —
    cover by manual/Playwright in Phase 7; note it.)
- **Acceptance criteria:**
  - [ ] Opening the sources panel moves focus into it (heading/close button).
  - [ ] Closing the panel does not strand AT focus on a removed node (focus returns
        to a sensible target — trigger or main).
  - [ ] Opening from an inline pill moves focus to the flashed source row.
  - [ ] The focus-on-open test passes; focus-restore is covered or tracked.

---

### FE-M9 — No Content-Security-Policy / security headers on the SPA shell  [MEDIUM]

- **Files:** `frontend/index.html` (no CSP); the real control is server headers
  (deferred deploy / Phase 6).
- **Problem:** `isSafeUrl` gates `href` sinks (good), but there's no CSP backstop.
  With user-influenced data flowing into the DOM (markdown image rendering; the
  now-removed favicon fetch), a CSP is the cheap second layer the web-security
  rules call for.
- **Fix (stopgap here; real control in Phase 6/deploy):** add a conservative
  `<meta http-equiv="Content-Security-Policy">` to `index.html` as a stopgap. With
  FE-H1's favicon fetch removed, `img-src` no longer needs Google. Tune for what
  the app actually loads (markdown images can be arbitrary `https:`; `data:` for
  inline; fonts are self-hosted under `public/fonts`). Example stopgap:
  ```html
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'self';
             img-src 'self' data: https:;
             font-src 'self';
             style-src 'self' 'unsafe-inline';
             connect-src 'self';
             frame-src 'none';
             object-src 'none';
             base-uri 'self'" />
  ```
  Caveats to verify before committing: (a) Vite dev uses inline scripts/HMR —
  a strict `script-src 'self'` meta can break `npm run dev`; gate the meta to
  prod (the strict server-header CSP belongs in Phase 6/deploy, where a nonce is
  available). **Safest Phase-4 action:** add the meta but scope it so it does not
  break dev — e.g. only emit it in the production `index.html` build, or keep
  `img-src`/`object-src`/`base-uri`/`frame-src` directives (which don't affect HMR)
  and **leave `script-src` to the Phase-6 server header**. Confirm `npm run dev`
  and `npm run build` + preview both work after the change.
- **Cross-phase note:** the authoritative CSP (nonce-based `script-src`, HSTS,
  `X-Content-Type-Options`, etc.) is **Phase 6 / deploy (B6)** as server headers.
  Phase 4 ships only the harmless-in-dev stopgap and records the full header set
  for Phase 6. Coordinate the `img-src`/`connect-src` origins with Phase 6 so they
  don't diverge.
- **Tests to add:** none (static HTML). Acceptance is the grep + manual dev/build check.
- **Acceptance criteria:**
  - [ ] A stopgap CSP meta exists in `index.html` covering `img-src` /
        `object-src` / `frame-src` / `base-uri` (no Google favicon origin needed).
  - [ ] `npm run dev` and `npm run build` both still work (no CSP-broken dev).
  - [ ] The full server-header CSP is recorded as a Phase-6/deploy item (TODOS.md
        / DEPLOY.md reference).

---

### FE-L1 — `useElapsed` exhaustive-deps suppression masks FE-H2  [LOW]

- **Files:** `ReasoningTrace.tsx` (`useElapsed`).
- **Problem/Fix:** The `eslint-disable react-hooks/exhaustive-deps` is what hid the
  stale `elapsed` read. **Resolved by the FE-H2 fix** (the suppression is removed
  there because `elapsed` is no longer read in the effect). No separate work.
- **Acceptance criteria:**
  - [ ] No `eslint-disable react-hooks/exhaustive-deps` remains on `useElapsed`.

---

### FE-L2 — moved to Phase 5

FE-L2 (throttle→useMemo in `useQuestionAnchoredScroll.ts`) is owned by Phase 5
FE-EFFECT-DEP-THROTTLE — same file/fix; Phase 5 lands it alongside
FE-SOURCECFG-DUAL which already edits that file area.

---

### FE-L3 — Anchor scroll uses a magic `window.setTimeout(applyAnchor, 600)`  [LOW]

- **Files:** `src/app/useQuestionAnchoredScroll.ts` (≈155).
- **Problem:** A 600ms guess to wait out composer-resize relayout — too long on
  fast devices, possibly too short on slow ones.
- **Fix (recommended — low risk):** replace the magic literal with a named constant
  AND prefer a layout-driven re-apply over a fixed delay. Minimal acceptable:
  name the constant. Better: use `requestAnimationFrame` chaining (two rAFs to let
  layout settle) and/or a `ResizeObserver` on the composer that calls `applyAnchor`
  once on the next resize.
  - **Minimal:** `const ANCHOR_REAPPLY_DELAY_MS = 600;` and use it. (Removes the
    magic number; keeps behavior.)
  - **Recommended:** keep one rAF-based settle plus the constant as a fallback:
    ```tsx
    const ANCHOR_REAPPLY_DELAY_MS = 600;
    // …
    applyAnchor();
    requestAnimationFrame(() => requestAnimationFrame(applyAnchor)); // settle after layout
    window.setTimeout(applyAnchor, ANCHOR_REAPPLY_DELAY_MS);          // belt-and-suspenders
    ```
    (`applyAnchor` is idempotent — it early-returns when residual ≤ 4px — so calling
    it multiple times is safe.) Choose the recommended form if it doesn't regress
    the anchor; otherwise the minimal named-constant form is acceptable.
- **Acceptance criteria:**
  - [ ] No bare `600` literal; a named constant is used.
  - [ ] Anchoring behavior is unchanged or improved (manual check: send a message,
        the question pins near the top).

---

### FE-L4 — `ComparisonTableCard` keys `<col>`/cells on `school.unitid`; duplicate unitids would collide  [LOW]

- **Files:** `src/components/cards/ComparisonTableCard.tsx` (≈107, 116, 132 the
  `key={school.unitid}`).
- **Problem:** `unitid` is unique per school normally, but a malformed spec with a
  repeated school would produce duplicate React keys with no guard.
- **Fix:** key on a positional-disambiguated value so a duplicate can't collide:
  ```tsx
  {spec.schools.map((school, idx) => (
    <col key={`${school.unitid}-${idx}`} />
  ))}
  // …header:
  {spec.schools.map((school, idx) => (
    <th key={`${school.unitid}-${idx}`} scope="col" className={schoolThClass}>…</th>
  ))}
  // …cells:
  {spec.schools.map((school, col) => (
    <ComparisonCell key={`${school.unitid}-${col}`} cell={row.cells[col]} />
  ))}
  ```
- **Acceptance criteria:**
  - [ ] School `<col>`/`<th>`/cell keys include the column index, so duplicate
        unitids can't collide.

---

### FE-L5 — Row keys are `${row.label}-${i}` (index-tainted)  [LOW]

- **Files:** `src/components/cards/StatBlockCard.tsx` (≈118);
  `src/components/cards/ComparisonTableCard.tsx` (≈125).
- **Problem:** Row keys are `${row.label}-${i}` — acceptable, but index-tainted, so
  reordering rows mid-stream would remount. Viz rows don't reorder, so this is
  benign — recorded for completeness.
- **Fix (recommended — leave as-is, documented):** viz specs are emitted whole
  (rows don't stream/reorder), so the index-suffixed key is safe and changing it
  risks nothing-gained churn. **Per CLAUDE.md value×ease (low value), do not
  change the key.** Add a one-line comment at each map noting "rows are emitted
  whole; the `-${i}` suffix is safe (no mid-stream reorder)" so a reviewer doesn't
  re-flag it. (If the implementer prefers, switching to a stable
  `row.label`-only key is acceptable *only if* labels are guaranteed unique —
  they're not, so keep the index suffix.)
- **Acceptance criteria:**
  - [ ] A comment documents why the index-suffixed row key is safe (no behavior change).

---

### FE-L6 — `SourceRow` renders an inert non-link `<div>` row with link-like hover styling  [LOW]

- **Files:** `src/components/citations/SourceRow.tsx` (≈53–68, the `rowClass` shared
  by the `<a>` and the no-URL `<div>`).
- **Problem:** A source with no safe URL renders the same `hover:bg-surface-secondary`
  treatment as a real link but does nothing on click — a small affordance lie.
- **Fix:** suppress the interactive hover/focus styling when there's no URL. Split
  the class so the hover/ring only apply to the `<a>`:
  ```tsx
  const baseRowClass = 'flex gap-2.5 rounded-lg px-3 py-2 !no-underline transition-colors';
  const interactiveRowClass = cn(
    baseRowClass,
    'hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active && 'motion-safe:[animation:source-flash_1.2s_ease-out]',
  );
  const inertRowClass = cn(
    baseRowClass,
    active && 'motion-safe:[animation:source-flash_1.2s_ease-out]',
  );
  // …
  {url ? (
    <a … className={interactiveRowClass}>{inner}<span className="sr-only"> (opens in new tab)</span></a>
  ) : (
    <div className={inertRowClass}>{inner}</div>
  )}
  ```
- **Acceptance criteria:**
  - [ ] The no-URL `<div>` row carries no `hover:`/`focus-visible:` link-like
        styling; the linked row keeps it.

---

### FE-L7 — `ClarifyWidget` "Other" free-text input has no accessible name and no max length  [LOW]

- **Files:** `src/components/clarify/ClarifyWidget.tsx` (`OtherInput`, ≈56–89).
- **Problem:** The input relies on `placeholder` only (not an accessible name) and
  has no max length.
- **Fix:** add `aria-label` and a `maxLength`:
  ```tsx
  const OTHER_MAX_LEN = 280;
  // …
  <input
    type="text"
    aria-label="Your answer"
    maxLength={OTHER_MAX_LEN}
    value={text}
    onChange={(e) => setText(e.target.value)}
    onKeyDown={…}
    placeholder="Type your answer…"
    className="…"
  />
  ```
  (`OTHER_MAX_LEN` a named constant; 280 is a sane clarify free-text cap — tune if
  a backend limit is known.)
- **Acceptance criteria:**
  - [ ] The "Other" input has `aria-label="Your answer"` and a `maxLength`.

---

### FE-L8 — Composer file preview keys on array index and only ever holds one file  [LOW]

- **Files:** `src/components/composer/CounselleComposer.tsx` (≈177–201, the
  `files.map((file, index) => … key={index} …)` with `flex-wrap` multi-file layout).
- **Problem:** `files` is always single-element (`setFiles([file])`), yet the code
  maps with an index key and a multi-file wrap layout — speculative generality +
  an index key.
- **Fix:** if FE-M3 hides the upload affordance, this preview block is dead and
  should be removed entirely (preferred — simplest). If the affordance is kept
  (the non-recommended FE-M3 alternative), simplify to a single preview (no `.map`,
  no `flex-wrap`, no index key):
  ```tsx
  {files[0] && !isRecording && filePreview && files[0].type.startsWith('image/') && (
    <div className="p-0 pb-1">
      <div className="relative group w-16 h-16 rounded-xl overflow-hidden cursor-pointer" onClick={() => openImageModal(filePreview)}>
        <img src={filePreview} alt={files[0].name} className="h-full w-full object-cover" />
        <button onClick={(e) => { e.stopPropagation(); handleRemoveFile(); }} className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5">
          <X className="h-3 w-3 text-white" />
        </button>
      </div>
    </div>
  )}
  ```
- **Acceptance criteria:**
  - [ ] No `key={index}` on a single-element file list; the preview is a single
        element (or removed entirely if upload is hidden per FE-M3).

---

## Cross-phase notes

- **FE-C1 + FE-H4 are Phase 2 (honesty).** Do NOT fix the reveal-clause bounding
  (`remarkDbSpans.ts`/`DbClaim`) or the DB-overcount derivation here. Phase 4
  touches `remarkCitations.ts`/`MessageSources.tsx`/`SourcesStrip.tsx` only for the
  FE-M1 aria wording and the FE-M6 doc note — leave the derivation logic to Phase 2.
- **FE-M9 CSP coordinates with Phase 6.** Phase 4 ships only the dev-safe stopgap
  meta (no `script-src` that breaks HMR). The authoritative nonce-based server-header
  CSP, HSTS, and the other security headers are Phase 6 / deploy (B6). Keep the
  `img-src`/`connect-src` origins consistent between the two so they don't diverge.
  FE-H1's favicon removal lets `img-src` drop the Google origin in both.
- **FE-ATTACH-CURSOR backend contract coordinates with Phase 1 (BC-06).** Phase 4
  does the FE durability (sessionStorage) + documents the assumed "attach with no
  Last-Event-ID ⇒ full replay" contract in `wire-contract.md` §6. If Phase 1's
  server-side Last-Event-ID work resolves the contract differently, reconcile and
  update the note. No wire-version bump (REMEDIATION-PLAN §5 non-goal).
- **ChatContext changes coordinate with Phase 5 (FE-CHATCONTEXT-GOD).** The
  FE-ATTACH-CURSOR change to `attachTurn` and the FE-FEEDBACK-STALE change live in
  files Phase 5 refactors (ChatContext, useMessageActions). Keep both surgical and
  contained so they survive the later extraction; do NOT do Phase 5's larger lifts
  (feedback-into-projection, stream-loop extraction) here.
- **FE-CONSOLE-WARN (Phase 5).** The new `MessagesErrorBoundary` and the
  FE-SSE-NOSCHEMA guards add `console.error`/`console.warn`. These are deliberate
  diagnostics on genuinely-bad states (matching the existing sse warns). Phase 5
  routes all such calls through a logger seam — leave them as `console.*` here and
  let Phase 5 sweep them.

---

## Phase completion checklist

- [ ] Every finding above (FE-FEEDBACK-STALE, FE-ATTACH-CURSOR, FE-H1, FE-H2,
      FE-H3, FE-H5, FE-SSE-NOSCHEMA, FE-M1–FE-M9, FE-L1, FE-L3–FE-L8; FE-L2 moved
      to Phase 5) implemented with its
      acceptance criteria checked.
- [ ] New tests added and passing: `ReasoningTrace.test.tsx` (FE-H2 reset, FE-H3
      via reducer, FE-M2 expand), `turn-reducer-thinking.test.ts` (FE-H3 stable id),
      `sse-validate.test.ts` (FE-SSE-NOSCHEMA), `MessagesErrorBoundary.test.tsx`
      (FE-H5), `useMessageActions.test.tsx` (FE-FEEDBACK-STALE), transport cursor
      test (FE-ATTACH-CURSOR), plus the smaller smokes (strip aria, composer,
      source pill table-cell, sources-panel focus).
- [ ] `grep -rn "s2/favicons" frontend/src/components/citations` → zero matches.
      (Citation path only — FE-H1's scope. The `schoolLogo.ts` school-logo fetch is
      a separate surface deferred to Phase 6 CFG-04; see TODOS.md.)
- [ ] No `eslint-disable react-hooks/exhaustive-deps` remains in `ReasoningTrace.tsx`.
- [ ] FE-C1 / FE-H4 honesty derivations left untouched (Phase 2 owns them).
- [ ] CSP stopgap meta present and dev/build both work; full server CSP recorded
      for Phase 6.
- [ ] FE-ATTACH-CURSOR contract documented in `wire-contract.md` §6.
- [ ] **Shared files (Phase 4 ↔ Phase 5):** `CounselleComposer.tsx` (FE-M3 +
      FE-L8 here; FE-SOURCECFG-DUAL in Phase 5) is flagged as shared — Phase 5 must
      read its post-Phase-4 state and merge cleanly without reverting the
      FE-M3/FE-L8 changes. `SourceDropdown.tsx` is NOT touched in Phase 4 (it has no
      `onSourcesReread` prop); its disposition is owned by Phase 5
      (FE-SOURCECFG-DUAL / FE-DEAD-CHATFORM).
- [ ] Gate green: `cd frontend && npm run typecheck && npm test && npm run build`.
- [ ] Any MEDIUM/LOW deliberately deferred is recorded with a one-line rationale in
      `TODOS.md` (e.g. backend favicon proxy CFG-04, per-trigger focus restore,
      Playwright table-cell/visual checks for Phase 7).
