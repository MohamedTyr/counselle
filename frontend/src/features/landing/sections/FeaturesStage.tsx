import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import "./features-stage.css";
import { FEATURES } from "./featureList";
import { StageFigure } from "./StageFigure";
import { useStageClock } from "./useStageClock";
import { ENTRANCE } from "../motion";

/** How long a sheet stays where its demonstration cannot be measured. */
const DEFAULT_DWELL_MS = 4500;
const WASH_MS = 500;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";
/** Below this width the sheets differ in height, so advancing alone would move the page. */
const UNEVEN_SHEETS = "(max-width: 899px)";

type Shown = { active: number; run: number };

/**
 * Browser-only inputs read through a store: the prerendered page and the
 * hydrating render use the server value, then the live value takes over.
 */
function useMediaQuery(query: string, server: boolean) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => server,
  );
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
type Selection = Shown & { keyboard: boolean; leaving: Shown | null };

/** One immediately selectable feature; automatic advance only while unattended. */
export function FeaturesStage() {
  const [{ active, run, keyboard, leaving }, setSelection] =
    useState<Selection>({ active: 0, run: 0, keyboard: false, leaving: null });
  const finePointer = useMediaQuery(FINE_POINTER, false);
  const unevenSheets = useMediaQuery(UNEVEN_SHEETS, false);
  const [pausedChoice, setPausedChoice] = useState<boolean | null>(null);
  const paused = pausedChoice ?? (!finePointer || unevenSheets);
  const [explicitPlay, setExplicitPlay] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.hidden,
    () => false,
  );
  const [inView, setInView] = useState(false);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)", false);
  const root = useRef<HTMLDivElement>(null);
  // A press leaves focus behind it; only focus reached by keyboard holds the stage.
  const pressed = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const previousWash = useRef(FEATURES[0]);
  const feature = FEATURES[active];
  const dwell = feature.dwell ?? DEFAULT_DWELL_MS;
  const autoplay =
    inView &&
    !paused &&
    ((!hovered && !focused) || explicitPlay) &&
    !hidden &&
    !reduced;

  /** Every selection is a new run, so choosing the open feature plays it again. */
  const select = useCallback(
    (next: number | ((active: number) => number), byKeyboard: boolean) =>
      setSelection((shown) => ({
        active: typeof next === "function" ? next(shown.active) : next,
        run: shown.run + 1,
        keyboard: byKeyboard,
        leaving: byKeyboard ? null : { active: shown.active, run: shown.run },
      })),
    [],
  );
  const advance = useCallback(
    () => select((shown) => (shown + 1) % FEATURES.length, false),
    [select],
  );
  const onGone = useCallback(
    (gone: number) =>
      setSelection((shown) =>
        shown.leaving?.run === gone ? { ...shown, leaving: null } : shown,
      ),
    [],
  );
  useStageClock(root, {
    run,
    dwell,
    running: autoplay,
    immediate: keyboard || reduced,
    onElapsed: advance,
  });

  useEffect(() => {
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            ([entry]) =>
              setInView(
                entry.isIntersecting && entry.intersectionRatio >= 0.15,
              ),
            { threshold: 0.15 },
          )
        : undefined;
    if (panel.current) observer?.observe(panel.current);
    return () => observer?.disconnect();
  }, []);

  useLayoutEffect(() => {
    const old = previousWash.current;
    previousWash.current = feature;
    const node = backdrop.current;
    if (
      !node ||
      old === feature ||
      keyboard ||
      hidden ||
      !inView ||
      typeof node.animate !== "function"
    )
      return;
    node.style.setProperty("--stage-tint", old.tint);
    node.style.setProperty("--stage-glow", old.glow);
    const animation = node.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: reduced ? 150 : WASH_MS,
      easing: ENTRANCE,
    });
    return () => animation.cancel();
  }, [feature, keyboard, hidden, inView, reduced]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
      event.key
    ];
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? FEATURES.length - 1
          : step
            ? (active + step + FEATURES.length) % FEATURES.length
            : null;
    if (next === null) return;
    event.preventDefault();
    setExplicitPlay(false);
    select(next, true);
    root.current
      ?.querySelector<HTMLButtonElement>(`#lp-stage-tab-${FEATURES[next].id}`)
      ?.focus();
  };

  return (
    <div
      ref={root}
      className={`lp-stage${autoplay ? " lp-stage-playing" : ""}`}
      data-keyboard-motion={keyboard}
      style={
        {
          "--stage-tint": feature.tint,
          "--stage-glow": feature.glow,
        } as CSSProperties
      }
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          setHovered(true);
          setExplicitPlay(false);
        }
      }}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={() => {
        pressed.current = true;
      }}
      onFocus={() => {
        const byPress = pressed.current;
        pressed.current = false;
        if (byPress) return;
        setFocused(true);
        setExplicitPlay(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setFocused(false);
        setExplicitPlay(false);
      }}
    >
      <div
        className="lp-stage-list"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Features"
        onKeyDown={onKeyDown}
      >
        {FEATURES.map(({ id, title, blurb, color }, index) => {
          const selected = index === active;
          return (
            <button
              key={id}
              id={`lp-stage-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="lp-stage-panel"
              tabIndex={selected ? 0 : -1}
              className={`lp-stage-tab${selected ? " lp-stage-tab-active" : ""}`}
              onClick={(event) => {
                setExplicitPlay(false);
                select(index, event.detail === 0);
              }}
            >
              <span
                className="lp-stage-progress"
                style={{ background: color }}
                aria-hidden="true"
              />
              <h3>{title}</h3>
              <p>
                <span>{blurb}</span>
              </p>
            </button>
          );
        })}
      </div>
      <p className="lp-stage-description" id="lp-stage-description">
        {feature.blurb}
      </p>
      <div
        ref={panel}
        id="lp-stage-panel"
        aria-describedby="lp-stage-description"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`lp-stage-tab-${feature.id}`}
        className="lp-stage-panel"
      >
        <div ref={backdrop} className="lp-stage-backdrop" aria-hidden="true" />
        {[
          ...(leaving ? [{ ...leaving, leaving: true }] : []),
          { active, run, leaving: false },
        ].map((shown) => (
          <StageFigure
            key={shown.run}
            run={shown.run}
            feature={FEATURES[shown.active]}
            entrance={shown.run > 0 && !keyboard}
            leaving={shown.leaving}
            onGone={onGone}
            keyboard={keyboard}
            reduced={reduced}
            inView={inView}
            hidden={hidden}
            paused={userPaused}
          />
        ))}
      </div>
      {!reduced && (
        <button
          type="button"
          className="lp-stage-playback"
          aria-label={paused ? "Play showcase" : "Pause showcase"}
          onClick={() => {
            setExplicitPlay(paused);
            setUserPaused(!paused);
            setPausedChoice(!paused);
          }}
        >
          <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>{" "}
          {paused ? "Play showcase" : "Pause showcase"}
        </button>
      )}
    </div>
  );
}
