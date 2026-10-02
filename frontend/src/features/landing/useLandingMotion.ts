import { useLayoutEffect, useRef } from "react";
import { ENTRANCE, FADE } from "./motion";
import { REDUCED_MOTION, useDocumentHidden, useMediaQuery } from "./hooks";

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

function settle(running: Set<Animation>) {
  running.forEach((animation) => animation.cancel());
  running.clear();
}

/** Progressive enhancement: no CSS hides content while it waits for a reveal. */
export function useLandingMotion() {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery(REDUCED_MOTION);
  const hidden = useDocumentHidden();
  const running = useRef(new Set<Animation>());
  const motion = useRef({ reduced, hidden });

  // Returning to a hidden tab or changing motion preference reveals final states.
  useLayoutEffect(() => {
    motion.current = { reduced, hidden };
    settle(running.current);
  }, [reduced, hidden]);

  useLayoutEffect(() => {
    const node = root.current;
    const live = running.current;
    if (!node || typeof Element.prototype.animate !== "function") return;
    const seen = new WeakSet<Element>();
    const reveal = (element: Element) => {
      const { reduced, hidden } = motion.current;
      if (hidden) return;
      const animation = element.animate(
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
      );
      live.add(animation);
      animation.onfinish = () => live.delete(animation);
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
    return () => {
      observer?.disconnect();
      settle(live);
    };
  }, []);
  return root;
}
