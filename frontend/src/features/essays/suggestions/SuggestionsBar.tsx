import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { EssaySuggestion } from "@/domain/essay-suggestion";
import { essayPaperInsetClass } from "@/features/essays/essay-paper-inset";
import {
  lockedClass,
  ResolveButtons,
} from "@/features/essays/suggestions/ResolveButtons";
import {
  suggestionPreview,
  suggestionPreviewLabel,
} from "@/features/essays/suggestions/suggestion-preview";
import type { EssaySuggestionsController } from "@/features/essays/suggestions/useEssaySuggestions";
import { cn } from "@/lib/utils";

/*
 * The pending-changes bar: the only place a student can see how many changes
 * are waiting without hovering every one of them.
 *
 * It exists for two reasons the decorations alone cannot cover. A change can
 * be a single comma — a green mark a few pixels wide, easy to scroll straight
 * past — so the list is where short changes stay findable. And a decoration
 * says nothing at all to a screen reader until you land on it, so the count is
 * announced politely whenever it moves.
 *
 * Shape is a flush band, not a card: it is transient chrome sitting directly
 * on the editor's own surface, separated from the document by one hairline —
 * the same "flush bands, hairline rules" language the editor header uses. It
 * shares the paper's own inset so a row's label starts exactly where the
 * sentence it describes starts.
 */

/** Long enough to recognise a change, short enough to stay one line. */
const PREVIEW_MAX_CHARS = 90;

/** About eight rows. Past that the bar is eating the essay it annotates. */
const LIST_MAX_HEIGHT = "max-h-64";

/*
 * The cap needs an edge that says "there is more below", or the ninth row is
 * simply sliced through the middle of its glyphs and reads as a rendering bug.
 * A fade, on the pattern `EssayDocumentPreview` already uses for its own
 * overflow edge.
 *
 * The `pb-6` is what keeps the fade honest: it matches the fade distance, so a
 * list short enough not to scroll ends 24px above the box and the gradient
 * falls entirely on padding — invisible. Scrolled to the very bottom the same
 * padding sits under the gradient, so the last row is never dimmed either. The
 * fade is therefore visible in exactly the state it describes.
 */
const LIST_FADE_CLASS =
  "pb-6 [-webkit-mask-image:linear-gradient(to_bottom,#000_calc(100%-24px),transparent)] [mask-image:linear-gradient(to_bottom,#000_calc(100%-24px),transparent)]";

/**
 * One pending change as the live document sees it: where it currently sits,
 * and whether it can still be applied. Both are derived inside the decoration
 * plugin against the document itself — never sent by the server — so the bar
 * reads them from there rather than answering either question twice.
 */
export type SuggestionResolution = {
  /** Document position, or `null` when the change no longer anchors at all. */
  from: number | null;
  id: string;
  stale: boolean;
};

type SuggestionsBarProps = {
  controller: EssaySuggestionsController;
  /** Scroll a change into view in the document and flash its decoration. */
  onRevealSuggestion: (suggestionId: string) => void;
  resolutions: readonly SuggestionResolution[];
  suggestions: readonly EssaySuggestion[];
};

function countLabel(count: number): string {
  return `Counselle proposed ${count} ${count === 1 ? "change" : "changes"}.`;
}

/*
 * Document order, stale last.
 *
 * The server's order is the order the agent happened to emit its edits in,
 * which sends a student working top-to-bottom bouncing around their own essay.
 * Outdated changes sink to the bottom for the same reason: they are the only
 * rows in the list that cannot be acted on, so they must never sit between two
 * that can.
 */
