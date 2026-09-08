import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useCallback, useMemo } from "react";

import type { SuggestionResolution } from "@/features/essays/suggestions/suggestion-counts";
import { SuggestionPluginKey } from "@/features/essays/suggestions/suggestionExtension";

/**
 * What a pending-changes bar needs from the live document, wherever it renders.
 *
 * Position and staleness are both derived against the live document inside the
 * decoration plugin, so a review surface has to read them from there rather
 * than recompute them — two answers to "where is this" or "can this still be
 * applied" is exactly one too many. `useEditorState` is the editor's own
 * subscription seam. Revealing a change is the same knowledge read backwards:
 * the decoration carries the id, so the jump goes through the DOM the plugin
 * wrote rather than through a second position map.
 *
 * The editor page and the chat's document panel both mount `SuggestionsBar`,
 * and this is the one place that answers those two questions for both.
 */
export function useSuggestionReview(editor: Editor | null): {
  focusDocument: () => void;
  resolutions: readonly SuggestionResolution[];
  revealSuggestion: (suggestionId: string) => void;
} {
  const resolved = useEditorState({
    editor,
    selector: ({ editor: current }): SuggestionResolution[] =>
      current
        ? (SuggestionPluginKey.getState(current.state)?.resolved ?? []).map(
            (entry) => ({
              from: entry.from,
              id: entry.suggestion.id,
              stale: entry.stale,
            }),
          )
        : [],
  });
  const resolutions = useMemo(() => resolved ?? [], [resolved]);

  const revealSuggestion = useCallback(
    (suggestionId: string) => {
      editor?.view.dom
        .querySelector(`[data-suggestion-id="${CSS.escape(suggestionId)}"]`)
        ?.scrollIntoView({ block: "center" });
    },
    [editor],
  );

  /*
   * Where focus goes when the last tracked change leaves the bar.
   *
   * The bar's rows are the only thing holding focus while a student clears the
   * queue from the keyboard, so once the last one goes something has to catch
   * it — and the document is the answer the rest of this feature already gives:
   * both the popover and the `Mod+Enter` paths leave the caret in the essay.
   * The caret is restored where it was (`focus()`'s default position) and the
   * view is not scrolled, so catching focus never also moves the page.
   */
  const focusDocument = useCallback(() => {
    editor?.commands.focus(null, { scrollIntoView: false });
  }, [editor]);

  return { focusDocument, resolutions, revealSuggestion };
}
