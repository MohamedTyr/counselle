import { useLayoutEffect, useRef } from "react";
import { ENTRANCE, FADE, STAMP, canAnimate } from "./motion";

type Run = (
  target: Element | null,
  frames: Keyframe[],
  duration: number,
  delay: number,
  easing?: string,
  options?: KeyframeAnimationOptions,
) => void;

/** One helper per sequence: reduced motion collapses every step to a short fade. */
function runner(reduced: boolean, out: Animation[], wait: number): Run {
  return (target, frames, duration, delay, easing = ENTRANCE, options = {}) => {
    if (!target) return;
    out.push(
      target.animate(reduced ? FADE : frames, {
        duration: reduced ? 150 : duration,
        delay: reduced ? 0 : wait + delay,
        easing: reduced ? "ease-out" : easing,
        fill: "backwards",
        ...options,
      }),
    );
  };
}

/** Wider than the corrected word, so it is never clipped once written. */
const FIX_ROOM = "96px";

/**
 * A marker pen, not a fade: each highlight sweeps across its phrase, its note
 * slides in beside it and its count stamps on; then the typo is struck and
 * its correction is written in beside it, moving the rest of that line along.
 */
export function playEssaySequence(
  card: Element,
  reduced: boolean,
  wait = 0,
): Animation[] {
  if (!canAnimate()) return [];
  const out: Animation[] = [];
  const run = runner(reduced, out, wait);
  ["g", "v", "a"].forEach((tone, index) => {
    const base = index * 800;
    card
      .querySelectorAll(`.lp-hl-${tone} .lp-hl-background`)
      .forEach((background, line) =>
        run(
          background,
          [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
          480,
          base + line * 200,
        ),
      );
    run(
      card.querySelectorAll(".lp-note")[index] ?? null,
      [
        { opacity: 0, transform: "translateX(12px)" },
        { opacity: 1, transform: "none" },
      ],
      420,
      base + 300,
    );
    if (!reduced)
      run(
        card.querySelectorAll(".lp-count")[index] ?? null,
        [{ transform: "scale(0.5)" }, { transform: "scale(1)" }],
        380,
        base + 360,
        STAMP,
      );
  });
  if (reduced) return out;
  const strike = card.querySelector(".lp-essay-strike");
  run(
    strike,
    [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
    280,
    2500,
    ENTRANCE,
    { pseudoElement: "::after" },
  );
  run(strike, [{ color: "#2a2f2d" }, { color: "#7c8582" }], 360, 2500);
  // The correction opens its own room in the line, so nothing waits empty.
  run(
    card.querySelector(".lp-essay-strike + .lp-space"),
    [{ width: "0px" }, { width: "4px" }],
    320,
    2850,
  );
  run(
    card.querySelector(".lp-essay-fix"),
    [
      { opacity: 0, maxWidth: "0px" },
      { opacity: 1, maxWidth: FIX_ROOM },
    ],
    320,
    2850,
  );
  return out;
}

/** Blocks below the fold rise into place once, as they scroll in. */
const REVEALS = [
  ".lp-features-cards .lp-cards > .lp-card-row",
  ".lp-features-cards .lp-cards > .lp-card-wide",
  ".lp-features-header",
  ".lp-stage",
  ".lp-testimonials-heading",
  ".lp-testimonial-cards",
  ".lp-compare > .lp-heading",
  ".lp-compare-scroll",
  ".lp-pricing > .lp-heading",
  ".lp-plans",
  ".lp-schools",
  ".lp-faq-intro",
  ".lp-faq-list",
].join(", ");

/** Progressive enhancement: no CSS hides content while it waits for a reveal. */
export function useLandingMotion() {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || typeof Element.prototype.animate !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const running = new Set<Animation>();
    const seen = new WeakSet<Element>();
    const track = (animations: Animation[]) =>
      animations.forEach((animation) => {
        running.add(animation);
        animation.onfinish = () => running.delete(animation);
      });
    const settle = () => {
      running.forEach((animation) => animation.cancel());
      running.clear();
    };
    const reveal = (element: Element) => {
      if (document.hidden) return;
      const reduced = preference.matches;
      track([
        element.animate(
          reduced
            ? FADE
            : [
                { opacity: 0, transform: "translateY(14px)" },
                { opacity: 1, transform: "none" },
              ],
          {
            duration: reduced ? 150 : 420,
            easing: reduced ? "ease-out" : ENTRANCE,
            fill: "backwards",
          },
        ),
      ]);
    };
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                if (
                  !entry.isIntersecting ||
                  entry.intersectionRatio < 0.15 ||
                  seen.has(entry.target)
                )
                  return;
                seen.add(entry.target);
                observer?.unobserve(entry.target);
                if (entry.target.matches(".lp-card-essay"))
                  track(playEssaySequence(entry.target, preference.matches));
                else reveal(entry.target);
              });
            },
            { threshold: 0.15 },
          )
        : undefined;
    node
      .querySelectorAll(REVEALS)
      .forEach((element) => observer?.observe(element));
    // Returning to a hidden tab or changing motion preference reveals final states.
    const onVisibility = () => {
      if (document.hidden) settle();
    };
    preference.addEventListener("change", settle);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer?.disconnect();
      preference.removeEventListener("change", settle);
      document.removeEventListener("visibilitychange", onVisibility);
      settle();
    };
  }, []);
  return root;
}
