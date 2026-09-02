import { ArrowLeft, TriangleAlert } from "lucide-react";
import { Link } from "react-router";

import type { DocumentMeta, ReviewExtraction } from "@/api/cds-admin/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatAcademicYear } from "@/features/cds-admin/cds-format";
import { StatusChip } from "@/features/cds-admin/cds-status";
import {
  documentStatus,
  documentStatusFallbackLabel,
} from "@/features/cds-admin/review/document-status";
import { isNonTerminalExtractionStatus } from "@/api/cds-admin/types";

/** The 56px identity strip (§5.3) — replaces `PageHeader` here on purpose:
 * the 72px `PageHeader` costs a whole metric row of PDF on a workbench
 * screen. Re-run and Reject live up here, away from Approve at the bottom —
 * destructive and constructive actions sharing a corner is how people
 * mis-click. */
export function ReviewHeader({
  document,
  extraction,
  onRerun,
  onReject,
  rerunPending,
}: {
  document: DocumentMeta;
  extraction: ReviewExtraction | null;
  onRerun: () => void;
  onReject: () => void;
  rerunPending: boolean;
}) {
  // Reject is available for the same two reviewable cases as the rest of
  // the screen (SHIP-PLAN §2.1/§2.4): an ordinary candidate, or an active
  // document with a still-pending `active_update` correction.
  const canReject = document.is_candidate || document.is_correction_pending;
  const status = documentStatus(document, extraction);
  const running = Boolean(extraction && isNonTerminalExtractionStatus(extraction.status));

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6 md:px-10">
      <Button aria-label="Back to coverage" render={<Link to="/app/admin/cds" />} size="icon-sm" variant="ghost">
        <ArrowLeft />
      </Button>
      <span className="shrink-0 font-heading text-base font-medium whitespace-nowrap tracking-tight">
        {document.school_name}
      </span>
      <span className="shrink-0 text-muted-foreground">·</span>
      <span className="shrink-0 text-sm whitespace-nowrap">
        {formatAcademicYear(document.academic_year)}
      </span>
      {status ? (
        <StatusChip running={running} status={status} />
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">
          {documentStatusFallbackLabel(document)}
        </span>
      )}
      {/* R-01: the domains on screen didn't all come out of the same
          extraction run (e.g. a domain-scoped rerun finished for some
          domains but not others), so the `StatusChip` and the Re-run/Reject
          actions beside it still reflect only one contributing run — the
          tooltip has to say that, not just name the missing attribution,
          or an admin can read a "Failed" chip as covering all the domains
          underneath it. `warning` (DESIGN.md §14.1, "not ready") plus
          `TriangleAlert` match the caution-badge convention already used
          for a data-trust caveat (`FactTable.tsx`, `SectionStatus.tsx`),
          not the neutral `flagSeverityMeta.info` note this used to mirror. */}
      {extraction?.is_mixed_generation && (
        <Tooltip>
          <TooltipTrigger className="shrink-0">
            <Badge size="sm" variant="warning">
              <TriangleAlert aria-hidden="true" />
              Mixed runs
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            The status chip and the actions beside it reflect only one of
            these runs, not all of them. Check each domain&apos;s own status
            before you approve.
          </TooltipContent>
        </Tooltip>
      )}
      {/* The document's identity (school, year, status) is the strip's most
          important content — it must never wrap (§1.10, ≥1280px is the
          target bucket, not degraded). The filename is the least important
          thing here, so it's the one flex item that shrinks: `min-w-0`
          lets it size below its text's intrinsic width (the flexbox
          min-width:auto trap — without it, a long unbreakable filename
          refuses to shrink and squeezes the identity spans into wrapping
          instead), `flex-1` claims the remaining space, `truncate` ellipses
          what doesn't fit. */}
      <span
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        title={document.original_filename ?? undefined}
      >
        {document.original_filename ?? "document.pdf"}
        {document.page_count != null && ` · ${document.page_count} pp`}
      </span>
      <div className="flex-1" />
      <Button loading={rerunPending} onClick={onRerun} size="sm" variant="outline">
        Re-run
      </Button>
      <Button
        disabled={!canReject}
        onClick={onReject}
        size="sm"
        variant="destructive-outline"
      >
        Reject
      </Button>
    </header>
  );
}
