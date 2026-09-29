import { useLayoutEffect, useRef } from "react";
import type { Feature } from "./featureList";
import { ENTRANCE } from "../motion";
import { useIllustrationMotion } from "../useIllustrationMotion";

const ENTER_MS = 500;
const EXIT_MS = 220;
const REDUCED_MS = 150;

type StageFigureProps = {
  feature: Feature;
  /** The selection this sheet was shown for. */
  run: number;
  /** The sheet replaces another one, so it rises in instead of just being there. */
  entrance: boolean;
  /** Another sheet has taken over; this one sinks away and asks to be removed. */
  leaving: boolean;
  onGone: (run: number) => void;
  keyboard: boolean;
  reduced: boolean;
  inView: boolean;
  hidden: boolean;
  paused: boolean;
};

/** One sheet on the stage: it arrives, demonstrates its feature, and leaves. */
export function StageFigure({
  feature,
  run,
  entrance,
  leaving,
  onGone,
  keyboard,
  reduced,
  inView,
  hidden,
  paused,
}: StageFigureProps) {
  const figure = useRef<HTMLDivElement>(null);
  const arrival = useRef<Animation | undefined>(undefined);
  const { Sheet } = feature;
  useIllustrationMotion(figure, {
    feature: feature.id,
    keyboard,
    reduced,
    inView,
    hidden,
    paused: paused || leaving,
  });

  useLayoutEffect(() => {
    const node = figure.current;
    if (
      !entrance ||
      !node ||
      !inView ||
      hidden ||
      typeof node.animate !== "function"
    )
      return;
    arrival.current = node.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateY(16px)" },
            { opacity: 1, transform: "none" },
          ],
      { duration: reduced ? REDUCED_MS : ENTER_MS, easing: ENTRANCE },
    );
    return () => arrival.current?.cancel();
    // The arrival belongs to the moment the sheet appears, not to later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!leaving) return;
    const node = figure.current;
    if (!node || typeof node.animate !== "function") {
      onGone(run);
      return;
    }
    // Leave from wherever the arrival had got to, so a quick second choice never snaps.
    const { opacity, transform } = getComputedStyle(node);
    arrival.current?.cancel();
    const exit = node.animate(
      [
        { opacity, transform },
        { opacity: 0, transform: reduced ? transform : "translateY(12px)" },
      ],
      {
        duration: reduced ? REDUCED_MS : EXIT_MS,
        easing: ENTRANCE,
        fill: "forwards",
      },
    );
    const gone = () => onGone(run);
    exit.finished.then(gone, gone);
    return () => exit.cancel();
  }, [leaving, reduced, onGone, run]);

  return (
    <div
      ref={figure}
      className={`lp-stage-figure lp-stage-figure-${feature.size}${
        leaving ? " lp-stage-figure-leaving" : ""
      }`}
    >
      <div className={`lp-stage-art lp-stage-art-${feature.size}`}>
        <Sheet />
      </div>
    </div>
  );
}
