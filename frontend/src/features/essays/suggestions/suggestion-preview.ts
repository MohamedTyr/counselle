import type { EssaySuggestion } from "@/domain/essay-suggestion";
import { diffSuggestionText } from "@/features/essays/suggestions/suggestionDiff";

/*
 * What a change reads as, in one line.
 *
 * Built from the same prefix/suffix trim that paints the document, never from
 * the raw stored text: for the common "one clause changed inside a sentence"
 * case, the raw fields are two long, near-identical sentences, which makes
 * every change look far bigger in a list than it looks underlined in the
 * essay. The trim leaves only what genuinely differs — the same words the
 * decoration strikes and underlines.
 *
 * PLAIN space only. A student must never be shown raw markdown syntax (`**`,
 * `_`, `> `) in a preview of their own writing.
 */

export type SuggestionPreview = {
  /**
   * Where in the essay the change sits, quoted from the student's own text.
   * Empty unless `text` is too short to find on its own — see below.
   */
  context: string;
  /** "Insert", "Delete", or "Replace" — derived from the trim, not `kind`. */
  verb: string;
  text: string;
};

/**
 * Under this, the trimmed text is not a description of anything. `Replace , →
 * ;` says a semicolon belongs somewhere in a 650-word essay and nothing else,
 * so at that length the surrounding words come along as well.
 */
const SHORT_TEXT_CHARS = 12;

/** Long enough to place the change in a sentence, short enough to stay inline. */
const CONTEXT_CHARS = 52;

function truncate(value: string, maxChars: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > maxChars
    ? `${collapsed.slice(0, maxChars).trimEnd()}…`
    : collapsed;
}

/**
 * A window of `oldTextPlain` centred on where the change lands, so a
 * one-character edit still says which sentence it is in.
 */
function contextAround(source: string, centre: number, maxChars: number) {
  const collapsed = source.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }

  const end = Math.min(
    collapsed.length,
    Math.max(maxChars, centre + Math.floor(maxChars / 2)),
  );
  const start = end - maxChars;
  const head = start > 0 ? "…" : "";
  const tail = end < collapsed.length ? "…" : "";
  return `${head}${collapsed.slice(start, end).trim()}${tail}`;
}

export function suggestionPreview(
  suggestion: EssaySuggestion,
  maxChars: number,
): SuggestionPreview {
  const diff = diffSuggestionText(
    suggestion.oldTextPlain,
    suggestion.newTextPlain,
  );

  const withContext = (verb: string, text: string): SuggestionPreview => ({
    context:
      text.length < SHORT_TEXT_CHARS
        ? contextAround(
            suggestion.oldTextPlain,
            diff.prefixLength,
            CONTEXT_CHARS,
          )
        : "",
    text,
    verb,
  });

  if (diff.shape === "insertion") {
    return withContext("Insert", truncate(diff.newMiddle, maxChars));
  }
  if (diff.shape === "deletion") {
    return withContext("Delete", truncate(diff.oldMiddle, maxChars));
  }

  /* Both sides, split evenly, so a long replacement does not spend its whole
   * budget on the old text and truncate the proposal away entirely. */
  const half = Math.max(8, Math.floor((maxChars - 3) / 2));
  return withContext(
    "Replace",
    `${truncate(diff.oldMiddle, half)} → ${truncate(diff.newMiddle, half)}`,
  );
}

/**
 * One string naming the whole change, for an accessible name. Quoted, because
 * the shortest changes are punctuation: `Insert , , in …` is not a sentence.
 */
export function suggestionPreviewLabel(preview: SuggestionPreview): string {
  return preview.context === ""
    ? `${preview.verb} “${preview.text}”`
    : `${preview.verb} “${preview.text}” in “${preview.context}”`;
}
