 
import * as React from "react";

import { cn } from "@/lib/utils";

import { errorCopy, onGrid, type LaneConfig } from "./scenario-explorer-model";
import { scorePosition, type PlotWindow } from "./academic-comparison-geometry";
import { PILL_HALF_WIDTH_PX, YouMark } from "./YouMark";

/*
 * The plot IS the slider (plan §5). This wrapper owns pointer, keyboard,
 * in-pill exact entry and reset; `ClassShape` stays purely presentational
 * and `YouMark` stays fully controlled — this file drives both by
 * re-rendering with a new value on every frame, never by reaching into
 * either component's internals.
 *
 * Deliberately renders no visible mark until a real value exists (either the
 * saved profile or a scenario the student has actually set): a slider that
 * starts pre-loaded with an invented position would be exactly the kind of
 * plausible-but-untrue value AGENTS.md's honesty principle rules out. The
 * interactive surface is present and focusable from the first render — a
 * student can tab to it and start dragging or typing — the pill just has
 * nothing to show until that first interaction.
 */

const PAGE_STEP_MULTIPLIER = 10;
const TOUCH_PADDING_PX = 12;
const DRAG_DISCOVERY_KEY = "school-chances:scrub-discovered";
/** FIX 4: the gap between the pill's own clamped edge and Reset, on
 * whichever side Reset renders. */
const RESET_GAP_PX = 6;
/**
 * Item 1 fix, drag-path correction: a real-Chromium measurement found the
 * pill's own `scale-[0.96]` grab feedback (`pressed`/`YouMark.tsx`) shifts
 * its rendered left edge ~10.7px further left than `pillTranslateX`'s
 * clamp formula predicts — `RESET_GAP_PX` alone doesn't cover that while
 * Reset sits on the pill's left (`renderedFlipped`); the measured overlap
 * (≈4.2px) matches the shortfall. Extra clearance only while pressed
 * (`pillPressed` below) — margin to spare, and free on the unflipped side,
 * which already has more room. */
const RESET_DRAG_EXTRA_GAP_PX = 22;
/** How long `pillPressed` (below) outlives `dragging` itself — a second
 * measurement caught the same overlap right after release, since the
 * pill's release scale tween (scale duration is unconditionally 160ms,
 * schools.css, even under `data-instant`) keeps it visually shifted for a
 * beat after `dragging` already reads false. Comfortably past that. */
const RESET_PILL_RELEASE_SETTLE_MS = 250;
/**
 * FIX 4's edge-avoidance heuristic: past this raw score-position percentage,
 * the pill's own clamp (`YOU_MARK`/`ScrubbablePlot`, `PILL_HALF_WIDTH_PX`)
 * has it pinned at (or very near) the plot's right edge, leaving no reliable
 * room for a right-side "Reset" before it clips at the narrowest tested
 * viewport (390px) — so Reset flips to the pill's left side instead. There
 * is no equivalent left-edge case: a value near the window's left edge still
 * has the whole rest of the plot's width open to its right.
 */
const RESET_FLIP_THRESHOLD_PCT = 80;

/**
 * Item 1 fix (school-chances-redesign fix round 2): a prior attempt gave
 * Reset the pill's exact 180ms tween so both settle in lockstep — that
 * fixed a *discontinuity* (Reset used to snap instantly) but not the
 * underlying defect: two synchronized translations still sweep through the
 * same space to get from one side of the pill to the other. There is no
 * timing fix for a geometric problem, so the side change is a crossfade
 * instead — Reset never translates across the pill at all. `renderedFlipped`
 * (state) lags the live `resetFlipped`: the button first fades out **at its
 * old side**, using the *current* pill target — provably safe for the
 * pill's entire tween, since the pill approaches that target monotonically
 * (the shared `cubic-bezier(0.23,1,0.32,1)` curve never overshoots) and the
 * old side sits `PILL_HALF_WIDTH_PX + RESET_GAP_PX` beyond it. Only once
 * the pill's own tween has actually finished (its `transitionend`, with a
 * timed fallback) does the button jump — invisibly, mid-fade — to the new
 * side and fade back in. The two fades total 160ms, the slower of the
 * panel's two existing fade durations (schools.css's settled-value
 * number/verdict crossfade is 120ms): a side flip is rarer and more
 * structural than a value ticking over, so it reads with a touch more
 * weight. Split evenly as `duration-[80ms]` on the button below — hand-
 * written rather than derived from a constant, since Tailwind's arbitrary-
 * value classes need a literal in source text to be generated (same reason
 * `you-mark-pill`'s own 180ms/160ms dual timing is hand-written in
 * schools.css).
 */
