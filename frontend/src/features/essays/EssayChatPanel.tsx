import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, PanelRightClose } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AiChatPage } from "@/features/ai-chat/AiChatPage";
import { PendingChangesReadout } from "@/features/essays/PendingChangesReadout";
import type { PendingChangeCounts } from "@/features/essays/suggestions/suggestion-counts";
import { useEssayChatSession } from "@/features/essays/useEssayChatSession";
import { cn } from "@/lib/utils";

/*
 * The essay panel IS an `AiChatPage`.
 *
 * Not a lookalike, not a second chat built from the same parts: the same
 * component instance, narrower, pre-scoped to this essay's own session. The
 * chat page is ~500 lines of turn lifecycle — clarify drafts, response-mode
 * hydration, feedback, retry and model-unavailable recovery, detach and
 * reattach — and every line of it is identical here. A fork would mean every
 * future fix to that lifecycle has to be found and applied twice.
 *
 * So this file owns only what is genuinely essay-specific: resolving the
 * essay's durable session, the panel chrome around the chat, and passing the
 * current selection down as this turn's context.
 *
 * Collapsing the panel does not cancel a running turn. The turn belongs to the
 * turn registry, not to the React tree that happens to be rendering it, so
 * unmounting this is the same as closing the tab on a main-chat turn: the
 * existing detach/reattach path picks it back up when the panel returns.
 */

/** The locked panel width from the spec. */
const PANEL_WIDTH_PX = 380;

type EssayChatPanelProps = {
  className?: string;
  /**
   * The column is wide enough to hold the essay and this panel side by side.
   * When it is not, the panel covers the document rather than slicing it: half
   * a sentence disappearing behind an opaque surface reads as a rendering bug,
   * and reserving 380px instead leaves a measure nobody can write in (measured:
   * 27 characters a line at 1024px, 10 at 768px).
   */
  docked: boolean;
  essayId: string;
  essayTitle: string;
  /** Dismiss the selection chip without changing the editor's own selection. */
  onClearSelection: () => void;
  onClose: () => void;
  /**
   * A turn finished. The agent's edits arrive as suggestions written straight
   * to the essay, so the essay has to be re-read — nothing in the chat stream
   * carries them into the workspace cache on its own.
   */
  onTurnSettled: () => void;
  /**
   * What is waiting and what is outdated on this essay — the numbers
   * `PendingChangesReadout` states. Counted off the essay record and the live
   * document by `countPendingChanges`, the same function `SuggestionsBar`
   * counts itself with, so the band and the bar can never print two different
   * numbers for one fact. Never derived from the chat.
   */
  changeCounts: PendingChangeCounts;
  /** The student's current selection, plain text, attached to the next turn. */
  selection: string | null;
};

export function EssayChatPanel({
  changeCounts,
  className,
  docked,
  essayId,
  essayTitle,
  onClearSelection,
  onClose,
  onTurnSettled,
  selection,
}: EssayChatPanelProps) {
  const session = useEssayChatSession(essayId);
  const reduceMotion = useReducedMotion();
  /* Stable identity: this is a `useCallback` dependency down in the chat
   * page's submit path, and a fresh object every render would churn it. */
  const essayContext = useMemo(
    () => ({ essayId, selection }),
    [essayId, selection],
  );

  /*
   * Docked, the panel takes its 380px out of the row and the document simply
   * reflows into what is left — so the thing that moves is this panel's own
   * width, and the paper follows it frame for frame. That is the accordion
   * carve-out DESIGN.md §12.1 rule 2 names (a width, not a transform), and it
   * is why the paper's own shared-element layout animation is pinned off for
   * this change: two curves on one edge is what made the toggle read as a
   * glitch. Overlaid, nothing reflows, so it slides in on a transform instead.
   *
   * Both keys appear in every state on purpose: `motion` writes its targets
   * inline, and a panel that crossed the dock breakpoint mid-life would
   * otherwise keep a stale inline `width` from the state it left.
   */
  const closed = docked
    ? { width: 0, x: 0 }
    : { width: "100%", x: "100%" as const };
  const open = docked
    ? { width: PANEL_WIDTH_PX, x: 0 }
    : { width: "100%", x: 0 };

  return (
    <motion.aside
      animate={open}
      aria-label={`Counselle — ${essayTitle}`}
      className={cn(
        /* Non-modal on purpose — this is chrome appearing, not a dialog
         * opening, so it traps nothing and steals no focus. */
        "z-[var(--z-sticky)] flex min-h-0 flex-col overflow-hidden",
        docked
          ? /* Beside the paper, so it is a wall of the room: a hairline and
             * the canvas fill, same as every other flush band in the editor. */
            "relative shrink-0 border-l bg-background"
          : /* Over the paper, so it has to be an OBJECT — the raised fill plus
             * elevation-2, borderless. It was `border-l bg-background`, which
             * is the exact fill of the column it covers and a border sitting on
             * that column's own left edge: measured identical at
             * `oklch(0.984 0.004 50)`, so the essay did not read as *behind*
             * something, it read as gone. Borderless also settles DESIGN.md §4
             * — a border may only pair with `--elevation-1` (blur ≤ 2px), never
             * with elevation-2's 12px. */
            "absolute inset-y-0 right-0 bg-(--surface-raised) shadow-[var(--elevation-2)]",
        className,
      )}
      exit={closed}
      initial={reduceMotion ? false : closed}
      transition={
        reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0, 0, 0.2, 1] }
      }
    >
      {/* Fixed while docked, so the content does not reflow through every
       * frame of the width animation. Inline, off the same constant the
       * animation targets — two places naming 380 is one too many. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ width: docked ? PANEL_WIDTH_PX : "100%" }}
      >
        {/*
         * Covering, this header is the only thing on screen — so it is the only
         * place that can say what is underneath. Docked, the essay is right
         * there beside it and naming the title again would just be noise, so
         * the two states carry different cues rather than one compromise.
         */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
          <h2 className="min-w-0 truncate text-sm font-medium">
            Counselle
            {!docked && (
              <span className="font-normal text-muted-foreground">
                {" · "}
                {essayTitle}
              </span>
            )}
          </h2>
          {docked ? (
            <Button
              aria-label="Close Counselle panel"
              onClick={onClose}
              size="icon-sm"
              title="Close Counselle panel"
              type="button"
              variant="ghost"
            >
              <PanelRightClose />
            </Button>
          ) : (
            /* Named, not a glyph: the one control that gives a student their
             * own draft back should never be something they have to guess. */
            <Button
              className="h-8 shrink-0"
              onClick={onClose}
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              Back to essay
            </Button>
          )}
        </header>

        {/* Live only while covering: that is the state the editor's own
         * `SuggestionsBar` goes `inert` in, taking its announcement with it, so
         * this becomes the only channel a screen reader has. Docked, the bar is
         * still there announcing — two live regions would say the same fact
         * twice in two different grammars. */}
        <PendingChangesReadout announce={!docked} counts={changeCounts} />

        {session.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-5/12" />
          </div>
        ) : session.sessionId === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              Could not open this essay&rsquo;s conversation.
            </p>
            <Button
              onClick={() => void session.retry()}
              size="sm"
              type="button"
              variant="outline"
            >
              Try again
            </Button>
          </div>
        ) : (
          <AiChatPage
            essayContext={essayContext}
            onClearEssaySelection={onClearSelection}
            onTurnSettled={onTurnSettled}
            sessionId={session.sessionId}
            variant="essay-panel"
          />
        )}
      </div>
    </motion.aside>
  );
}
