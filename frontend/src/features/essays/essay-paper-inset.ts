/*
 * The editor paper's horizontal inset, and the pending-changes bar's.
 *
 * Stepped by the *scroll column's* own width (`@container/essay-canvas`, set
 * in `EssayEditorRoute`), never by the viewport. Viewport steps were the bug:
 * `lg:px-16` keyed off a 1024px window, so opening the 380px chat panel left a
 * 276px sheet of paper still paying 64px of margin on each side and a measure
 * of eighteen characters. The container knows how much room the paper actually
 * has; the viewport does not.
 *
 * Both surfaces share it because they are one column — the bar annotates the
 * prose directly under it, and a label that starts 60px left of the sentence
 * it describes reads as a different column entirely.
 */
export const essayPaperInsetClass =
  "px-7 @xl/essay-canvas:px-10 @2xl/essay-canvas:px-12 @4xl/essay-canvas:px-16";
