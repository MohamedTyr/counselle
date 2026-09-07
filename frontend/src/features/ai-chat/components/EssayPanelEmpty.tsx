import { ESSAY_QUICK_ACTIONS } from "@/features/essays/essay-quick-actions";

/*
 * The first thing a student sees in the essay panel, and by a wide margin the
 * state it spends the most time in.
 *
 * The generic "No messages yet / Ask a question to start this conversation"
 * says nothing about essays and nothing about what this panel can do, which
 * next to a half-written personal statement is 570px of blank column asking
 * the student to guess. The three openers are the ones from the spec's
 * selection-scoped verb row: they are what a student wants done to a sentence
 * they have just highlighted, and they read as offers rather than advice.
 *
 * Anchored to the composer, not floated in the middle. These openers are things
 * the student is about to *type*, so they belong directly above the box they
 * would be typed into; centring them left a measured 339px hole between the
 * last opener and the composer, which read as a broken layout rather than as an
 * unstarted conversation. Empty room ABOVE a conversation is what every chat
 * looks like before its first message; empty room between the content and its
 * own input is not.
 *
 * No decorative glyph, and the openers are a stacked list rather than a row of
 * pills. Three same-shaped, same-width outline pills give the eye nothing to
 * sort them by, and they are not three flavours of one thing — they are three
 * different kinds of ask. So each one leads with the ask and follows with what
 * it actually does, which is also what makes the block fill the column
 * honestly instead of being padded out to fill it.
 */

type EssayPanelEmptyProps = {
  /** The student has text highlighted, so the openers act on that text. */
  hasSelection: boolean;
  onStart: (text: string) => void;
};

export function EssayPanelEmpty({
  hasSelection,
  onStart,
}: EssayPanelEmptyProps) {
  return (
    <div className="flex size-full flex-col justify-end gap-4 px-5 pt-8 pb-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">
          Let&rsquo;s work on this essay.
        </h2>
        <p className="text-sm text-muted-foreground">
          {hasSelection
            ? "Ask about the text you highlighted, or anything else in this draft."
            : "Ask Counselle to draft, revise, tighten, or check anything in this draft."}
        </p>
      </div>
      <ul className="flex flex-col gap-0.5">
        {ESSAY_QUICK_ACTIONS.map(({ gloss, prompt }) => (
          <li key={prompt}>
            {/* The editor's own row-button vocabulary (`SuggestionsBar`): a
             * colour-only hover at 150ms, never a transform (§11.1). */}
            <button
              className="-mx-1.5 flex w-[calc(100%+0.75rem)] cursor-pointer flex-col items-start gap-0.5 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none motion-reduce:transition-none"
              onClick={() => onStart(prompt)}
              type="button"
            >
              <span className="font-medium text-foreground">{prompt}</span>
              <span className="text-muted-foreground">{gloss}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
