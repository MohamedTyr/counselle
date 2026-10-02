import { useEffect, useRef, type RefObject } from "react";

/** How long a finished demonstration stays up to be read before the next one. */
const READ_MS = 2400;
/** A scrolling sheet leaves this far into the stillness between two bursts. */
const LOOP_SETTLE_MS = 300;
const BAR_FADE_MS = 200;
/** The timer's own length; its rate is what fits it to the time that is left. */
const BAR_MS = 1000;

type ClockOptions = {
  /** Changes with every selection; a new run starts the clock from zero. */
  run: number;
  /** How long a sheet stays when its demonstration cannot be measured. */
  dwell: number;
  /** The showcase is advancing on its own. */
  running: boolean;
  /** The selection was made without motion, so the old timer leaves at once. */
  immediate: boolean;
  onElapsed: () => void;
};

/**
 * How long until the sheet on stage is ready to be replaced: a demonstration
 * that ends is left up to be read, and one that repeats is left at the end
 * of the burst it is in, never part-way through the next.
 */
function timeToSettle(stage: HTMLElement | null): number | undefined {
  const figure = stage?.querySelector(
    ".lp-stage-figure:not(.lp-stage-figure-leaving)",
  );
  if (typeof figure?.getAnimations !== "function") return;
  let ends = 0;
  let wraps: number | undefined;
  const animations = figure.getAnimations({ subtree: true });
  for (const animation of animations) {
    const timing = animation.effect?.getComputedTiming();
    if (!timing) continue;
    const at = Number(animation.currentTime ?? 0);
    if (timing.iterations === Infinity) {
      const period = Number(timing.duration);
      const into = at - Number(timing.delay ?? 0);
      const left = into < 0 ? period - into : period - (into % period);
      wraps = Math.max(wraps ?? 0, left);
    } else if (animation.playState !== "finished")
      ends = Math.max(ends, Number(timing.endTime) - at);
  }
  if (!animations.length) return;
  return wraps === undefined ? ends + READ_MS : wraps + LOOP_SETTLE_MS;
}

function retire(
  bar: Animation | undefined,
  next: Element | null,
  now: boolean,
) {
  if (!bar) return;
  const target = (bar.effect as KeyframeEffect | null)?.target;
  if (now || !target || target === next) {
    bar.cancel();
    return;
  }
  const fade = target.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: BAR_FADE_MS,
    easing: "ease-out",
    fill: "forwards",
  });
  const clear = () => {
    bar.cancel();
    fade.cancel();
  };
  fade.finished.then(clear, clear);
}

/**
 * One clock for the showcase, set by the demonstration rather than beside
 * it. It holds its place whenever the showcase stops advancing, and the
 * active tab's timer is drawn from the same progress, so the two never
 * disagree.
 */
export function useStageClock(
  root: RefObject<HTMLElement | null>,
  { run, dwell, running, immediate, onElapsed }: ClockOptions,
) {
  const clock = useRef<{ run: number; progress: number; bar?: Animation }>({
    run,
    progress: 0,
  });

  useEffect(() => {
    const track = root.current?.querySelector<HTMLElement>(
      ".lp-stage-tab-active .lp-stage-progress",
    );
    if (clock.current.run !== run) {
      retire(clock.current.bar, track ?? null, immediate);
      clock.current = { run, progress: 0 };
    }
    const current = clock.current;
    if (!running) {
      current.bar?.pause();
      return;
    }
    const from = current.progress;
    const wait = Math.max(timeToSettle(root.current) ?? (1 - from) * dwell, 1);
    const since = Date.now();
    const timer = window.setTimeout(onElapsed, wait);
    if (!current.bar && track && typeof track.animate === "function")
      current.bar = track.animate(
        [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
        { duration: BAR_MS, easing: "linear", fill: "both" },
      );
    if (current.bar) {
      current.bar.currentTime = from * BAR_MS;
      current.bar.playbackRate = ((1 - from) * BAR_MS) / wait;
      current.bar.play();
    }
    return () => {
      window.clearTimeout(timer);
      const share = Math.min((Date.now() - since) / wait, 1);
      current.progress = from + (1 - from) * share;
    };
  }, [root, run, dwell, running, immediate, onElapsed]);

  useEffect(() => () => clock.current.bar?.cancel(), []);
}
