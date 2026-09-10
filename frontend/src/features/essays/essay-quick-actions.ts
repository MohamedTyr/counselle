/*
 * The three things the essay panel offers to do to a student's own sentence.
 *
 * One list, two surfaces, because they are one set of asks: the empty panel
 * offers them as openers before there is any conversation, and the composer
 * offers them again as chips whenever the student has text selected. Two lists
 * would drift the moment either was reworded — and the wording is the whole
 * content of an offer.
 *
 * `prompt` is what is sent, written as the student would have typed it, because
 * that is exactly what it becomes: a message in their own transcript. `label`
 * is the compact form for a chip beside an attached selection, where the
 * selection chip directly above it already says what "this" refers to.
 */
export type EssayQuickAction = {
  /** What the ask actually does, for surfaces with room for a line of it. */
  gloss: string;
  /** The compact chip form. */
  label: string;
  /** The message sent on the student's behalf. */
  prompt: string;
};

export const ESSAY_QUICK_ACTIONS: readonly EssayQuickAction[] = [
  {
    gloss: "swap a general claim for the detail behind it",
    label: "Make specific",
    prompt: "Make this more specific",
  },
  {
    gloss: "cut words without losing the meaning",
    label: "Tighten",
    prompt: "Tighten this",
  },
  {
    gloss: "turn the conclusion back into the scene it came from",
    label: "Show, don't tell",
    prompt: "Show, don't tell",
  },
];
