/** The landing page's motion vocabulary; DESIGN.md §12 owns the values. */
export const ENTRANCE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** A stamp: overshoots once, like a sticker pressed onto the page. */
export const STAMP = "cubic-bezier(0.34, 1.56, 0.64, 1)";
/** A morph: one state becomes another, no snap at either end. */
export const MORPH = "cubic-bezier(0.65, 0, 0.35, 1)";
/** The sheet has risen into the stage before its demonstration starts. */
export const ARRIVAL_MS = 550;
export const FADE: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
export const RISE: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "translateY(0)" },
];

export function canAnimate(): boolean {
  return typeof Element.prototype.animate === "function" && !document.hidden;
}
