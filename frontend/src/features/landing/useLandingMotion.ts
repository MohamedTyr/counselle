import { useLayoutEffect, useRef } from "react";
import { ENTRANCE, FADE } from "./motion";

/** Blocks below the fold rise into place once, as they scroll in. */
const REVEALS = [
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
                reveal(entry.target);
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
