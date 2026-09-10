import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import type { EssaySuggestion } from "@/domain/essay-suggestion";
import { diffSuggestionText } from "@/features/essays/suggestions/suggestionDiff";

/*
 * Tracked changes, painted as ProseMirror decorations.
 *
 * A suggestion is anchored by SEARCHING THE DOCUMENT for its plain text, never
 * by a stored position: the document round-trips through the server as Tiptap
 * JSON, and an absolute offset would drift the first time the schema
 * serialised differently than the live doc.
 *
 * Anchoring is honest about failure. Zero matches or more than one match is
 * stale — there is no stored context to disambiguate with, and guessing which
 * of two identical sentences the agent meant is exactly the kind of quiet
 * mistake that would apply an edit to the wrong words.
 */

/** How this suggestion currently sits against the live document. */
export type ResolvedSuggestion = {
  /** Document position of the anchor's start, or null when unanchored. */
  from: number | null;
  /**
   * Derived, never persisted: the anchor no longer matches the document, so
   * the change is inert. Kept in the list rather than dropped, so a student
   * sees what was proposed instead of watching it vanish.
   */
  stale: boolean;
  suggestion: EssaySuggestion;
  /** Document position of the anchor's end, or null when unanchored. */
  to: number | null;
};

export type SuggestionPluginState = {
  decorations: DecorationSet;
  /** Which suggestion the pointer is over, if any. See `hoverHandlers`. */
  hoveredId: string | null;
  resolved: ResolvedSuggestion[];
};

/**
 * The "the suggestion list itself changed" signal. A transaction carrying this
 * recomputes every anchor from scratch; see `apply` for why that ordering is
 * load-bearing. Payload is the PARSED list, not the raw wire array.
 */
export type SuggestionsChangedMeta = {
  suggestions: EssaySuggestion[];
};

/** The "the pointer moved onto or off a change" signal. Anchors are untouched. */
export type SuggestionHoverMeta = {
  hoveredId: string | null;
};

type SuggestionMeta = SuggestionsChangedMeta | SuggestionHoverMeta;

export const SuggestionPluginKey = new PluginKey<SuggestionPluginState>(
  "essaySuggestions",
);

/*
 * THE ONE STRING SPACE. The server builds `oldTextPlain`/`newTextPlain` by
 * joining blocks with no separator at all, which is exactly ProseMirror's own
 * `Node.textContent` (defined as `textBetween(0, size, "")`). Passing any other
 * block separator here — `"\n"`, `"\n\n"` — would search the document for a
 * string shaped differently from the one the server actually produced, and
 * every suggestion spanning a paragraph boundary would silently never match.
 * The empty separator is pinned, not a preference.
 */
const BLOCK_SEPARATOR = "";

export function documentText(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, BLOCK_SEPARATOR);
}

function rangeText(doc: ProseMirrorNode, from: number, to: number): string {
  return doc.textBetween(from, to, BLOCK_SEPARATOR);
}

/*
 * Character offset within a range -> document position.
 *
 * Because the separator is the empty string, characters and text nodes line up
 * one to one and only the non-text gaps between blocks have to be skipped —
 * which is what walking the nodes does for free.
 *
 * `side` matters at a block boundary, where one character offset sits at both
 * the end of one paragraph and the start of the next. A range's start wants the
 * later position, its end the earlier one, or a decoration would leak a
 * paragraph in the wrong direction.
 */
function positionAtTextOffset(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  offset: number,
  side: "end" | "start",
): number {
  let seen = 0;
  // Clamped at both ends for an offset the range cannot hold.
  let position = offset <= 0 ? from : to;
  let found = false;

  doc.nodesBetween(from, to, (node, pos) => {
    if (found || !node.isText || !node.text) {
      return true;
    }

    const start = Math.max(from, pos);
    const length = Math.min(to, pos + node.nodeSize) - start;
    const reached =
      side === "start" ? offset < seen + length : offset <= seen + length;
    if (reached) {
      position = start + (offset - seen);
      found = true;
      return false;
    }

    seen += length;
    return true;
  });

  return position;
}

function staleResolution(
  suggestion: EssaySuggestion,
  from: number | null = null,
  to: number | null = null,
): ResolvedSuggestion {
  return { from, stale: true, suggestion, to };
}

