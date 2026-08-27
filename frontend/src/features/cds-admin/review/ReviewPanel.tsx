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

  useImperativeHandle(ref, () => ({
    focusNextFlag: () => nextFlagButtonRef.current?.focus(),
  }));

  if (extraction && isNonTerminalExtractionStatus(extraction.status)) {
    return (
      <div className={cn("flex min-h-0 flex-col", className)}>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Loader2 className="animate-spin" />
            </EmptyMedia>
            <EmptyTitle>Extracting…</EmptyTitle>
            <EmptyDescription>
              {sections.length > 0
                ? `${sections.length} domain(s) extracted so far.`
                : "This can take a few minutes."}
            </EmptyDescription>
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
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4 text-sm">
        {flagsSummary.unresolved > 0 ? (
          <span>
            <span className="font-medium text-warning tabular-nums">
              {flagsSummary.unresolved}
            </span>{" "}
            unresolved of{" "}
            <span className="tabular-nums">{flagsSummary.total}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">No flags</span>
        )}
        <Button
          aria-keyshortcuts="p"
          aria-label="Previous unresolved flag"
          disabled={flagsSummary.unresolved === 0}
          onClick={controller.goToPrevFlag}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronLeft />
        </Button>
        <Button
          aria-keyshortcuts="n"
          aria-label="Next unresolved flag"
          disabled={flagsSummary.unresolved === 0}
          onClick={controller.goToNextFlag}
          ref={nextFlagButtonRef}
          size="icon-sm"
          variant="ghost"
        >
          <ChevronRight />
        </Button>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={flaggedFirst}
            onCheckedChange={(checked) => onFlaggedFirstChange(checked === true)}
          />
          Flagged first
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
            {flagsSummary.unresolved === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Everything extracted cleanly. Spot-check a section, then
                approve.
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
