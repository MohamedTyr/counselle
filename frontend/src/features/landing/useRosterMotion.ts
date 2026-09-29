import { useLayoutEffect, useRef } from "react";
import { ENTRANCE, MORPH, STAMP } from "./motion";

const ROW_PX = 56;
const DOT_STEP_MS = 5;
const STATUS_AT_MS = 750;
const STATUS_STEP_MS = 70;
const SORT_AT_MS = 1650;
const SORT_MS = 820;

/**
 * The roster's one demonstration: the class takes its colours, each student
 * gets a status, and the list sorts itself so whoever needs the counselor
 * rises to the top. The markup is the finished state; every step holds its
 * opening frame until the sheet is in view.
 */
function build(figure: HTMLElement): Animation[] {
  const out: Animation[] = [];
  const run = (
    target: Element | null,
    frames: Keyframe[],
    duration: number,
    delay: number,
    easing = ENTRANCE,
  ) => {
    if (target)
      out.push(
        target.animate(frames, { duration, delay, easing, fill: "both" }),
      );
  };

  figure
    .querySelectorAll(".lp-roster-dot i")
    .forEach((dot, index) =>
      run(dot, [{ opacity: 0 }, { opacity: 1 }], 300, index * DOT_STEP_MS),
    );

  figure.querySelectorAll<HTMLElement>(".lp-roster-row").forEach((row, to) => {
    const shift = Number(row.dataset.shift);
    // Statuses land down the list as it stands before the sort.
    run(
      row.querySelector(".lp-roster-status"),
      [
        { opacity: 0, transform: "scale(0.6)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      380,
      STATUS_AT_MS + (to + shift) * STATUS_STEP_MS,
      STAMP,
    );
    run(
      row,
      [
        { transform: `translateY(${shift * ROW_PX}px)` },
        { transform: "translateY(0)" },
      ],
      SORT_MS,
      SORT_AT_MS,
      MORPH,
    );
  });

  return out;
}

export function useRosterMotion() {
  const figure = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = figure.current;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (
      !node ||
      preference.matches ||
      typeof node.animate !== "function" ||
      typeof IntersectionObserver !== "function"
    )
      return;
    const animations = build(node);
    animations.forEach((animation) => animation.pause());
    const settle = () => animations.forEach((animation) => animation.cancel());
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        animations.forEach((animation) => animation.play());
        Promise.all(animations.map((animation) => animation.finished)).then(
          settle,
          () => undefined,
        );
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    preference.addEventListener("change", settle);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", settle);
      settle();
    };
  }, []);
  return figure;
}
