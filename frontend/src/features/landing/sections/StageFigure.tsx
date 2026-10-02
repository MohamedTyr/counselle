import { useLayoutEffect, useRef, type RefObject } from "react";
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

type Arrival = RefObject<Animation | undefined>;

/** A replacing sheet rises in, once, as it appears. */
function useArrival(
  figure: RefObject<HTMLDivElement | null>,
  arrivalRef: Arrival,
  {
    entrance,
    inView,
    hidden,
    reduced,
  }: Pick<StageFigureProps, "entrance" | "inView" | "hidden" | "reduced">,
) {
  useLayoutEffect(() => {
    const node = figure.current;
    if (!entrance || !node || !inView || hidden) return;
    if (typeof node.animate !== "function") return;
    arrivalRef.current = node.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateY(16px)" },
            { opacity: 1, transform: "none" },
          ],
      { duration: reduced ? REDUCED_MS : ENTER_MS, easing: ENTRANCE },
    );
    return () => arrivalRef.current?.cancel();
    // The arrival belongs to the moment the sheet appears, not to later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** A replaced sheet sinks away, then asks to be removed. */
function useExit(
  figure: RefObject<HTMLDivElement | null>,
  arrivalRef: Arrival,
  {
    leaving,
    reduced,
    run,
    onGone,
  }: Pick<StageFigureProps, "leaving" | "reduced" | "run" | "onGone">,
) {
  useLayoutEffect(() => {
    if (!leaving) return;
    const node = figure.current;
    if (!node || typeof node.animate !== "function") {
      onGone(run);
      return;
    }
    // Leave from wherever the arrival had got to, so a quick second choice never snaps.
    const { opacity, transform } = getComputedStyle(node);
    arrivalRef.current?.cancel();
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
  }, [figure, arrivalRef, leaving, reduced, onGone, run]);
}

/** One sheet on the stage: it arrives, demonstrates its feature, and leaves. */
export function StageFigure(props: StageFigureProps) {
  const { feature, entrance, leaving, keyboard, reduced, inView, hidden } =
    props;
  const figure = useRef<HTMLDivElement>(null);
  const arrival = useRef<Animation | undefined>(undefined);
  const { Sheet } = feature;
  useIllustrationMotion(figure, {
    feature: feature.id,
    keyboard,
    reduced,
    inView,
    hidden,
    paused: props.paused || leaving,
  });
  useArrival(figure, arrival, { entrance, inView, hidden, reduced });
  useExit(figure, arrival, props);

  return (
    <div
      ref={figure}
      className={`lp-stage-figure lp-stage-figure-${feature.size}${
        leaving ? " lp-stage-figure-leaving" : ""
      }`}
      data-nosnippet
    >
      <div className={`lp-stage-art lp-stage-art-${feature.size}`}>
        <Sheet />
      </div>
    </div>
  );
}