function resolveSuggestion(
  doc: ProseMirrorNode,
  text: string,
  suggestion: EssaySuggestion,
): ResolvedSuggestion {
  const anchor = suggestion.oldTextPlain;
  const first = text.indexOf(anchor);
  // Absent, or ambiguous: either way we cannot say where this belongs.
  if (first === -1 || text.indexOf(anchor, first + 1) !== -1) {
    return staleResolution(suggestion);
  }

  const size = doc.content.size;
  return {
    from: positionAtTextOffset(doc, 0, size, first, "start"),
    stale: false,
    suggestion,
    to: positionAtTextOffset(doc, 0, size, first + anchor.length, "end"),
  };
}

function resolveSuggestions(
  doc: ProseMirrorNode,
  suggestions: EssaySuggestion[],
): ResolvedSuggestion[] {
  const text = documentText(doc);
  return suggestions.map((suggestion) =>
    resolveSuggestion(doc, text, suggestion),
  );
}

/*
 * Follow anchors through an ordinary edit.
 *
 * Mapping tracks POSITIONS; it knows nothing about the text those positions
 * surround. So every mapped range is re-read and compared against its anchor:
 * an edit inside the range leaves the position perfectly trackable while the
 * words underneath it have changed, and that suggestion is stale even though
 * nothing looks broken. Bias is inward on both ends (`1` at the start, `-1` at
 * the end) so text typed immediately either side of a change lands outside it
 * and leaves it alone.
 */
function remapSuggestions(
  tr: Transaction,
  doc: ProseMirrorNode,
  previous: ResolvedSuggestion[],
): ResolvedSuggestion[] {
  return previous.map((resolved) => {
    if (resolved.from === null || resolved.to === null) {
      return resolved;
    }

    const from = tr.mapping.map(resolved.from, 1);
    const to = tr.mapping.map(resolved.to, -1);
    if (
      from > to ||
      rangeText(doc, from, to) !== resolved.suggestion.oldTextPlain
    ) {
      return staleResolution(resolved.suggestion, from, Math.max(from, to));
    }

    return { from, stale: false, suggestion: resolved.suggestion, to };
  });
}

/** The sighted mouse channel for a stale change; the dotted line's tooltip. */
const STALE_LABEL =
  "Outdated suggestion: your text changed since this was suggested.";

/*
 * WHAT A SCREEN READER HEARS WHERE A SIGHTED STUDENT SEES A COLOURED LINE.
 *
 * NVDA and JAWS announce neither <ins> nor <del> at default verbosity, so
 * without something extra a screen reader reads a proposed deletion as ordinary
 * prose and never says an edit is pending — the student is read a document that
 * is neither their essay nor the agent's version of it.
 *
 * `aria-label` CANNOT DO THIS JOB, which is what these decorations used to try.
 * <del>, <ins> and a bare <span> map to the `deletion`, `insertion` and
 * `generic` roles, and all three PROHIBIT an accessible name (ARIA 1.2), so the
 * browser drops the attribute outright — verified in Chrome's own accessibility
 * tree, where a labelled <del> exposes its text and no name at all. Text
 * content is not prohibited, so the marker has to BE text.
 *
 * Hence a visually-hidden widget on each side of the range. Bracketing rather
 * than prefixing, because a prefix alone leaves a pure deletion with no closing
 * boundary and the words inside are the student's own sentence resuming. The
 * markers are inert, carry no `data-suggestion-id` (`SuggestionPopover.place`
 * measures its anchor from those, and a clipped 1px span would skew the union),
 * and being decorations they never enter the document.
 */
const SR_MARKERS = {
  delete: ["Suggested deletion: ", ". End of suggested deletion. "],
  insert: ["Suggested insertion: ", ". End of suggested insertion. "],
  stale: [
    "Outdated suggestion, no longer applies: ",
    ". End of outdated suggestion. ",
  ],
} as const;

function srMarker(text: string) {
  return () => {
    const element = document.createElement("span");
    element.className = "sr-only";
    element.contentEditable = "false";
    element.textContent = text;
    return element;
  };
}

/** Bracket an inline decoration's range with its screen-reader markers. */
function bracket(
  decorations: Decoration[],
  from: number,
  to: number,
  [open, close]: readonly [string, string],
) {
  decorations.push(
    Decoration.widget(from, srMarker(open), { marks: [], side: -1 }),
    /* `side: 0` keeps this ahead of the insertion widget a replacement puts at
     * the same position with `side: 1`, so the two changes never interleave. */
    Decoration.widget(to, srMarker(close), { marks: [], side: 0 }),
  );
}