/** Generous upper bound on how long to wait for the pill's own transition to
 * report done before flipping Reset's side regardless — a safety net for
 * the (untriggered in practice) case `transitionend` never fires, not the
 * primary timing signal. Comfortably past the pill's own known 180ms. */
const RESET_CROSSFADE_SETTLE_TIMEOUT_MS = 260;

/**
 * Module-level store, not per-component `useState`: a drag on one plot and
 * `ScrubAffordanceHint` on a sibling plot are two separate component
 * instances, and writing `sessionStorage` from one never re-renders the
 * other on its own. `useSyncExternalStore` is what makes every mounted
 * reader (this plot's own hint line, every other plot's) notice the same
 * write — the thing the affordance hint is teaching ("this chart drags")
 * is learned once per session, not once per lane (plan §5).
 */
let discoveredCache = false;
const discoverySubscribers = new Set<() => void>();

function readDiscovered(): boolean {
  if (discoveredCache) return true;
  try {
    discoveredCache = sessionStorage.getItem(DRAG_DISCOVERY_KEY) === "1";
  } catch {
    /* Private mode / storage disabled: falls back to in-memory only. */
  }
  return discoveredCache;
}

function markDiscoveredGlobally(): void {
  if (discoveredCache) return;
  discoveredCache = true;
  try {
    sessionStorage.setItem(DRAG_DISCOVERY_KEY, "1");
  } catch {
    /* Private mode / storage disabled: still fades for this session's own
     * mounted components, via the in-memory cache above. */
  }
  for (const notify of discoverySubscribers) notify();
}

function subscribeToDiscovery(onStoreChange: () => void): () => void {
  discoverySubscribers.add(onStoreChange);
  return () => discoverySubscribers.delete(onStoreChange);
}

/**
 * FIX 1: the honest ARIA channel for a lane with no value at all. Visually
 * the pill and rule already render nothing (`value === null` below), but the
 * control div is always present and focusable — without this, its
 * `aria-valuenow` would fall back to `shown` (the window midpoint, purely a
 * layout seed) and a screen reader would announce a score the student never
 * entered. `aria-valuenow` is omitted entirely rather than asserting a
 * number that isn't true, and this text takes over as the sole thing read —
 * honest first, ARIA-slider-pattern conformance second (fix-round brief).
 */
function absentAriaValueText(ariaLabel: string): string {
  return ariaLabel === "GPA" ? "No GPA set" : `No ${ariaLabel} score set`;
}

/**
 * Whether the student has ever successfully dragged a plot in this browser
 * tab session — the affordance hint (plan §5) fades out permanently once
 * true, across every metric and every school, because the thing being
 * taught ("this chart drags") is learned once, not per-lane.
 */
function useHasDraggedOnce(): [boolean, () => void] {
  const discovered = React.useSyncExternalStore(subscribeToDiscovery, readDiscovered);
  return [discovered, markDiscoveredGlobally];
}

