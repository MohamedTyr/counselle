import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import "./features-stage.css";
import { FEATURES, stageTabId, type Feature } from "./featureList";
import { StageFigure } from "./StageFigure";
import { StagePlayback } from "./StagePlayback";
import { Blurbs, StageTabs } from "./StageTabs";
import { useStageClock } from "./useStageClock";
import { useStageSelection } from "./useStageSelection";
import { ENTRANCE } from "../motion";
import {
  REDUCED_MOTION,
  useDocumentHidden,
  useInView,
  useMediaQuery,
} from "../hooks";

/** How long a sheet stays where its demonstration cannot be measured. */
const DEFAULT_DWELL_MS = 4500;
const WASH_MS = 500;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";
/** Below this width the sheets differ in height, so advancing alone would move the page. */
const UNEVEN_SHEETS = "(max-width: 899px)";
/** How much of the panel shows before the showcase counts as watched. */
const IN_VIEW = 0.15;

/**
 * Who decides whether the showcase advances: the page's default for the
 * device, or the visitor's last press of Pause or Play. A press of Play keeps
 * it going under the pointer until the visitor turns to the stage again.
 */
type Playback = "auto" | "userPaused" | "userPlaying";

/**
 * Whether the visitor is attending to the stage: a mouse over it, or focus
 * reached by keyboard (a press leaves focus behind it, which doesn't count).
 * `onAttend` fires each time they turn to it.
 */
function useStageAttention(onAttend: () => void) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const pressed = useRef(false);
  const handlers = {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      setHovered(true);
      onAttend();
    },
    onPointerLeave: () => setHovered(false),
    onPointerDown: () => {
      pressed.current = true;
    },
    onFocus: () => {
      const byPress = pressed.current;
      pressed.current = false;
      if (byPress) return;
      setFocused(true);
      onAttend();
    },
    onBlur: (event: FocusEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node))
        setFocused(false);
      onAttend();
    },
  };
  return { held: hovered || focused, handlers };
}

type WashState = {
  keyboard: boolean;
  hidden: boolean;
  inView: boolean;
  reduced: boolean;
};

/** The previous feature's colour fades out behind the new sheet. */
function useStageWash(
  backdrop: RefObject<HTMLDivElement | null>,
  feature: Feature,
  { keyboard, hidden, inView, reduced }: WashState,
) {
  const previous = useRef(feature);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = feature;
    const node = backdrop.current;
    if (!node || old === feature || keyboard || hidden || !inView) return;
    if (typeof node.animate !== "function") return;
    node.style.setProperty("--stage-tint", old.tint);
    node.style.setProperty("--stage-glow", old.glow);
    const animation = node.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: reduced ? 150 : WASH_MS,
      easing: ENTRANCE,
    });
    return () => animation.cancel();
  }, [backdrop, feature, keyboard, hidden, inView, reduced]);
}

/** Whether the showcase is paused, and who said so. */
function usePlayback() {
  const [playback, setPlayback] = useState<Playback>("auto");
  const finePointer = useMediaQuery(FINE_POINTER);
  const unevenSheets = useMediaQuery(UNEVEN_SHEETS);
  const stillByDefault = !finePointer || unevenSheets;
  const paused =
    playback === "userPaused" || (playback === "auto" && stillByDefault);
  return {
    paused,
    /** Paused by the visitor, which also freezes the sheet's own motion. */
    userPaused: playback === "userPaused",
    /** Play was pressed, so the showcase goes on under the pointer. */
    userPlaying: playback === "userPlaying",
    toggle: () => setPlayback(paused ? "userPlaying" : "userPaused"),
    // Turning to the stage hands a pressed Play back to the default.
    attend: () => setPlayback((now) => (now === "userPlaying" ? "auto" : now)),
  };
}

type Selection = ReturnType<typeof useStageSelection>;
type PanelProps = Pick<
  Selection,
  "active" | "run" | "keyboard" | "leaving" | "onGone"
> & {
  panelRef: RefObject<HTMLDivElement | null>;
  inView: boolean;
  reduced: boolean;
  hidden: boolean;
  paused: boolean;
};

/** The panel the sheets stand in: the one on stage, and the one leaving it. */
function StagePanel({ panelRef, active, run, leaving, ...rest }: PanelProps) {
  const { keyboard, onGone, ...motion } = rest;
  const backdrop = useRef<HTMLDivElement>(null);
  const feature = FEATURES[active];
  useStageWash(backdrop, feature, { keyboard, ...motion });
  const sheets = [
    ...(leaving ? [{ ...leaving, leaving: true }] : []),
    { active, run, leaving: false },
  ];
  return (
    <div
      ref={panelRef}
      id="lp-stage-panel"
      aria-describedby="lp-stage-description"
      role="tabpanel"
      tabIndex={0}
      aria-labelledby={stageTabId(feature)}
      className="lp-stage-panel"
    >
      <div ref={backdrop} className="lp-stage-backdrop" aria-hidden="true" />
      {sheets.map((shown) => (
        <StageFigure
          key={shown.run}
          run={shown.run}
          feature={FEATURES[shown.active]}
          entrance={shown.run > 0 && !keyboard}
          leaving={shown.leaving}
          onGone={onGone}
          keyboard={keyboard}
          {...motion}
        />
      ))}
    </div>
  );
}

/** One immediately selectable feature; automatic advance only while unattended. */
export function FeaturesStage() {
  const selection = useStageSelection();
  const { active, run, keyboard, select, advance } = selection;
  const playback = usePlayback();
  const { held, handlers } = useStageAttention(playback.attend);
  const hidden = useDocumentHidden();
  const reduced = useMediaQuery(REDUCED_MOTION);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const inView = useInView(panel, IN_VIEW);
  const feature = FEATURES[active];
  const autoplay =
    inView &&
    !playback.paused &&
    (!held || playback.userPlaying) &&
    !hidden &&
    !reduced;
  useStageClock(root, {
    run,
    dwell: feature.dwell ?? DEFAULT_DWELL_MS,
    running: autoplay,
    immediate: keyboard || reduced,
    onElapsed: advance,
  });
  const style = {
    "--stage-tint": feature.tint,
    "--stage-glow": feature.glow,
  } as CSSProperties;
  return (
    <div
      ref={root}
      className={`lp-stage${autoplay ? " lp-stage-playing" : ""}`}
      data-keyboard-motion={keyboard}
      style={style}
      {...handlers}
    >
      <StageTabs
        active={active}
        onSelect={(index, byKeyboard) => {
          playback.attend();
          select(index, byKeyboard);
        }}
      />
      <p
        className="lp-stage-description lp-stage-blurbs"
        id="lp-stage-description"
      >
        <Blurbs shown={active} />
      </p>
      <StagePanel
        active={active}
        run={run}
        keyboard={keyboard}
        leaving={selection.leaving}
        onGone={selection.onGone}
        panelRef={panel}
        inView={inView}
        reduced={reduced}
        hidden={hidden}
        paused={playback.userPaused}
      />
      {!reduced && (
        <StagePlayback paused={playback.paused} onToggle={playback.toggle} />
      )}
    </div>
  );
}