/*
 * The class that keeps two fragments rendered back to back from welding into
 * one mark. A replacement's struck word and its proposed one collide as
 * "goodnorth" — one nonsense word for as long as it takes to parse the two
 * colours apart — and two separately-decidable deletions divided only by an
 * unstruck full stop run together as a single red bar, which hides how many
 * decisions the student is being asked to make.
 *
 * WHICH FRAGMENTS ABUT IS DECIDED HERE, FROM THE POSITIONS, and reaches the
 * stylesheet as a class. A CSS sibling selector cannot decide it: `bracket()`
 * puts one or two id-less screen-reader markers between any two fragments, so
 * `+` has to hop an amount that varies by case, and it skips text nodes, so
 * whichever arms do fire also separate pairs with whole words of prose between
 * them. The builder already holds both ranges exactly.
 */
const ABUTS_CLASS = "essay-suggestion-abuts";

function decorationClass(className: string, abuts: boolean): string {
  return abuts ? `${className} ${ABUTS_CLASS}` : className;
}

function decorationAttributes(
  suggestion: EssaySuggestion,
  className: string,
  hovered: boolean,
): Record<string, string> {
  return {
    class: className,
    "data-suggestion-id": suggestion.id,
    "data-suggestion-kind": suggestion.kind,
    ...(hovered ? { "data-suggestion-hovered": "" } : {}),
  };
}

/*
 * A real <ins> element, not a styled span: the proposed words are not part of
 * the document, so they must not be editable and a screen reader should hear
 * them as an insertion. Widgets are the only place this feature can use a true
 * semantic tag; the deletion side gets `nodeName: "del"` on its inline
 * decoration, which ProseMirror wraps the existing text in.
 */
function insertionWidget(
  suggestion: EssaySuggestion,
  text: string,
  hovered: boolean,
  abuts: boolean,
) {
  return () => {
    const element = document.createElement("ins");
    element.className = decorationClass("essay-suggestion-insert", abuts);
    element.contentEditable = "false";
    element.dataset.suggestionId = suggestion.id;
    element.dataset.suggestionKind = suggestion.kind;
    if (hovered) {
      element.dataset.suggestionHovered = "";
    }
    /* Bracketed from the inside, because this element is ours to build — the
     * deletion side has to do it with sibling widgets. Same markers, same
     * reason: see SR_MARKERS. */
    const [open, close] = SR_MARKERS.insert;
    element.append(srMarker(open)(), text, srMarker(close)());
    return element;
  };
}

/**
 * Paint one resolved suggestion, and report where its last fragment ends so the
 * caller can tell whether the next one abuts it. `previousEnd` is the same
 * value for the fragment before; it comes back unchanged when this suggestion
 * paints nothing, because something invisible cannot separate two marks.
 */
function pushSuggestionDecorations(
  decorations: Decoration[],
  doc: ProseMirrorNode,
  entry: ResolvedSuggestion,
  hoveredId: string | null,
  previousEnd: number | null,
): number | null {
  const { from, to, suggestion } = entry;
  if (from === null || to === null) {
    return previousEnd;
  }

  const hovered = suggestion.id === hoveredId;

  if (entry.stale) {
    // The whole anchor, untrimmed and inert: what was proposed, marked as no
    // longer applicable rather than quietly removed.
    if (to <= from) {
      return previousEnd;
    }

    decorations.push(
      Decoration.inline(from, to, {
        ...decorationAttributes(
          suggestion,
          decorationClass("essay-suggestion-stale", previousEnd === from),
          hovered,
        ),
        title: STALE_LABEL,
      }),
    );
    bracket(decorations, from, to, SR_MARKERS.stale);
    return to;
  }

  const diff = diffSuggestionText(
    suggestion.oldTextPlain,
    suggestion.newTextPlain,
  );
  const removedFrom = positionAtTextOffset(
    doc,
    from,
    to,
    diff.prefixLength,
    "start",
  );
  const removedTo = positionAtTextOffset(
    doc,
    from,
    to,
    suggestion.oldTextPlain.length - diff.suffixLength,
    "end",
  );
  const abuts = previousEnd === removedFrom;

  // An inline decoration spanning several blocks is split per text node by
  // DecorationSet itself, so a multi-paragraph change needs no hand-rolled
  // fragmentation — every rendered piece still carries the same id.
  const struck = diff.oldMiddle !== "" && removedTo > removedFrom;
  if (struck) {
    decorations.push(
      Decoration.inline(removedFrom, removedTo, {
        ...decorationAttributes(
          suggestion,
          decorationClass("essay-suggestion-delete", abuts),
          hovered,
        ),
        nodeName: "del",
      }),
    );
    bracket(decorations, removedFrom, removedTo, SR_MARKERS.delete);
  }

  if (diff.newMiddle !== "") {
    // After the struck text, never per block: one insertion, one widget. A
    // replacement's insertion always touches its own <del>, which is the
    // "goodnorth" pair — so it separates whenever that <del> was painted.
    decorations.push(
      Decoration.widget(
        removedTo,
        insertionWidget(suggestion, diff.newMiddle, hovered, struck || abuts),
        { marks: [], side: 1 },
      ),
    );
  }

  return struck || diff.newMiddle !== "" ? removedTo : previousEnd;
}

