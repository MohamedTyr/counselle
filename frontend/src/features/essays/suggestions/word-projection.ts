import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useEditorState } from "@tiptap/react";

import { countWords } from "@/features/essays/essay-content";
import { SuggestionPluginKey } from "@/features/essays/suggestions/suggestionExtension";

/*
 * "· N if you accept all" — what the word count would become.
 *
 * A student cutting to a word limit is the case this whole panel exists for, so
 * the second number has to be the number, not an estimate. Two things make the
 * obvious arithmetic wrong, and both are why this rebuilds the text rather than
 * summing per-change deltas:
 *
 *  1. ACCEPTING IS CUMULATIVE. `resolve_all_suggestions` applies each change to
 *     the result of the last one, so per-change numbers are only additive while
 *     the changes are disjoint — and a change that overlaps one already applied
 *     no longer matches, so the server SKIPS it. A sum would count an edit that
 *     never lands.
 *  2. WORDS ARE NOT OWNED BY THE SPAN THAT CHANGES. `countWords` counts runs of
 *     non-whitespace, so a change is free to merge or split words at its own
 *     edges: deleting the single space in "a b" removes a word while removing
 *     none of its own, and inserting "x" inside "wo|rd" adds a word to the text
 *     while being a whole word itself. Only the surrounding characters can say.
 *
 * So this builds the text the student would be left with, in the same string
 * space the header already counts, and counts it. Where it cannot be sure of
 * that text — a change spanning a paragraph break, two overlapping anchors, an
 * anchor it cannot re-find, or a reading of the document that disagrees with
 * the count already on screen — it returns nothing and the header says only
 * what it knows. Silence is the cheap failure here; a wrong number in a
 * student's word budget is not.
 */

/** One pending change, as a replacement in the flat document string. */
type FlatEdit = { end: number; start: number; text: string };

/**
 * The document as one flat string plus the offsets where two blocks meet.
 *
 * The flat string is the space suggestions are anchored in — `documentText`'s
 * empty block separator, pinned there because it is the space the server built
 * `old_text_plain` in. The word count on screen is NOT in that space: joining
 * paragraphs with nothing glues the last word of one to the first of the next.
 * So the break offsets are carried alongside, and put back as whitespace before
 * anything is counted.
 */
type FlatDocument = { breaks: readonly number[]; text: string };

/**
 * Mirrors ProseMirror's own `Fragment.textBetween` — the separator lands on a
 * textblock after the first one, and nowhere else — so `withBlockBreaks` below
 * counts the same words `editor.getText()` does. That equivalence is what the
 * whole file rests on, and the tests assert it directly.
 */
function flattenDocument(doc: ProseMirrorNode): FlatDocument {
  const breaks: number[] = [];
  let text = "";
  let first = true;

  doc.nodesBetween(0, doc.content.size, (node) => {
    if (node.isTextblock) {
      if (first) {
        first = false;
      } else {
        breaks.push(text.length);
      }
    }
    if (node.isText) {
      text += node.text ?? "";
    }
    return true;
  });

  return { breaks, text };
}

/** The flat string with every block break put back as whitespace. */
function withBlockBreaks({ breaks, text }: FlatDocument): string {
  let out = "";
  let cursor = 0;

  for (const offset of breaks) {
    out += `${text.slice(cursor, offset)}\n`;
    cursor = offset;
  }

  return out + text.slice(cursor);
}

/** How far a flat offset moves once the block breaks are put back. */
function shiftFor(breaks: readonly number[], offset: number): number {
  return breaks.filter((each) => each <= offset).length;
}

export type AcceptAllProjection = {
  /** This module's own reading of the count on screen, for the caller to check. */
  current: number;
  /** What the count becomes when every applicable change is accepted. */
  projected: number;
};

/**
 * Both counts, or `null` when the projected text is not knowable.
 *
 * Exported for the tests; the hook below is what the header uses.
 */
export function projectAcceptAll(editor: Editor): AcceptAllProjection | null {
  const plugin = SuggestionPluginKey.getState(editor.state);
  if (!plugin) {
    return null;
  }

  const { doc } = editor.state;
  const flat = flattenDocument(doc);
  const edits: FlatEdit[] = [];

  for (const entry of plugin.resolved) {
    /* Stale changes cannot be applied, so accepting all does not apply them —
     * the same split `countPendingChanges` states, read from the same place. */
    if (entry.stale || entry.from === null) {
      continue;
    }

    const anchor = entry.suggestion.oldTextPlain;
    const start = doc.textBetween(0, entry.from, "").length;
    const end = start + anchor.length;

    /* The plugin found this text at this position. If this file cannot see it
     * there too, the two are reading the document differently and neither
     * number can be trusted over the other. */
    if (flat.text.slice(start, end) !== anchor) {
      return null;
    }

    /* A change that swallows a paragraph break rewrites the block structure,
     * and what the server's markdown apply leaves behind is not something this
     * can predict from the plain text alone. */
    if (flat.breaks.some((offset) => offset > start && offset < end)) {
      return null;
    }

    edits.push({ end, start, text: entry.suggestion.newTextPlain });
  }

  if (edits.length === 0) {
    return null;
  }

  edits.sort((a, b) => a.start - b.start);
  for (let index = 1; index < edits.length; index += 1) {
    /* Overlapping anchors: applied in order, the second no longer matches its
     * own text and the server reports it skipped. Which one survives depends on
     * the order the agent happened to emit them in. */
    if (edits[index].start < edits[index - 1].end) {
      return null;
    }
  }

  const current = withBlockBreaks(flat);
  let projected = current;

  /* Last edit first, so the earlier offsets are still the offsets. */
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const { end, start, text } = edits[index];
    const shift = shiftFor(flat.breaks, start);
    projected =
      projected.slice(0, start + shift) + text + projected.slice(end + shift);
  }

  return { current: countWords(current), projected: countWords(projected) };
}

/**
 * The projected word count for the header, or `null` to say nothing.
 *
 * `currentWordCount` is the number already on screen. It is passed in as a
 * check, not as a base: this module counts the document itself, and if its own
 * reading disagrees with what the header is showing then one of them is wrong
 * and there is no way to tell which — so the header stays as it is. Equal
 * counts are `null` too, because "· 648 if you accept all" beside 648 is noise
 * standing where a real signal is supposed to be.
 */
export function useAcceptAllWordCount(
  editor: Editor | null,
  currentWordCount: number,
): number | null {
  const projection = useEditorState({
    editor,
    selector: ({ editor: current }): AcceptAllProjection | null =>
      current ? projectAcceptAll(current) : null,
  });

  if (!projection || projection.current !== currentWordCount) {
    return null;
  }

  return projection.projected === currentWordCount ? null : projection.projected;
}
