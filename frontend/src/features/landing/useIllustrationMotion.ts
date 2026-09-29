import { useLayoutEffect, useRef, type RefObject } from "react";
import { ARRIVAL_MS, ENTRANCE, FADE, MORPH, RISE, STAMP } from "./motion";
import { playEssaySequence } from "./useLandingMotion";
import { COLLEGES_VARIANT } from "./cards/colleges/variants";

const STREAM_WORD_MS = 30;
type MotionState = {
  feature: string;
  keyboard: boolean;
  reduced: boolean;
  inView: boolean;
  hidden: boolean;
  /** An explicit stop, separate from touch devices' slideshow default. */
  paused: boolean;
};

/**
 * A burst: a rest, then many cycles scrolled like a thumb flicking hard —
 * slow to wind up, fast through the middle, coasting back down — forever.
 */
type Loop = { distance: number; period: number; rest: number; cycles: number };
const BURST_REST_MS = 700;
const BURST_MS = 3000;
const BURST = [0.7, 0, 0.3, 1] as const;
/** Keyframes per cycle; the fast middle needs the wraps placed precisely. */
const CYCLE_SAMPLES = 12;
type Step = { frame: Keyframe; ms: number; easing?: string };

/** The moment, as a fraction of a burst, at which it has covered `progress`. */
export function burstTime(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const [x1, y1, x2, y2] = BURST;
  const at = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (at(mid, y1, y2) < progress) low = mid;
    else high = mid;
  }
  return at((low + high) / 2, x1, x2);
}

export class Sequence {
  readonly animations: Animation[] = [];
  readonly root: HTMLElement;
  constructor(root: HTMLElement) {
    this.root = root;
  }

  play(
    selector: string,
    frames: Keyframe[],
    duration: number,
    delay = ARRIVAL_MS,
    stagger = 0,
    options: KeyframeAnimationOptions = {},
  ) {
    this.root.querySelectorAll<HTMLElement>(selector).forEach((node, index) =>
      this.push(node, frames, {
        duration,
        delay: delay + index * stagger,
        easing: ENTRANCE,
        fill: "both",
        ...options,
      }),
    );
  }

  push(node: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    if (typeof node.animate !== "function") return;
    this.animations.push(node.animate(frames, options));
  }

  /**
   * Two identical groups make every wrap visually identical to the frame
   * before it, so one burst can cross the seam many times.
   */
  scroll(selector: string, cycles: number): Loop | undefined {
    const track = this.root.querySelector<HTMLElement>(selector);
    const distance = track?.querySelector<HTMLElement>(
      "[data-scroll-cycle]",
    )?.offsetHeight;
    if (!track || !distance || typeof track.animate !== "function") return;
    const period = BURST_REST_MS + BURST_MS;
    const loop = { distance, period, rest: BURST_REST_MS / period, cycles };
    const frames: Keyframe[] = [{ transform: "translateY(0)", offset: 0 }];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      frames.push({
        transform: "translateY(0)",
        offset: this.moment(cycle, 0, loop),
      });
      for (let step = 1; step <= CYCLE_SAMPLES; step += 1) {
        const part = step / CYCLE_SAMPLES;
        frames.push({
          transform: `translateY(-${distance * part}px)`,
          offset: this.moment(cycle, part, loop),
        });
      }
    }
    this.push(track, frames, this.loopOptions(loop));
    return loop;
  }

  /** When, as a fraction of the period, `cycle` has covered `part` of itself. */
  moment(cycle: number, part: number, loop: Loop): number {
    return (
      loop.rest + (1 - loop.rest) * burstTime((cycle + part) / loop.cycles)
    );
  }

  /** A row's top within the whole scrolling track. */
  position(row: HTMLElement): number {
    const cycle = row.offsetParent as HTMLElement | null;
    return row.offsetTop + (cycle?.offsetTop ?? 0);
  }

  /**
   * Keyframes for a row at `top`: it holds `before` from each wrap, runs
   * `steps` as it crosses `line`, and holds the last step until the next
   * wrap. A row already past the line holds its settled state; a row the
   * burst never carries past it stays `before`. Steps shrink when a cycle
   * is too fast to fit them.
   */
  beats(
    top: number,
    line: number,
    loop: Loop,
    before: Keyframe,
    steps: Step[],
  ): Keyframe[] {
    const settled = steps[steps.length - 1].frame;
    if (top < line) return [settled, settled];
    if (top >= line + loop.distance) return [before, before];
    const part = (top - line) / loop.distance;
    const total = steps.reduce((sum, step) => sum + step.ms, 0) / loop.period;
    const frames: Keyframe[] = [{ ...before, offset: 0 }];
    for (let cycle = 0; cycle < loop.cycles; cycle += 1) {
      const cross = this.moment(cycle, part, loop);
      const wrap =
        cycle + 1 < loop.cycles ? this.moment(cycle + 1, 0, loop) : 1;
      const scale = Math.min(1, ((wrap - cross) * 0.7) / total);
      let at = cross;
      frames.push({
        ...before,
        offset: at,
        easing: steps[0].easing ?? ENTRANCE,
      });
      steps.forEach((step, index) => {
        at += (step.ms / loop.period) * scale;
        frames.push({
          ...step.frame,
          offset: at,
          easing: steps[index + 1]?.easing ?? ENTRANCE,
        });
      });
      frames.push({ ...settled, offset: wrap });
      if (wrap < 1) frames.push({ ...before, offset: wrap });
    }
    return frames;
  }

  loopOptions(loop: Loop): KeyframeAnimationOptions {
    return {
      duration: loop.period,
      delay: ARRIVAL_MS,
      iterations: Infinity,
      easing: "linear",
      fill: "both",
    };
  }

  /** Reveal a reply word by word, like a model streaming its answer. */
  stream(selector: string, delay: number) {
    const node = this.root.querySelector<HTMLElement>(selector);
    if (!node) return;
    if (!node.querySelector(".lp-word")) {
      const text = node.textContent ?? "";
      node.textContent = "";
      text.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) node.append(part);
        else {
          const word = document.createElement("span");
          word.className = "lp-word";
          word.textContent = part;
          node.append(word);
        }
      });
    }
    this.play(
      `${selector} .lp-word`,
      [
        { opacity: 0, transform: "translateY(3px)" },
        { opacity: 1, transform: "none" },
      ],
      220,
      delay,
      STREAM_WORD_MS,
    );
  }
}