/** Anchor start, with unanchored suggestions sorted last. */
function anchorStart(entry: ResolvedSuggestion): number {
  return entry.from ?? Number.MAX_SAFE_INTEGER;
}

function buildDecorations(
  doc: ProseMirrorNode,
  resolved: ResolvedSuggestion[],
  hoveredId: string | null,
): DecorationSet {
  const decorations: Decoration[] = [];
  /* Painted in document order, so an abutment is just "this fragment starts
   * where the last one ended". `resolved` arrives in the order the agent
   * emitted its edits, which is not that. */
  const ordered = [...resolved].sort((a, b) => anchorStart(a) - anchorStart(b));
  let previousEnd: number | null = null;

  for (const entry of ordered) {
    previousEnd = pushSuggestionDecorations(
      decorations,
      doc,
      entry,
      hoveredId,
      previousEnd,
    );
  }

  return DecorationSet.create(doc, decorations);
}

function pluginState(
  doc: ProseMirrorNode,
  suggestions: EssaySuggestion[],
  hoveredId: string | null,
): SuggestionPluginState {
  const resolved = resolveSuggestions(doc, suggestions);
  return {
    decorations: buildDecorations(doc, resolved, hoveredId),
    hoveredId,
    resolved,
  };
}

/*
 * Hover belongs to the SUGGESTION, not to the element under the pointer. A
 * replacement paints as a <del>/<ins> pair and a change crossing a paragraph
 * break paints as one fragment per block, so washing only the element the
 * pointer is over lights up half a decision. Every fragment sharing the id
 * takes `data-suggestion-hovered` and the CSS in index.css does the rest.
 *
 * THE ATTRIBUTE IS A DECORATION, NOT A DOM WRITE. Writing it onto the rendered
 * spans directly is the obvious implementation and it hangs the editor: the
 * view's DOMObserver treats any attribute change inside the document as
 * browser interference, redraws the node, drops the attribute, and the redraw
 * fires a fresh `pointerover` on the replacement element — an unbounded loop
 * that repaints the paragraph under a stationary cursor. Routing hover through
 * plugin state instead means ProseMirror renders it, so there is nothing to
 * revert. One delegated listener pair, because a suggestion has no bounded
 * number of fragments; ProseMirror adds and removes them with the view, so
 * there is no teardown of our own to get wrong.
 */
function suggestionIdAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return (
    target.closest<HTMLElement>("[data-suggestion-id]")?.dataset
      .suggestionId ?? null
  );
}

function setHovered(view: EditorView, hoveredId: string | null) {
  // Compared against plugin state, never a remembered value: the redraw a
  // hover causes fires `pointerover` again, and dispatching on that would be
  // the same unbounded loop by another route.
  const state = SuggestionPluginKey.getState(view.state);
  if (state && state.hoveredId !== hoveredId) {
    view.dispatch(view.state.tr.setMeta(SuggestionPluginKey, { hoveredId }));
  }
  return false;
}

const hoverHandlers = {
  // `relatedTarget` is where the pointer went. Reading it is what stops the
  // group flickering off as the pointer crosses between its own fragments.
  pointerout: (view: EditorView, event: PointerEvent) =>
    setHovered(view, suggestionIdAt(event.relatedTarget)),
  pointerover: (view: EditorView, event: PointerEvent) =>
    setHovered(view, suggestionIdAt(event.target)),
};

/** Pending, anchored, and therefore a legal keyboard-navigation stop. */
function navigableSuggestions(state: SuggestionPluginState) {
  return state.resolved
    .filter(
      (entry): entry is ResolvedSuggestion & { from: number } =>
        !entry.stale && entry.from !== null,
    )
    .sort((a, b) => a.from - b.from);
}