/**
 * FIX 2: same `useSyncExternalStore` shape as the discovery store above,
 * tracking whether ANY `ScrubbablePlot` inside one store's scope is
 * mid-drag right now — a count, not a boolean, because a pointer can only
 * ever be captured by one control at a time, but this still lets a stray
 * double-fire settle without going negative.
 *
 * `SchoolChancesPanel`'s live region reads this to gate when it is allowed
 * to update its own announced text: WCAG 4.1.3 asks for the *settled*
 * value, never a running commentary on every pointermove — and
 * `onScenarioChange` already fires on every pointermove (plan §5's 1:1
 * drag tracking), so the panel cannot tell "settled" from "mid-drag" by
 * watching the scenario value alone. This is that missing signal.
 *
 * FIX 6: this used to be one module-level store shared by every mounted
 * `ScrubbablePlot` on the page, so dragging one panel's plot set
 * `aria-busy` on every other panel's verdict too (confirmed live on the
 * 19-fixture dev gallery). A factory instead of a singleton, plus the
 * `ScrubbingProvider`/context below, scopes one store to one
 * `SchoolChancesPanel` instance — `FALLBACK_STORE` is the store any
 * `ScrubbablePlot` rendered outside a provider still uses (this file's own
 * tests included), preserving today's single-call-site behavior exactly.
 */
type ScrubbingStore = {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => boolean;
  begin: () => void;
  end: () => void;
};

function createScrubbingStore(): ScrubbingStore {
  let count = 0;
  const subscribers = new Set<() => void>();
  const notify = () => {
    for (const fn of subscribers) fn();
  };
  return {
    subscribe(onStoreChange) {
      subscribers.add(onStoreChange);
      return () => subscribers.delete(onStoreChange);
    },
    getSnapshot: () => count > 0,
    begin() {
      count += 1;
      notify();
    },
    end() {
      count = Math.max(0, count - 1);
      notify();
    },
  };
}

const FALLBACK_SCRUBBING_STORE = createScrubbingStore();
const ScrubbingContext = React.createContext<ScrubbingStore | null>(null);

/**
 * FIX 6: wraps one `SchoolChancesPanel` instance so every `ScrubbablePlot`
 * it renders (GPA, and later the SAT/ACT lanes) shares one scrubbing store
 * scoped to that panel alone — a drag on one panel no longer touches a
 * sibling panel's `aria-busy`. Create the store once per mount (`useRef`,
 * not a fresh store every render) so the identity `useSyncExternalStore`
 * subscribes to is stable across re-renders.
 */
export function ScrubbingProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  // Lazy `useState` initializer, not a `useRef` — reading `ref.current`
  // during render (even guarded by `??=`) trips `react-hooks/refs`, and a
  // lazy initializer already gives the same "create exactly once, keep a
  // stable identity across re-renders" guarantee `useSyncExternalStore`
  // needs from this value.
  const [store] = React.useState(() => createScrubbingStore());
  return (
    <ScrubbingContext.Provider value={store}>{children}</ScrubbingContext.Provider>
  );
}

function useScrubbingStore(): ScrubbingStore {
  return React.useContext(ScrubbingContext) ?? FALLBACK_SCRUBBING_STORE;
}

/** Whether any plot in this store's scope is mid-drag right now — see the
 * store above. `SchoolChancesPanel.tsx` is the sole consumer, gating its
 * own settled-value live region on it (FIX 2); see `profileScenario` in
 * `SchoolChancesPanel.tsx` for the same precedent of a non-component
 * export living beside a component-only file. */
