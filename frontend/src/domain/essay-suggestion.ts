/*
 * One pending tracked change on an essay — the parsed form of a row in the
 * server's `essays.suggestions` jsonb array.
 *
 * TWO TEXT SPACES, and mixing them is the bug this type exists to prevent.
 *
 *  - `oldText`/`newText` are MARKDOWN: the agent's own vocabulary, and the
 *    only form the server ever applies (`apply_edits`). The client never
 *    searches, trims, or paints with them.
 *  - `oldTextPlain`/`newTextPlain` are the same spans with markdown syntax
 *    stripped. The live ProseMirror document carries formatting as marks, so
 *    it contains no `**` to match — searching it for `"I love **pizza**."`
 *    finds nothing, and every suggestion touching a bold, italic, list,
 *    heading or blockquote span would go stale the instant it was created.
 *    Everything client-side — anchoring, the diff trim, the preview a student
 *    reads — uses the `_plain` pair, exclusively.
 *
 * Neither `kind` nor a `status` is persisted. A resolved suggestion is removed
 * from the array, so every row that exists is pending; `kind` follows from an
 * empty replacement text; and stale is a *derived* state computed against the
 * live document (see `ResolvedSuggestion` in the decoration plugin), never
 * something the server hands us.
 */

/**
 * There is no `"insertion"`: the server cannot store one. `apply_edits`
 * rejects an empty `old_text` as ambiguous on any non-empty essay, and suggest
 * mode never runs on an empty one — so "add a sentence here" always arrives as
 * a replacement whose new text extends a short, non-empty anchor, and renders
 * as a pure insertion through the diff trim rather than through its `kind`.
 */
export type SuggestionKind = "deletion" | "replacement";

export type EssaySuggestion = {
  createdAt: string;
  id: string;
  kind: SuggestionKind;
  /** MARKDOWN space. Carried for completeness; never anchored or painted. */
  newText: string;
  /** PLAIN document-text space. What gets painted as the proposed insertion. */
  newTextPlain: string;
  /** MARKDOWN space. Carried for completeness; never anchored or painted. */
  oldText: string;
  /** PLAIN document-text space. The anchor. Never empty. */
  oldTextPlain: string;
  /** The one-line "why", shown in the hover popover. */
  rationale: string;
};

function textOrEmpty(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function essaySuggestionFromApi(raw: unknown): EssaySuggestion | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = textOrEmpty(raw.id);
  const oldTextPlain = textOrEmpty(raw.old_text_plain);
  // Without an id there is nothing to accept against, and without a non-empty
  // plain anchor there is nothing to find in the document. Either way the row
  // is unusable — drop it rather than render a change we could never resolve.
  if (!id || !oldTextPlain) {
    return null;
  }

  const newTextPlain = textOrEmpty(raw.new_text_plain);

  return {
    createdAt: textOrEmpty(raw.created_at),
    id,
    // Derived from the field the client actually paints with, so the rendered
    // shape can never disagree with the declared kind.
    kind: newTextPlain === "" ? "deletion" : "replacement",
    newText: textOrEmpty(raw.new_text),
    newTextPlain,
    oldText: textOrEmpty(raw.old_text),
    oldTextPlain,
    rationale: textOrEmpty(raw.rationale),
  };
}

/** Parse the wire array, dropping malformed entries rather than throwing. */
export function essaySuggestionsFromApi(value: unknown): EssaySuggestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: EssaySuggestion[] = [];
  for (const raw of value) {
    const suggestion = essaySuggestionFromApi(raw);
    if (suggestion) {
      parsed.push(suggestion);
    }
  }
  return parsed;
}
