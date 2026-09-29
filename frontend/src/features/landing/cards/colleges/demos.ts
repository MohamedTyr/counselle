import type { Sequence } from "../../useIllustrationMotion";
import { ARRIVAL_MS, FADE, RISE, STAMP } from "../../motion";

const POP: Keyframe[] = [
  { opacity: 0, transform: "scale(0.6)" },
  { opacity: 1, transform: "scale(1)" },
];
const stamp = { easing: STAMP };

/** A request with a story, the work shown, an answer that uses it, then the list is saved. */
export function playAsk(seq: Sequence) {
  seq.play(".lp-cx-ask-user span", RISE, 320);
  seq.play(".lp-cx-ask-step", FADE, 300, ARRIVAL_MS + 450);
  seq.play(
    ".lp-cx-ask-step span",
    [{ opacity: 0.4 }, { opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }],
    900,
    ARRIVAL_MS + 450,
    0,
    { easing: "ease-in-out" },
  );
  seq.play(".lp-cx-ask-step-done", POP, 360, ARRIVAL_MS + 1350, 0, stamp);
  seq.stream(".lp-cx-ask-text", ARRIVAL_MS + 1500);
  const list = ARRIVAL_MS + 2000;
  seq.play(".lp-cx-ask-saved", FADE, 300, list);
  seq.play(".lp-cx-ask-row", RISE, 340, list + 80, 90);
}