/** Rows arrive, every match ring draws to its score, then one row opens. */
function colleges(seq: Sequence) {
  seq.play(".lp-match-row", RISE, 320, ARRIVAL_MS, 60);
  seq.root
    .querySelectorAll<SVGCircleElement>(".lp-ring-progress")
    .forEach((ring, index) =>
      seq.push(
        ring,
        [
          { strokeDashoffset: ring.getAttribute("stroke-dasharray") ?? "0" },
          { strokeDashoffset: ring.getAttribute("stroke-dashoffset") ?? "0" },
        ],
        {
          duration: 700,
          delay: ARRIVAL_MS + 200 + index * 60,
          easing: ENTRANCE,
          fill: "both",
        },
      ),
    );
  seq.play(".lp-match-score span", FADE, 250, ARRIVAL_MS + 540, 60);
  seq.play(
    ".lp-match-row-detail",
    [
      { backgroundColor: "rgba(61, 49, 131, 0)" },
      { backgroundColor: "rgba(61, 49, 131, 0.07)" },
    ],
    240,
    1450,
  );
  seq.play(
    ".lp-popover",
    [
      { opacity: 0, transform: "scale(0.92) translateY(-4px)" },
      { opacity: 1, transform: "none" },
    ],
    380,
    1580,
  );
}

/** The stream bursts past; each match is ticked as it crosses the middle. */
function scholarships(seq: Sequence) {
  const loop = seq.scroll(".lp-stream", 6);
  if (!loop) return;
  const line = (seq.root.querySelector(".lp-sheet")?.clientHeight ?? 240) / 2;
  seq.root.querySelectorAll<HTMLElement>(".lp-stream-match").forEach((row) => {
    const top = seq.position(row);
    const beat = (
      node: Element | null,
      before: Keyframe,
      frame: Keyframe,
      ms: number,
      easing = ENTRANCE,
    ) => {
      const frames = seq.beats(top, line, loop, before, [
        { frame, ms, easing },
      ]);
      if (node && frames) seq.push(node, frames, seq.loopOptions(loop));
    };
    beat(
      row,
      { backgroundColor: "rgba(249, 232, 236, 0)" },
      { backgroundColor: "#f9e8ec" },
      220,
    );
    beat(
      row.querySelector(".lp-stream-tick"),
      { transform: "scale(0)" },
      { transform: "scale(1)" },
      280,
      STAMP,
    );
    beat(
      row.querySelector(".lp-stream-amount"),
      { opacity: 0, transform: "translateX(6px)" },
      { opacity: 1, transform: "none" },
      240,
    );
  });
}

/** The suggested row rests here; it is added the instant the list starts to move. */
const ADD_LINE = 44;

