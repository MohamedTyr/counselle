import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useCallback, useMemo } from "react";

import type { SuggestionResolution } from "@/features/essays/suggestions/SuggestionsBar";
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

  return { resolutions, revealSuggestion };
}