export type SuggestionExtensionOptions = {
  /** Read at plugin init; afterwards the suggestions-changed meta drives it. */
  getSuggestions: () => EssaySuggestion[];
  /** Mod+Enter. Left unbound until the accept flow exists. */
  onAccept?: (suggestion: EssaySuggestion) => void;
  /** Mod+Backspace. Left unbound until the reject flow exists. */
  onReject?: (suggestion: EssaySuggestion) => void;
};

export const SuggestionExtension = Extension.create<SuggestionExtensionOptions>(
  {
    name: "essaySuggestions",

    addOptions() {
      return { getSuggestions: () => [] };
    },

    addKeyboardShortcuts() {
      const { onAccept, onReject } = this.options;

      const move = (direction: 1 | -1) => () => {
        const state = SuggestionPluginKey.getState(this.editor.state);
        if (!state) {
          return false;
        }

        const stops = navigableSuggestions(state);
        if (stops.length === 0) {
          return false;
        }

        const caret = this.editor.state.selection.from;
        const next =
          direction === 1
            ? (stops.find((entry) => entry.from > caret) ?? stops[0])
            : ([...stops].reverse().find((entry) => entry.from < caret) ??
              stops[stops.length - 1]);

        return this.editor
          .chain()
          .focus()
          .setTextSelection(next.from)
          .scrollIntoView()
          .run();
      };

      const resolveAtCaret = (act?: (suggestion: EssaySuggestion) => void) => {
        return () => {
          if (!act) {
            return false;
          }

          const state = SuggestionPluginKey.getState(this.editor.state);
          const caret = this.editor.state.selection.from;
          const focused = state?.resolved.find(
            (entry) =>
              !entry.stale &&
              entry.from !== null &&
              entry.to !== null &&
              caret >= entry.from &&
              caret <= entry.to,
          );
          if (!focused) {
            return false;
          }

          act(focused.suggestion);
          return true;
        };
      };

      /*
       * Never bare Enter, Backspace or Delete. Inside a contenteditable those
       * mean "new paragraph" and "delete a character", so a student typing near
       * a pending change would accept or reject it by accident — and the
       * accidental accept would be silent.
       */
      return {
        "Alt-,": move(-1),
        "Alt-.": move(1),
        "Mod-Backspace": resolveAtCaret(onReject),
        "Mod-Enter": resolveAtCaret(onAccept),
      };
    },

    addProseMirrorPlugins() {
      const { getSuggestions } = this.options;

      return [
        new Plugin<SuggestionPluginState>({
          key: SuggestionPluginKey,
          props: {
            decorations: (state) =>
              SuggestionPluginKey.getState(state)?.decorations ??
              DecorationSet.empty,
            handleDOMEvents: hoverHandlers,
          },
          state: {
            init: (_config, state) =>
              pluginState(state.doc, getSuggestions(), null),
            apply: (tr, previous, _oldState, newState) => {
              /*
               * THE META CHECK RUNS FIRST, STRICTLY BEFORE `docChanged`.
               *
               * Accepting a suggestion replaces the whole document with the
               * server's authoritative copy AND changes the suggestion list, in
               * one transaction. Mapping every other anchor through a
               * whole-document replacement cannot work: every position inside
               * the replaced range lands on that range's boundary, so each
               * anchor collapses to a zero-width stale span that paints
               * nothing at all. Any transaction that replaces the document
               * must therefore carry this meta and recompute — the accept path
               * and the editor's content resync both do. Mapping is for an
               * ordinary edit, which carries no meta.
               */
              const meta = tr.getMeta(SuggestionPluginKey) as
                | SuggestionMeta
                | undefined;
              if (meta && "suggestions" in meta) {
                return pluginState(
                  newState.doc,
                  meta.suggestions,
                  previous.hoveredId,
                );
              }

              /* Hover repaints, and only repaints: it never re-anchors, so it
               * sits after the recompute check and before the mapping one. */
              if (meta) {
                return {
                  decorations: buildDecorations(
                    newState.doc,
                    previous.resolved,
                    meta.hoveredId,
                  ),
                  hoveredId: meta.hoveredId,
                  resolved: previous.resolved,
                };
              }

              if (!tr.docChanged) {
                return previous;
              }

              const resolved = remapSuggestions(
                tr,
                newState.doc,
                previous.resolved,
              );
              return {
                decorations: buildDecorations(
                  newState.doc,
                  resolved,
                  previous.hoveredId,
                ),
                hoveredId: previous.hoveredId,
                resolved,
              };
            },
          },
        }),
      ];
    },
  },
);