function orderForReview(
  suggestions: readonly EssaySuggestion[],
  resolutions: readonly SuggestionResolution[],
) {
  const byId = new Map(resolutions.map((entry) => [entry.id, entry]));
  return suggestions
    .map((suggestion, index) => ({
      index,
      resolution: byId.get(suggestion.id),
      suggestion,
    }))
    .sort((a, b) => {
      const staleA = a.resolution?.stale ?? false;
      const staleB = b.resolution?.stale ?? false;
      if (staleA !== staleB) {
        return staleA ? 1 : -1;
      }
      const fromA = a.resolution?.from ?? Number.POSITIVE_INFINITY;
      const fromB = b.resolution?.from ?? Number.POSITIVE_INFINITY;
      return fromA === fromB ? a.index - b.index : fromA - fromB;
    });
}

export function SuggestionsBar({
  controller,
  onRevealSuggestion,
  resolutions,
  suggestions,
}: SuggestionsBarProps) {
  const reduceMotion = useReducedMotion();
  const listId = useId();
  /*
   * Controlled, because the bulk controls only exist once the list is open.
   * Collapsed, the loudest thing in the bar was an "Accept all" the student
   * met before they had seen a single one of the changes it would apply — a
   * nudge toward accepting rewrites of their own essay sight unseen. Bulk
   * action now sits downstream of looking at what it applies to.
   */
  const [isOpen, setIsOpen] = useState(false);
  const ordered = useMemo(
    () => orderForReview(suggestions, resolutions),
    [resolutions, suggestions],
  );
  const staleCount = ordered.filter(
    (entry) => entry.resolution?.stale ?? false,
  ).length;
  const pendingCount = ordered.length - staleCount;
  const hasAny = suggestions.length > 0;

  return (
    <>
      {/*
       * Polite, and outside the AnimatePresence so it is never unmounted
       * mid-announcement. Without it a change arriving is a purely visual
       * event — a student not looking at the decorations has no way to learn
       * that anything was proposed at all.
       */}
      <span aria-live="polite" className="sr-only">
        {pendingCount > 0 ? countLabel(pendingCount) : ""}
      </span>
      <AnimatePresence initial={false}>
        {hasAny && (
          <motion.div
            /* Height, deliberately: the bar's presence moves the document
             * below it, and a hard cut would jump the paragraph the student is
             * reading out from under them. This is the accordion carve-out
             * DESIGN.md §12.1 rule 2 names. Under reduced motion the height
             * goes on BOTH edges — the enter is instant and the exit fades on
             * opacity alone; leaving the exit unguarded meant dismissing the
             * last change still animated a height nobody asked for. */
            animate={{ height: "auto", opacity: 1 }}
            className="mx-auto w-full max-w-[820px] overflow-hidden"
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            transition={
              reduceMotion
                ? { duration: 0.2, ease: "easeOut" }
                : { duration: 0.2, ease: [0, 0, 0.2, 1] }
            }
          >
            <Collapsible
              /* No rule of its own: the paper's top border sits at exactly this
               * band's bottom edge (measured: 0.0px apart), so a `border-b`
               * here rendered as a second, lighter 1px line touching the
               * paper's darker one — one dirty 2px edge instead of a hairline.
               * The paper's border already separates them, at the stronger
               * token; the `pb-2.5` keeps the breathing room the rule had. */
              className={cn("pb-2.5", essayPaperInsetClass)}
              onOpenChange={setIsOpen}
              open={isOpen}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-1">
                <CollapsibleTrigger
                  aria-controls={listId}
                  className="group -ml-1 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none motion-reduce:transition-none"
                >
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform duration-150 ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                  />
                  {/*
                   * Once everything left is outdated there is nothing being
                   * proposed any more, and saying "proposed 0 changes" would
                   * be both awkward and untrue — the changes are still on the
                   * page, they just can no longer be applied.
                   */}
                  {pendingCount > 0 ? (
                    <span className="truncate">
                      <span className="font-medium text-foreground">
                        Counselle
                      </span>{" "}
                      proposed{" "}
                      <span className="tabular-nums font-medium text-foreground">
                        {pendingCount}
                      </span>{" "}
                      {pendingCount === 1 ? "change" : "changes"}
                    </span>
                  ) : (
                    <span className="truncate">
                      <span className="tabular-nums font-medium text-foreground">
                        {staleCount}
                      </span>{" "}
                      outdated {staleCount === 1 ? "change" : "changes"}
                    </span>
                  )}
                </CollapsibleTrigger>
                {isOpen && pendingCount > 0 && (
                  <ResolveButtons
                    acceptLabel="Accept all"
                    controller={controller}
                    onAccept={controller.acceptAll}
                    onReject={controller.rejectAll}
                    rejectLabel="Reject all"
                    target="all"
                  />
                )}
              </div>

              {/*
               * No height animation on the list itself: the student opened it,
               * so the layout shift is theirs and attributable. It fades in on
               * the surface-enter vocabulary instead of animating a second
               * height alongside the bar's own.
               */}
              <CollapsibleContent
                className="motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:duration-200"
                id={listId}
              >
                {/* Capped, and scrolled past the cap: eight pending changes is
                 * an ordinary revision pass, and an uncapped list of them
                 * pushes the essay it annotates off the bottom of the screen.
                 * The container is what the rows' own labels collapse on. */}
                <ul
                  className={cn(
                    "@container/changes mt-1.5 flex flex-col gap-0.5 overflow-y-auto",
                    LIST_MAX_HEIGHT,
                    LIST_FADE_CLASS,
                  )}
                >
                  {ordered.map(({ resolution, suggestion }) => {
                    const stale = resolution?.stale ?? false;
                    const preview = suggestionPreview(
                      suggestion,
                      PREVIEW_MAX_CHARS,
                    );
                    const label = suggestionPreviewLabel(preview);
                    /* A change with no anchor is not on the page to scroll
                     * to, so the row is text rather than a dead control. */
                    const canReveal = (resolution?.from ?? null) !== null;

                    const body = (
                      <>
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          {/* Only the verb slot carries "outdated": the words
                           * are still the student's own proposal, and
                           * replacing them with a status hides what the row
                           * was ever about. */}
                          {stale ? "Outdated" : preview.verb}
                        </span>
                        <span
                          className={cn(
                            "truncate",
                            stale && "text-(--essay-suggestion-stale-ink)",
                          )}
                        >
                          {preview.text}
                          {preview.context !== "" && (
                            <span className="text-muted-foreground">
                              {" · "}
                              {preview.context}
                            </span>
                          )}
                        </span>
                      </>
                    );

                    return (
                      <li
                        className="flex items-center justify-between gap-2 text-sm"
                        key={suggestion.id}
                      >
                        {canReveal ? (
                          <button
                            className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none motion-reduce:transition-none"
                            onClick={() => onRevealSuggestion(suggestion.id)}
                            type="button"
                          >
                            {body}
                          </button>
                        ) : (
                          <span className="flex min-w-0 flex-1 items-baseline gap-1.5 px-1.5 py-1">
                            {body}
                          </span>
                        )}
                        {stale ? (
                          /* Rejecting an outdated change only drops it from
                           * the queue — there is no text left to apply, and
                           * the server cannot fail a rejection. It is the one
                           * honest thing left to do with the row. */
                          <Button
                            aria-disabled={controller.isResolving || undefined}
                            aria-label={`Dismiss outdated change: ${label}`}
                            className={cn("shrink-0", lockedClass)}
                            loading={
                              controller.resolving?.id === suggestion.id &&
                              controller.resolving.action === "reject"
                            }
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              if (controller.isResolving) {
                                return;
                              }
                              controller.rejectOne(suggestion.id);
                            }}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            <X aria-hidden="true" data-icon="inline-start" />
                            <span className="hidden @[26rem]/changes:inline">
                              Dismiss
                            </span>
                          </Button>
                        ) : (
                          <ResolveButtons
                            acceptLabel="Accept"
                            collapsible
                            controller={controller}
                            describedChange={label}
                            onAccept={() => controller.acceptOne(suggestion.id)}
                            onReject={() => controller.rejectOne(suggestion.id)}
                            rejectLabel="Reject"
                            target={suggestion.id}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