/** The list starts to move, the suggested program is added, then it bursts. */
function activities(seq: Sequence) {
  const loop = seq.scroll(".lp-activity-list", 5);
  if (!loop) return;
  const line = ADD_LINE;
  const ink = "#121214";
  const green = "#0a6b3d";
  seq.root
    .querySelectorAll<HTMLElement>(".lp-activity-highlight")
    .forEach((row) => {
      const top = seq.position(row);
      const beat = (node: Element | null, before: Keyframe, steps: Step[]) => {
        if (node)
          seq.push(
            node,
            seq.beats(top, line, loop, before, steps),
            seq.loopOptions(loop),
          );
      };
      beat(
        row.querySelector(".lp-activity-add"),
        { transform: "scale(1)", backgroundColor: ink },
        [
          {
            frame: { transform: "scale(0.94)", backgroundColor: ink },
            ms: 100,
          },
          {
            frame: { transform: "scale(1)", backgroundColor: green },
            ms: 200,
            easing: STAMP,
          },
        ],
      );
      beat(row.querySelector(".lp-activity-add-label"), { opacity: 1 }, [
        { frame: { opacity: 1 }, ms: 100 },
        { frame: { opacity: 0 }, ms: 150 },
      ]);
      beat(row.querySelector(".lp-activity-added"), { opacity: 0 }, [
        { frame: { opacity: 0 }, ms: 100 },
        { frame: { opacity: 1 }, ms: 200 },
      ]);
    });
}

/**
 * A wrong pick, the correction, a question, then a streamed explanation.
 * Every state change is a morph: fills and letters cross over, verdicts
 * slide in beside their answer, and the wrong choice is pressed first.
 */
