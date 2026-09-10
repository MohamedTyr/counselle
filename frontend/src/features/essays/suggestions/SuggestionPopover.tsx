import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { EssaySuggestion } from "@/domain/essay-suggestion";
import { ResolveButtons } from "@/features/essays/suggestions/ResolveButtons";
import {
  suggestionPreview,
  suggestionPreviewLabel,
} from "@/features/essays/suggestions/suggestion-preview";
import { SuggestionPluginKey } from "@/features/essays/suggestions/suggestionExtension";
import type { EssaySuggestionsController } from "@/features/essays/suggestions/useEssaySuggestions";

/*
 * Accept and reject, where the change is.
 *
 * ProseMirror decorations are not React nodes, so there is no element to wrap
 * in a trigger. What exists instead is plugin state — the hovered suggestion's
 * id, already maintained by the decoration layer for the hover wash — and the
 * rendered fragments carrying that id. This measures those fragments and puts
 * a zero-interaction anchor over their union, so one popover serves a change
 * however many spans and paragraphs it paints across.
 *
 * The anchor is `pointer-events-none` on purpose: it sits above the student's
 * own prose, and an interactive overlay there would swallow caret placement
 * and drag-select in the essay they are trying to read.
 */

/** Long enough to recognise the change; the list row carries the full text. */
const PREVIEW_MAX_CHARS = 160;

/*
 * Hover intent, both ways.
 *
 * Opening: a pointer sweeping across a paragraph crosses several changes, and
 * a card that appears under every one of them is noise rather than an
 * affordance. Closing: the pointer has to cross a few pixels of gap to reach
 * the card, and neither side is hovered in between — closing on that frame
 * would make Accept unreachable by mouse, which is the whole point of it.
 */
const OPEN_DELAY_MS = 120;
const CLOSE_GRACE_MS = 140;

/*
 * Position the anchor over every fragment of one change — a replacement paints
 * a struck span and a proposed one, and a change crossing a paragraph break
 * paints one per block, so the card belongs over their union rather than over
 * whichever fragment the pointer happened to land on.
 *
 * Written straight to the element's style instead of held in React state:
 * Radix already tracks its trigger's position, so moving the element is enough
 * and the alternative is a state write per scroll frame.
 */
function place(anchor: HTMLElement, editor: Editor, suggestionId: string) {
  const fragments = editor.view.dom.querySelectorAll<HTMLElement>(
    `[data-suggestion-id="${CSS.escape(suggestionId)}"]`,
  );
  if (fragments.length === 0) {
    return;
  }

  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  for (const fragment of fragments) {
    const rect = fragment.getBoundingClientRect();
    bottom = Math.max(bottom, rect.bottom);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    top = Math.min(top, rect.top);
  }

  anchor.style.height = `${bottom - top}px`;
  anchor.style.left = `${left}px`;
  anchor.style.top = `${top}px`;
  anchor.style.width = `${right - left}px`;
}

type SuggestionPopoverProps = {
  controller: EssaySuggestionsController;
  editor: Editor | null;
  suggestions: readonly EssaySuggestion[];
};

export function SuggestionPopover({
  controller,
  editor,
  suggestions,
}: SuggestionPopoverProps) {
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [cardHovered, setCardHovered] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  /* The hovered id and its staleness both live in plugin state, which React
   * does not observe on its own — `useEditorState` is the editor's own
   * subscription seam, already used for the toolbar. */
  const hovered = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = current
        ? SuggestionPluginKey.getState(current.state)
        : undefined;
      const id = state?.hoveredId ?? null;
      return {
        id,
        stale:
          state?.resolved.find((entry) => entry.suggestion.id === id)?.stale ??
          false,
      };
    },
  });
  const hoveredId = hovered?.stale ? null : (hovered?.id ?? null);

  /* Every state write here is inside a timer, which is also what makes the
   * intent delays above possible: an immediate open is what turns a pointer
   * sweep into a flicker of cards. */
  useEffect(() => {
    if (hoveredId === null && cardHovered) {
      // The pointer is on the card itself — that is still "hovering a change".
      return;
    }

    const timer = window.setTimeout(
      () => setPinnedId(hoveredId),
      hoveredId === null ? CLOSE_GRACE_MS : OPEN_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [cardHovered, hoveredId]);

  /* Keep the anchor over the change while the card is open. The decoration
   * moves with the document, and a card pointing at the wrong words is worse
   * than no card at all when its buttons rewrite an essay. */
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!editor || pinnedId === null || anchor === null) {
      return;
    }

    const reposition = () => place(anchor, editor, pinnedId);
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [editor, pinnedId]);

  const suggestion =
    pinnedId === null
      ? undefined
      : suggestions.find((entry) => entry.id === pinnedId);
  const preview = suggestion
    ? suggestionPreview(suggestion, PREVIEW_MAX_CHARS)
    : null;

  return (
    <HoverCard open={suggestion !== undefined}>
      {/*
       * Always mounted, and `pointer-events-none` on purpose: this sits over
       * the student's own prose, and an interactive overlay there would eat
       * caret placement and drag-select in the essay they are reading.
       */}
      <HoverCardTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed"
          ref={anchorRef}
        />
      </HoverCardTrigger>
      {suggestion && preview && (
        <HoverCardContent
          align="start"
          className="w-72 p-3"
          onMouseEnter={() => setCardHovered(true)}
          onMouseLeave={() => setCardHovered(false)}
          side="bottom"
        >
          <p className="text-sm leading-5">
            <span className="font-medium">{preview.verb}: </span>
            <span className="text-muted-foreground">{preview.text}</span>
            {/* A one-character change describes nothing on its own, so the
             * surrounding words come with it. */}
            {preview.context !== "" && (
              <span className="text-muted-foreground">
                {" · "}
                {preview.context}
              </span>
            )}
          </p>
          {suggestion.rationale !== "" && (
            <p className="mt-1.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
              {suggestion.rationale}
            </p>
          )}
          <ResolveButtons
            acceptLabel="Accept"
            className="mt-2.5 [&>button]:flex-1"
            controller={controller}
            describedChange={suggestionPreviewLabel(preview)}
            onAccept={() => controller.acceptOne(suggestion.id)}
            onReject={() => controller.rejectOne(suggestion.id)}
            rejectLabel="Reject"
            target={suggestion.id}
          />
        </HoverCardContent>
      )}
    </HoverCard>
  );
}
