import { ChevronLeft, ChevronRight, Loader2, OctagonX } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef } from "react";

import type { DocumentReviewOut } from "@/api/cds-admin/types";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShortcutsPopover } from "@/features/cds-admin/review/ShortcutsPopover";
import { useReviewControllerContext } from "@/features/cds-admin/review/review-context";
import { ReviewSection } from "@/features/cds-admin/review/ReviewSection";
import { isNonTerminalExtractionStatus } from "@/api/cds-admin/types";
import { cn } from "@/lib/utils";

export type ReviewPanelHandle = {
  /** Moves focus to the flag bar's next-unresolved-flag button (§5.10,
   * §6.6) — the target of the 409-on-Approve path, which must move focus
   * rather than just update the live region. A no-op when the button isn't
   * mounted (extracting/failed states, or no unresolved flags). */
  focusNextFlag: () => void;
};

/** The right pane (§5.5/§5.6/§5.11): the flag bar, then every domain
 * section as one controlled `Accordion`. Extraction-in-progress and
 * extraction-failed states replace the accordion entirely — there's
 * nothing to review yet either way. */
export const ReviewPanel = forwardRef<
  ReviewPanelHandle,
  {
    review: DocumentReviewOut;
    documentId: number;
    flaggedFirst: boolean;
    onFlaggedFirstChange: (value: boolean) => void;
    readOnly: boolean;
    onRerun: () => void;
    className?: string;
  }
>(function ReviewPanel(
  { review, documentId, flaggedFirst, onFlaggedFirstChange, readOnly, onRerun, className },
  ref,
) {
  const controller = useReviewControllerContext();
  const { extraction, sections, flags_summary: flagsSummary } = review;
  const nextFlagButtonRef = useRef<HTMLButtonElement>(null);
  // What's left for a human to look at, matching the section counts and the
  // row flag icons (`hasUnresolvedFlag`) rather than `flags_summary.unresolved`,
  // which counts only Approve-blocking `error` flags. A document whose flags
  // are all `warning` must not claim "No flags" while listing them below, and
  // `n`/`p` must still walk them (§5.1 — the flag queue *is* the review).
  //
  // DEVIATION from §5.5's "3 unresolved of 7": that wording assumed unresolved
  // meant blocking. It doesn't, so "to review" is the word — otherwise this bar
  // and the approve bar's "Ready to approve" read as contradicting each other.
  const toReview = controller.flagQueueLength;

  useImperativeHandle(ref, () => ({
    focusNextFlag: () => nextFlagButtonRef.current?.focus(),
  }));

  if (extraction && isNonTerminalExtractionStatus(extraction.status)) {
    return (
      <div className={cn("flex min-h-0 flex-col", className)}>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Loader2 className="motion-safe:animate-spin" />
            </EmptyMedia>
            <EmptyTitle>Extracting…</EmptyTitle>
            {/* No count here: `sections` is whatever is *currently active* on
                the document, not this run's progress. On a re-run of an
                approved document that is the previous extraction's 13 domains,
                so "13 domains extracted so far" appeared seconds in, describing
                the old data as if it were the new run's. This endpoint carries
                no real per-domain progress (`counts` is aggregated from the
                same active packets), and law 4 is that we don't show a number
                we don't have. */}
            <EmptyDescription>This can take a few minutes.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  if (extraction?.status === "failed") {
    return (
      <div className={cn("flex min-h-0 flex-col", className)}>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <OctagonX />
            </EmptyMedia>
            <EmptyTitle>Extraction failed</EmptyTitle>
            {extraction.error_code && (
              <EmptyDescription className="text-xs">
                {extraction.error_code}
              </EmptyDescription>
            )}
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={onRerun} size="sm" variant="outline">
              Re-run
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* Not `aria-live` here — the screen has exactly one polite live
          region (§1.11/§6 checklist), owned by the page and fed by the
          controller's `announce` callback. */}
      {/* `whitespace-nowrap` + `shrink-0` on the summary text and the
          checkbox label: at 1024-1152px (DESIGN.md §1.10's "1024-1279,
          supported, degraded" bucket) this row is otherwise narrow enough
          that the flex layout shrinks those two text nodes below their
          content width, wrapping each onto a second line inside this fixed
          `h-10` bar and overlapping the border and the accordion below it.
          "Flagged first" additionally drops its label text below `xl`
          (1280px, the same threshold and pattern `StagingTable.tsx` already
          uses to hide the Size/Pages columns) and keeps only the checkbox —
          the flag-walk controls are the ones that matter at this width, so
          they're what stays labeled. */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4 text-sm">
        {toReview > 0 ? (
          <span className="shrink-0 whitespace-nowrap">
            <span className="font-medium text-warning tabular-nums">
              {toReview}
            </span>{" "}
            to review of{" "}
            <span className="tabular-nums">{flagsSummary.total}</span>
          </span>
        ) : flagsSummary.total > 0 ? (
          <span className="shrink-0 whitespace-nowrap text-muted-foreground">
            <span className="tabular-nums">{flagsSummary.total}</span> flag
            {flagsSummary.total === 1 ? "" : "s"}, all edited
          </span>
        ) : (
          <span className="shrink-0 whitespace-nowrap text-muted-foreground">
            No flags
          </span>
        )}
        <Button
          aria-keyshortcuts="p"
          aria-label="Previous unresolved flag"
          className="shrink-0"
          disabled={toReview === 0}
          onClick={controller.goToPrevFlag}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <Button
          aria-keyshortcuts="n"
          aria-label="Next unresolved flag"
          className="shrink-0"
          disabled={toReview === 0}
          onClick={controller.goToNextFlag}
          ref={nextFlagButtonRef}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronRight />
        </Button>
        <div className="flex-1" />
        <label
          aria-label="Flagged first"
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
        >
          <Checkbox
            checked={flaggedFirst}
            onCheckedChange={(checked) => onFlaggedFirstChange(checked === true)}
          />
          <span className="hidden xl:inline">Flagged first</span>
        </label>
        <ShortcutsPopover />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {sections.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No domains extracted yet.
          </p>
        ) : (
          <>
            {toReview === 0 && flagsSummary.total === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {readOnly
                  ? "Everything extracted cleanly."
                  : "Everything extracted cleanly. Spot-check a section, then approve."}
              </p>
            )}
            <Accordion
              multiple
              onValueChange={(value) =>
                controller.setOpenDomains(value as string[])
              }
              value={Array.from(controller.openDomains)}
            >
              {sections.map((section) => (
                <ReviewSection
                  documentId={documentId}
                  flaggedFirst={flaggedFirst}
                  key={section.domain_id}
                  readOnly={readOnly}
                  section={section}
                />
              ))}
            </Accordion>
          </>
        )}
      </ScrollArea>
    </div>
  );
});