// eslint-disable-next-line react-refresh/only-export-components -- see comment above
export function useIsScrubbing(): boolean {
  const store = useScrubbingStore();
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** The 12px `--ink-muted` discoverability hint (plan §5's touch/at-rest
 * mitigation). Rendered by callers below `AxisEndpointLabels`, once per
 * plot — reads the same session flag `ScrubbablePlot` writes on a drag. */
export function ScrubAffordanceHint(): React.ReactElement | null {
  const [hasDragged] = useHasDraggedOnce();
  if (hasDragged) return null;
  return (
    <p
      className={cn("text-xs text-[var(--ink-muted)]")}
      data-slot="scrub-affordance-hint"
    >
      Drag to try a different score
    </p>
  );
}

export type ScrubbablePlotProps = {
  window: PlotWindow;
  /** The plot box height this control overlays — matches the caller's own
   * `ClassShape` box exactly; touch padding extends beyond it. */
  height: number;
  lane: Pick<LaneConfig, "key" | "min" | "max" | "step">;
  /** The current scenario value, or the saved value when no scenario has
   * been set — `null` when neither exists yet. */
  value: number | null;
  /** The saved profile value, used only to decide the mark's colour
   * (`you` vs `scenario`) and to fold `null` back into "no scenario" on
   * reset/exact-match. */
  savedValue: number | null;
  /** The server's own exact display string for the saved profile value
   * (e.g. `"3.825"`), used verbatim on the pill only while the mark shows
   * that saved value unedited — `formatDisplay` alone would round it to
   * the scenario grid's own precision (`3.825.toFixed(2)` → `"3.83"`) and
   * silently misstate a value more precise than the explorer's own step.
   * Falls back to `formatDisplay` when omitted. */
  savedDisplay?: string | null;
  ariaLabel: string;
  formatDisplay: (value: number) => string;
  /** `aria-valuetext` on every value change reuses `scenarioSetCopy()`
   * verbatim (plan §5) — the announcement contract the old sr-only live
   * region carried survives through the native mechanism a `role="slider"`
   * already has, so no separate live region is needed. */
  ariaValueText: (value: number) => string;
  /** `null` clears the scenario back to the saved value (or to nothing). */
  onScenarioChange: (value: number | null) => void;
  className?: string;
};

export function ScrubbablePlot({
  window,
  height,
  lane,
  value,
  savedValue,
  savedDisplay,
  ariaLabel,
  formatDisplay,
  ariaValueText,
  onScenarioChange,
  className,
}: ScrubbablePlotProps): React.ReactElement {
  const plotRootRef = React.useRef<HTMLDivElement>(null);
  const controlRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const [hoverLeft, setHoverLeft] = React.useState<number | null>(null);
  const [, markDragged] = useHasDraggedOnce();
  const errorId = `${lane.key}-scrub-error`;

  /* FIX 1: `scrubbingStore.begin()`/`.end()` (defined above) used to be
   * called directly from `onPointerDown`/`onPointerUp`/`onPointerCancel`
   * only — nothing ran if this component unmounted mid-drag (e.g. the
   * student switches metric tabs while still holding the pointer down),
   * so the counter never decremented and `aria-busy` stuck `"true"` for
   * the rest of the session. `scrubbingActiveRef` makes begin/end
   * idempotent per component instance (a second `end()` — from the
   * unmount cleanup firing after `endDrag` already ran — is a no-op
   * rather than a double-decrement), and the effect below guarantees
   * `end()` runs at least once if the component goes away while still
   * scrubbing. */
  const scrubbingStore = useScrubbingStore();
  const scrubbingActiveRef = React.useRef(false);
  const startScrubbing = React.useCallback(() => {
    if (scrubbingActiveRef.current) return;
    scrubbingActiveRef.current = true;
    scrubbingStore.begin();
  }, [scrubbingStore]);
  const stopScrubbing = React.useCallback(() => {
    if (!scrubbingActiveRef.current) return;
    scrubbingActiveRef.current = false;
    scrubbingStore.end();
  }, [scrubbingStore]);
  React.useEffect(() => {
    return () => stopScrubbing();
  }, [stopScrubbing]);

  const fallback = React.useMemo(
    () => snapToLane(lane, (window.lo + window.hi) / 2),
    [lane, window.lo, window.hi],
  );
  const shown = value ?? fallback;
  const isScenario = value !== null && value !== savedValue;
  const display = !isScenario && savedDisplay ? savedDisplay : formatDisplay(shown);
  const left = scorePosition(clamp(shown, window.lo, window.hi), window.lo, window.hi) * 100;
  /** Mirrors `YouMark`'s own pill clamp exactly (FIX 5: `cqw`, not `%` — see
   * schools.css), so the click hit-target and Reset both land relative to
   * the pill they stand in for, not somewhere else. */
  const pillTranslateX = `clamp(${PILL_HALF_WIDTH_PX}px, ${left}cqw, calc(100cqw - ${PILL_HALF_WIDTH_PX}px))`;
  /** FIX 4: Reset tracks the pill instead of a fixed corner, flipping to
   * the pill's left side once the pill's own clamp has it pinned near the
   * plot's right edge (see `RESET_FLIP_THRESHOLD_PCT`). */
  const resetFlipped = left >= RESET_FLIP_THRESHOLD_PCT;

  /* Item 1 fix: `renderedFlipped` is the side Reset actually renders on —
   * it only catches up to `resetFlipped` once it's safe (see the fix
   * comment above and the effect below), so Reset's own `transform` is
   * never CSS-transitioned; it jumps instantly, timed to happen while
   * `crossfading` has it faded to zero. */
  const [renderedFlipped, setRenderedFlipped] = React.useState(resetFlipped);
  const [crossfading, setCrossfading] = React.useState(false);
  /** Whether Reset was already on screen as of the previous render. A
   * scenario's first appearance can itself land past
   * `RESET_FLIP_THRESHOLD_PCT` — that's an appearance, not a side change,
   * with no pre-existing rect to have swept across, so it renders in place
   * with no crossfade. */
  const wasScenarioVisibleRef = React.useRef(isScenario);

  const prefersReducedMotion =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Item 1 fix, drag-path correction: a browser measurement of the repro
   * caught a real overlap this same logic run from a `useEffect` missed —
   * dragging and reduced motion both turn the pill's OWN transition off
   * (`data-instant="true"`, schools.css), so it jumps straight to its live
   * value with no glide. The "old side stays safe for the pill's whole
   * glide" argument the effect leans on assumes that glide exists — with
   * none, even the one extra frame a `useEffect` costs (it runs a tick
   * after the render that changed `resetFlipped`) is enough to paint Reset
   * on the stale side next to a pill that has already arrived. Adjusting
   * `renderedFlipped` here — during render, React's sanctioned pattern for
   * syncing state to a just-changed prop — paints the corrected value
   * immediately instead of one tick late. */
  if ((dragging || prefersReducedMotion) && renderedFlipped !== resetFlipped) {
    setRenderedFlipped(resetFlipped);
    if (crossfading) setCrossfading(false);
  }

  /* Item 1 fix, release-path correction: `pillPressed` outlives `dragging`
   * itself by `RESET_PILL_RELEASE_SETTLE_MS` — engages the instant a drag
   * starts (synchronously, same render, same reasoning as the block
   * above), but only clears a beat after `dragging` goes false, covering
   * the pill's own release-scale tween (see `RESET_DRAG_EXTRA_GAP_PX`). */
  const [pillPressed, setPillPressed] = React.useState(dragging);
  if (dragging && !pillPressed) {
    setPillPressed(true);
  }
  React.useEffect(() => {
    if (dragging || !pillPressed) return undefined;
    const timeoutId = globalThis.setTimeout(() => {
      setPillPressed(false);
    }, RESET_PILL_RELEASE_SETTLE_MS);
    return () => globalThis.clearTimeout(timeoutId);
  }, [dragging, pillPressed]);

  React.useEffect(() => {
    const wasScenarioVisible = wasScenarioVisibleRef.current;
    wasScenarioVisibleRef.current = isScenario;

    if (resetFlipped === renderedFlipped) return undefined;

    // The synchronous adjustment above already resolves the drag and
    // reduced-motion cases before this effect ever sees a mismatch; what
    // reaches here is always the glide path. Reset's first appearance
    // (see the comment above `wasScenarioVisibleRef`) still gets the same
    // instant treatment, since there is no previous rect to protect.
    if (!wasScenarioVisible) {
      setRenderedFlipped(resetFlipped);
      setCrossfading(false);
      return undefined;
    }

    setCrossfading(true);
    let settled = false;
    const finishFlip = () => {
      if (settled) return;
      settled = true;
      setRenderedFlipped(resetFlipped);
      setCrossfading(false);
    };

    // Wait for the pill's own `transitionend` — its real completion is the
    // only unambiguous "safe to reveal on the new side" signal; the
    // timeout is a fallback, not the primary timer.
    const pill = plotRootRef.current?.querySelector<HTMLElement>(
      '[data-slot="you-mark-pill"]',
    );
    const handlePillTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === "transform") finishFlip();
    };
    pill?.addEventListener("transitionend", handlePillTransitionEnd);
    const timeoutId = globalThis.setTimeout(
      finishFlip,
      RESET_CROSSFADE_SETTLE_TIMEOUT_MS,
    );

    return () => {
      pill?.removeEventListener("transitionend", handlePillTransitionEnd);
      globalThis.clearTimeout(timeoutId);
    };
  }, [resetFlipped, renderedFlipped, isScenario]);

  const resetGapPx = RESET_GAP_PX + (pillPressed ? RESET_DRAG_EXTRA_GAP_PX : 0);
  const resetTranslateX = renderedFlipped
    ? `calc(${pillTranslateX} - ${PILL_HALF_WIDTH_PX + resetGapPx}px)`
    : `calc(${pillTranslateX} + ${PILL_HALF_WIDTH_PX + resetGapPx}px)`;
  /* Item 1 fix: only `color`/`text-decoration-color` (hover feedback) and
   * `opacity` (the crossfade) are ever transitioned — `transform` is
   * deliberately absent from this list; see `resetTranslateX` above and the
   * effect that drives `renderedFlipped`. */
  const resetTransition = cn(
    "transition-[color,text-decoration-color,opacity] motion-reduce:transition-none",
    dragging ? "duration-0" : "duration-[80ms] ease-out",
  );

  const commit = React.useCallback(
    (next: number) => {
      onScenarioChange(next === savedValue ? null : next);
    },
    [onScenarioChange, savedValue],
  );

  /* FIX 5: the control's own rect, cached for the life of one hover or drag
   * interaction instead of re-measured on every `pointermove`.
   * `getBoundingClientRect()` unconditionally flushes any pending layout for
   * the whole document, regardless of which property dirtied it — with
   * three-plus `left`-animated siblings on this same page (the pill, the
   * hover ghost rule, the hit target) mid-tween, that forced a real layout
   * recalc on nearly every pointer move. Invalidated on pointer leave and
   * drag end so a later interaction re-measures fresh (the layout can have
   * changed — a resize, a scroll — between two separate interactions);
   * never invalidated mid-interaction, which is what makes this the win. */
  const controlRectRef = React.useRef<DOMRect | null>(null);
  const cachedRect = React.useCallback((): DOMRect | null => {
    if (!controlRectRef.current) {
      controlRectRef.current = controlRef.current?.getBoundingClientRect() ?? null;
    }
    return controlRectRef.current;
  }, []);

  /* FIX 3: the cache above is invalidated on pointer leave/drag-end, but
   * nothing invalidated it on an actual geometry change — resizing the
   * viewport mid-drag left every later `pointermove` reading a stale
   * `left`/`width`, so the mark clamped against a lane boundary that no
   * longer matched the real plot box. A `resize` listener (not a
   * `ResizeObserver`, since a window-width change is exactly what desyncs
   * the CSS `cqw`-based layout this control measures against, and vertical
   * scroll — which must stay a no-op — never fires `resize`) clears the
   * cache so the very next read remeasures; it does not itself force a
   * synchronous read, so the "zero `getBoundingClientRect()` calls per
   * `pointermove`" property this cache exists for is untouched except on
   * an actual resize. */
  React.useEffect(() => {
    const handleResize = () => {
      controlRectRef.current = null;
    };
    // `globalThis`, not the bare `window` identifier: this component
    // destructures a `window: PlotWindow` prop (the plot's axis window),
    // which shadows the real global `window` object for the rest of this
    // function body.
    globalThis.addEventListener("resize", handleResize);
    return () => globalThis.removeEventListener("resize", handleResize);
  }, []);

  const valueFromClientX = React.useCallback(
    (clientX: number): number => {
      const rect = cachedRect();
      if (!rect || rect.width === 0) return shown;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const raw = window.lo + ratio * (window.hi - window.lo);
      return snapToLane(lane, raw);
    },
    [cachedRect, lane, shown, window.hi, window.lo],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (editing || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    controlRectRef.current = event.currentTarget.getBoundingClientRect();
    setDragging(true);
    startScrubbing();
    commit(valueFromClientX(event.clientX));
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    setHovering(true);
    setHoverLeft(
      scorePosition(
        clamp(valueFromClientX(event.clientX), window.lo, window.hi),
        window.lo,
        window.hi,
      ) * 100,
    );
    if (!dragging) return;
    // No animation during drag — 1:1 with the pointer (plan §7).
    commit(valueFromClientX(event.clientX));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragging) {
      markDragged();
      stopScrubbing();
    }
    setDragging(false);
    controlRectRef.current = null;
  };
  const handlePointerLeave = () => {
    setHovering(false);
    setHoverLeft(null);
    if (!dragging) controlRectRef.current = null;
  };

  const startEditing = () => {
    setDraft(formatDisplay(shown));
    setError(null);
    setEditing(true);
  };

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Moving focus back to the control from inside a `keydown` handler fires
  // the input's `blur` synchronously, before React has processed the
  // `setEditing(false)` that same handler just queued — so `onBlur`'s own
  // `commitEdit` would otherwise run once more on the way out. This ref
  // is the guard: `cancelEdit` sets it immediately before moving focus,
  // `commitEdit` checks and clears it first.
  const suppressNextBlurCommit = React.useRef(false);

  const commitEdit = () => {
    if (suppressNextBlurCommit.current) {
      suppressNextBlurCommit.current = false;
      return;
    }
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(parsed) || !onGrid(parsed, lane)) {
      setError(errorCopy(lane));
      return;
    }
    setError(null);
    setEditing(false);
    commit(clampToLane(lane, parsed));
    controlRef.current?.focus();
  };
  const cancelEdit = () => {
    suppressNextBlurCommit.current = true;
    setError(null);
    setEditing(false);
    controlRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const step = lane.step;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        commit(clampToLane(lane, snapToLane(lane, shown + step)));
        return;
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        commit(clampToLane(lane, snapToLane(lane, shown - step)));
        return;
      case "PageUp":
        event.preventDefault();
        commit(clampToLane(lane, snapToLane(lane, shown + step * PAGE_STEP_MULTIPLIER)));
        return;
      case "PageDown":
        event.preventDefault();
        commit(clampToLane(lane, snapToLane(lane, shown - step * PAGE_STEP_MULTIPLIER)));
        return;
      case "Home":
        event.preventDefault();
        commit(clampToLane(lane, snapToLane(lane, window.lo)));
        return;
      case "End":
        event.preventDefault();
        commit(clampToLane(lane, snapToLane(lane, window.hi)));
        return;
      case "Enter":
        event.preventDefault();
        startEditing();
        return;
      default:
    }
  };

  return (
    <div
      className={cn("absolute inset-0", className)}
      data-slot="scrubbable-plot"
      ref={plotRootRef}
      style={{ height }}
    >
      <div
        aria-label={ariaLabel}
        aria-valuemax={window.hi}
        aria-valuemin={window.lo}
        aria-valuenow={value === null ? undefined : shown}
        aria-valuetext={
          value === null
            ? absentAriaValueText(ariaLabel)
            : isScenario
              ? ariaValueText(shown)
              : undefined
        }
        className={cn(
          "absolute inset-x-0 touch-none rounded-md outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "[@media(hover:hover)_and_(pointer:fine)]:hover:cursor-[ew-resize]",
        )}
        data-slot="scrubbable-plot-control"
        onKeyDown={handleKeyDown}
        onPointerCancel={endDrag}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        ref={controlRef}
        role="slider"
        style={{ top: -TOUCH_PADDING_PX, bottom: -TOUCH_PADDING_PX }}
        tabIndex={0}
      />
      {hovering && !dragging && hoverLeft !== null ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 hidden w-px [@media(hover:hover)_and_(pointer:fine)]:block"
          )}
          style={{ transform: `translateX(${hoverLeft}cqw)`, background: "var(--ink-faint)" }}
        />
      ) : null}
      {editing ? (
        <ScrubEditInput
          draft={draft}
          error={error}
          errorId={errorId}
          inputRef={inputRef}
          left={left}
          onCancel={cancelEdit}
          onChange={setDraft}
          onCommit={commitEdit}
        />
      ) : value !== null ? (
        <>
            <YouMark
              display={display}
              instant={dragging}
              pressed={dragging}
              value={shown}
              variant={isScenario ? "scenario" : "you"}
              window={window}
            />
            {/* A separate hit target over the (otherwise pointer-events-none,
             * purely visual) pill YouMark renders: a plain click there opens
             * exact entry instead of being read as a drag-to-here. Mouse-only
             * convenience — `aria-hidden`, since Enter on the focused slider
             * (handleKeyDown above) is the accessible route to the same
             * state, and this button would otherwise be a second, redundant
             * stop in the tab order. */}
            <button
              aria-hidden="true"
              className={cn(
                "pointer-events-auto absolute top-0 h-6 w-9 -translate-x-1/2 -translate-y-full cursor-text rounded-[6px]",
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={startEditing}
              style={{ transform: `translateX(${pillTranslateX})` }}
              tabIndex={-1}
              type="button"
            />
        </>
      ) : null}
      {/* FIX 4: Reset (plan §5) — one word, only while a scenario differs
       * from the saved value; which metric it resets is unambiguous from
       * context, so the three old "Reset to your GPA" / "Reset SAT" /
       * "Reset to your ACT" variants collapse to this one string. Tracks
       * the pill's own x position instead of a fixed corner — offset just
       * past the pill's edge, flipping to whichever side has room
       * (`resetFlipped`) — so it stays visually attached to the value it
       * resets and the old edge case (Reset and the pill rendering on top
       * of each other near the window's right edge) becomes "flip sides"
       * instead of "hope the corner never overlaps". */}
      {isScenario ? (
        <button
          className={cn(
            "pointer-events-auto absolute top-0 -translate-y-full rounded px-1 text-xs text-[var(--school-chances-scenario)] underline decoration-transparent underline-offset-2 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            resetTransition,
            renderedFlipped && "-translate-x-full",
          )}
          data-slot="scrub-reset"
          onClick={() => {
            // The button itself unmounts once the scenario clears (this
            // branch's own `isScenario` guard), which would otherwise drop
            // focus to `<body>` — move it back to the plot first.
            onScenarioChange(null);
            controlRef.current?.focus();
          }}
          style={{ opacity: crossfading ? 0 : 1, transform: `translateX(${resetTranslateX})` }}
          type="button"
        >
          Reset
        </button>
      ) : null}
    </div>
  );
}