function sat(seq: Sequence) {
  const morph = { easing: MORPH };
  const neutral = {
    backgroundColor: "#ffffff",
    borderColor: "rgba(18, 18, 20, 0.14)",
  };
  const letter = { backgroundColor: "#ffffff", color: "#121214" };
  const verdict = [
    { opacity: 0, transform: "translateX(-6px)" },
    { opacity: 1, transform: "none" },
  ];
  const mark = (tone: string, at: number) => {
    seq.play(
      `${tone} .lp-choice-letter`,
      [
        { ...letter, transform: "scale(1)" },
        { transform: "scale(1.18)", offset: 0.45 },
        {
          backgroundColor: tone.includes("wrong") ? "#b22121" : "#0a6b3d",
          color: "#ffffff",
          transform: "scale(1)",
        },
      ],
      480,
      at,
      0,
      morph,
    );
    seq.play(`${tone} .lp-choice-verdict`, verdict, 420, at + 180, 0, morph);
  };
  seq.play(
    ".lp-choice-wrong",
    [
      { ...neutral, transform: "scale(1)" },
      { ...neutral, transform: "scale(0.985)", offset: 0.3 },
      { backgroundColor: "#fdedec", borderColor: "#b22121", transform: "none" },
    ],
    560,
    ARRIVAL_MS,
    0,
    morph,
  );
  mark(".lp-choice-wrong", ARRIVAL_MS + 80);
  seq.play(
    ".lp-choice-correct",
    [neutral, { backgroundColor: "#e9f8ef", borderColor: "#0a6b3d" }],
    560,
    ARRIVAL_MS + 720,
    0,
    morph,
  );
  mark(".lp-choice-correct", ARRIVAL_MS + 800);
  seq.play(
    ".lp-choice-dim",
    [{ opacity: 1 }, { opacity: 0.42 }],
    500,
    ARRIVAL_MS + 720,
    0,
    morph,
  );
  seq.play(
    ".lp-choice-dim s",
    [
      { textDecorationColor: "transparent" },
      { textDecorationColor: "#121214" },
    ],
    400,
    ARRIVAL_MS + 760,
    0,
    morph,
  );
  seq.play(".lp-ask-user-row", RISE, 320, ARRIVAL_MS + 1200);
  seq.play(
    ".lp-ask-typing",
    [
      { opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { opacity: 1, offset: 0.85 },
      { opacity: 0 },
    ],
    520,
    ARRIVAL_MS + 1400,
  );
  seq.play(
    ".lp-ask-typing i",
    [
      { transform: "translateY(0)" },
      { transform: "translateY(-3px)", offset: 0.5 },
      { transform: "translateY(0)" },
    ],
    380,
    ARRIVAL_MS + 1450,
    110,
    { fill: "none" },
  );
  seq.stream(".lp-ask-answer", ARRIVAL_MS + 1900);
}

/** Deadlines drop in, then a task gets checked off and struck through. */
function deadlines(seq: Sequence) {
  seq.play(".lp-deadline", RISE, 300, ARRIVAL_MS, 70);
  seq.play(
    ".lp-checkbox-done rect",
    [{ transform: "scale(0.6)" }, { transform: "scale(1)" }],
    260,
    ARRIVAL_MS + 420,
    0,
    { easing: STAMP },
  );
  seq.play(
    ".lp-checkbox-tick",
    [{ strokeDashoffset: 12 }, { strokeDashoffset: 0 }],
    300,
    ARRIVAL_MS + 520,
  );
  seq.play(
    ".lp-task-done s",
    [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
    320,
    ARRIVAL_MS + 620,
    0,
    { pseudoElement: "::after" },
  );
  seq.play(
    ".lp-task-done s",
    [{ color: "#2a2f2d" }, { color: "#7c8582" }],
    300,
    ARRIVAL_MS + 620,
  );
}

/** The week arrives, a time is pressed, and the booking it makes appears. */
function sessions(seq: Sequence) {
  const pick = ARRIVAL_MS + 700;
  const free = { backgroundColor: "#ffffff", color: "#0f4a52" };
  seq.play(".lp-book-day", RISE, 320, ARRIVAL_MS, 50);
  seq.play(
    ".lp-book-day span[data-picked]",
    [
      { ...free, transform: "scale(1)" },
      { ...free, transform: "scale(0.94)", offset: 0.3 },
      { backgroundColor: "#10292d", color: "#ffffff", transform: "scale(1)" },
    ],
    420,
    pick,
    0,
    { easing: MORPH },
  );
  seq.play(
    ".lp-book-card",
    [
      { opacity: 0, transform: "translateY(10px) scale(0.97)" },
      { opacity: 1, transform: "none" },
    ],
    420,
    pick + 300,
  );
  seq.play(
    ".lp-book-status",
    [
      { opacity: 0, transform: "scale(0.6)" },
      { opacity: 1, transform: "scale(1)" },
    ],
    320,
    pick + 520,
    0,
    { easing: STAMP },
  );
  seq.play(".lp-book-when", RISE, 320, pick + 600);
  seq.play(
    ".lp-book-count i",
    [{ opacity: 0.25 }, { opacity: 1 }],
    260,
    pick + 760,
    140,
  );
}

/** The marker pass starts once the sheet has arrived. */
function essay(seq: Sequence) {
  seq.animations.push(...playEssaySequence(seq.root, false, ARRIVAL_MS));
}

const SEQUENCES: Record<string, (seq: Sequence) => void> = {
  essay,
  colleges: (seq) => (COLLEGES_VARIANT.play ?? colleges)(seq),
  scholarships,
  activities,
  sat,
  deadlines,
  sessions,
};

/** Each sheet demonstrates its feature every time it is shown; the DOM is the settled fallback. */
function playIllustration(root: HTMLElement, feature: string): Animation[] {
  const seq = new Sequence(root);
  SEQUENCES[feature]?.(seq);
  return seq.animations;
}

/** Plays one demonstration outside the stage, for side-by-side comparison. */
export function playDemonstration(
  root: HTMLElement,
  play: (seq: Sequence) => void,
): Animation[] {
  const seq = new Sequence(root);
  play(seq);
  return seq.animations;
}

export function useIllustrationMotion(
  root: RefObject<HTMLDivElement | null>,
  { feature, keyboard, reduced, inView, hidden, paused }: MotionState,
) {
  const animations = useRef<Animation[]>([]);
  const handled = useRef(false);
  useLayoutEffect(() => {
    handled.current = false;
    return () => {
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
    };
  }, [root, feature, keyboard, reduced]);

  useLayoutEffect(() => {
    if (handled.current) return;
    const node = root.current;
    // Never hide offscreen content while waiting for an observer callback.
    // Explicitly paused selections, keyboard and reduced motion stay complete.
    if (keyboard || reduced) {
      handled.current = true;
      return;
    }
    if (
      paused ||
      !node ||
      !inView ||
      hidden ||
      typeof IntersectionObserver !== "function"
    )
      return;
    handled.current = true;
    animations.current = playIllustration(node, feature);
  }, [root, feature, keyboard, reduced, inView, hidden, paused]);

  useLayoutEffect(() => {
    for (const animation of animations.current) {
      // play() on a finished WAAPI animation rewinds it. Keep the completed
      // explanation settled when the visitor scrolls away and comes back.
      if (animation.playState === "finished") continue;
      if (!inView || hidden || paused) animation.pause();
      else animation.play();
    }
  }, [feature, keyboard, reduced, inView, hidden, paused]);
}
export { colleges as playCurrentColleges };
