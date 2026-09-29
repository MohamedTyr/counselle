import type { Sequence } from "../../useIllustrationMotion";
import { ARRIVAL_MS, FADE, MORPH, RISE, STAMP } from "../../motion";

const POP: Keyframe[] = [
  { opacity: 0, transform: "scale(0.6)" },
  { opacity: 1, transform: "scale(1)" },
];
const stamp = { easing: STAMP };

/** Where a node sits inside the sheet, in the sheet's own unzoomed pixels. */
function offsetIn(node: HTMLElement, sheet: HTMLElement) {
  let x = 0;
  let y = 0;
  for (let at: HTMLElement | null = node; at && at !== sheet;) {
    x += at.offsetLeft;
    y += at.offsetTop;
    at = at.offsetParent as HTMLElement | null;
  }
  return { x: x + node.offsetWidth / 2, y: y + node.offsetHeight / 2 };
}

/** The profile appears, then each school is dealt from it into its column. */
export function playColumns(seq: Sequence) {
  const sheet = seq.root.querySelector<HTMLElement>(".lp-cx-cols");
  const strip = seq.root.querySelector<HTMLElement>(".lp-cx-cols-strip");
  if (!sheet || !strip) return;
  seq.play(".lp-cx-chip, .lp-cx-cols-total", RISE, 320, ARRIVAL_MS, 70);
  seq.play(".lp-cx-col", FADE, 360, ARRIVAL_MS + 200, 70);
  const origin = { x: sheet.offsetWidth / 2, y: strip.offsetHeight };
  const deal = ARRIVAL_MS + 600;
  const landed = new Map<Element, number>();
  seq.root.querySelectorAll<HTMLElement>(".lp-cx-card").forEach((card) => {
    const order = Number(card.dataset.deal);
    const { x, y } = offsetIn(card, sheet);
    const delay = deal + order * 170;
    seq.push(
      card,
      [
        {
          opacity: 0,
          transform: `translate(${origin.x - x}px, ${origin.y - y}px) scale(0.7)`,
        },
        { opacity: 1, offset: 0.3 },
        { opacity: 1, transform: "none" },
      ],
      { duration: 700, delay, easing: MORPH, fill: "both" },
    );
    const column = card.closest(".lp-cx-col")!;
    landed.set(column, Math.max(landed.get(column) ?? 0, delay + 620));
  });
  landed.forEach((at, column) =>
    seq.push(column.querySelector(".lp-cx-col-count")!, POP, {
      duration: 360,
      delay: at,
      easing: STAMP,
      fill: "both",
    }),
  );
}

/** Checks resolve out of a blur, the way an icon should arrive. */
const RESOLVE: Keyframe[] = [
  { opacity: 0, transform: "scale(0.25)", filter: "blur(4px)" },
  { opacity: 1, transform: "scale(1)", filter: "blur(0px)" },
];

/** The selection glides to one school, it opens, and each meter fills to a verdict. */
export function playWhy(seq: Sequence) {
  const sheet = seq.root.querySelector<HTMLElement>(".lp-cx-why");
  const first = seq.root.querySelector<HTMLElement>(".lp-cx-why-row");
  const chosen = seq.root.querySelector<HTMLElement>(
    ".lp-cx-why-row[data-chosen]",
  );
  const cursor = chosen?.querySelector(".lp-cx-why-cursor");
  seq.play(".lp-cx-why-tier", FADE, 300, ARRIVAL_MS, 90);
  seq.play(".lp-cx-why-row", RISE, 320, ARRIVAL_MS + 40, 50);
  if (sheet && first && chosen && cursor) {
    const lift = offsetIn(first, sheet).y - offsetIn(chosen, sheet).y;
    const start = `translateY(${lift}px)`;
    seq.push(
      cursor,
      [
        { opacity: 0, transform: start },
        { opacity: 1, transform: start, offset: 0.25 },
        { opacity: 1, transform: start, offset: 0.4 },
        { opacity: 1, transform: "none" },
      ],
      { duration: 1100, delay: ARRIVAL_MS + 300, easing: MORPH, fill: "both" },
    );
  }
  const open = ARRIVAL_MS + 1250;
  seq.play(
    ".lp-cx-why-row[data-chosen] b",
    [{ color: "#5c6562" }, { color: "#121214" }],
    240,
    open - 150,
  );
  seq.play(".lp-cx-why-school", RISE, 380, open);
  seq.play(".lp-cx-fit-label", FADE, 300, open + 100, 120);
  seq.play(".lp-cx-curve-axis, .lp-cx-curve-tick", FADE, 400, open + 150);
  seq.play(
    ".lp-cx-curve-line",
    [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
    1000,
    open + 200,
    0,
    { easing: MORPH },
  );
  seq.play(".lp-cx-curve-area", FADE, 600, open + 500);
  seq.play(".lp-cx-curve-band", FADE, 400, open + 950);
  seq.play(
    ".lp-cx-curve-you",
    [
      { opacity: 0, transform: "translateY(-10px)" },
      { opacity: 1, transform: "none" },
    ],
    460,
    open + 1150,
  );
  seq.play(".lp-cx-cost b, .lp-cx-rank", RISE, 340, open + 450, 120);
  seq.play(
    ".lp-cx-cost-bar span",
    [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
    700,
    open + 600,
    0,
    { easing: MORPH },
  );
  seq.play(".lp-cx-cost .lp-cx-muted", FADE, 300, open + 900);
  seq.play(".lp-cx-rank b", POP, 420, open + 700, 0, stamp);
  seq.play(".lp-cx-fit-check", RESOLVE, 320, open + 1400, 140, {
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  });
}

/** Every school checked lands as a dot, the fit line draws, and the five that clear it drop in. */
export function playMap(seq: Sequence) {
  seq.play(".lp-cx-map-title, .lp-cx-map-field", RISE, 320, ARRIVAL_MS, 60);
  seq.play(".lp-cx-map-zone, .lp-cx-map-step", FADE, 400, ARRIVAL_MS + 100, 70);
  seq.play(".lp-cx-map-dot", POP, 260, ARRIVAL_MS + 300, 9);
  const line = ARRIVAL_MS + 900;
  seq.play(
    ".lp-cx-map-line",
    [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
    600,
    line,
    0,
    { easing: MORPH },
  );
  seq.play(".lp-cx-map-line b", POP, 320, line + 500, 0, stamp);
  const drop = line + 700;
  seq.play(
    ".lp-cx-map-pin .lp-cx-logo",
    [
      { opacity: 0, transform: "translateY(14px) scale(0.6)" },
      { opacity: 1, transform: "none" },
    ],
    520,
    drop,
    110,
    stamp,
  );
  seq.play(".lp-cx-map-count", FADE, 320, drop + 500);
  seq.play(
    ".lp-cx-map-label",
    [
      { opacity: 0, transform: "translate(-6px, 50%)" },
      { opacity: 1, transform: "translate(0, 50%)" },
    ],
    380,
    drop + 800,
  );
}

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