function ScrubEditInput({
  draft,
  error,
  errorId,
  inputRef,
  left,
  onCancel,
  onChange,
  onCommit,
}: {
  draft: string;
  error: string | null;
  errorId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  left: number;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
}): React.ReactElement {
  return (
    <span
      className={cn("pointer-events-none absolute top-0 -translate-y-full")}
      style={{ transform: `translateX(${left}cqw)` }}
    >
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        aria-label="Enter an exact value"
        className={cn(
          "pointer-events-auto w-11 -translate-x-1/2 rounded-[6px] border-0 bg-[var(--school-chances-you-chip)] px-1.5 py-0.5 text-center text-chrome font-medium text-[var(--school-chances-you)] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        inputMode="decimal"
        maxLength={4}
        onBlur={onCommit}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        ref={inputRef}
        value={draft}
      />
      {error ? (
        <span
          className={cn(
            "pointer-events-none absolute top-full left-1/2 mt-1 w-max -translate-x-1/2 text-xs text-destructive",
          )}
          id={errorId}
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function clampToLane(lane: Pick<LaneConfig, "min" | "max">, value: number): number {
  return clamp(value, lane.min, lane.max);
}

/** Snaps to the lane's own step grid, anchored at `lane.min` — the same
 * anchor `onGrid()` (`scenario-explorer-model.ts`) checks against. */
function snapToLane(lane: Pick<LaneConfig, "min" | "max" | "step">, value: number): number {
  const steps = Math.round((value - lane.min) / lane.step);
  const snapped = lane.min + steps * lane.step;
  const rounded = Math.round(snapped * 1e6) / 1e6;
  return clampToLane(lane, rounded);
}
