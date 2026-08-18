import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import type { DocumentMeta, ReviewExtraction } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";
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
  const status = documentStatus(document, extraction);
  const running = Boolean(extraction && isNonTerminalExtractionStatus(extraction.status));

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6 md:px-10">
      <Button aria-label="Back to coverage" render={<Link to="/app/admin/cds" />} size="icon-sm" variant="ghost">
        <ArrowLeft />
      </Button>
      <span className="font-heading text-base font-medium tracking-tight">
        {document.school_name}
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-sm">{formatAcademicYear(document.academic_year)}</span>
      {status ? (
        <StatusChip running={running} status={status} />
      ) : (
        <span className="text-xs text-muted-foreground">
          {documentStatusFallbackLabel(document)}
        </span>
      )}
      <span className="truncate text-xs text-muted-foreground">
        {document.original_filename ?? "document.pdf"}
        {document.page_count != null && ` · ${document.page_count} pp`}
      </span>
      <div className="flex-1" />
      <Button loading={rerunPending} onClick={onRerun} size="sm" variant="outline">
        Re-run
      </Button>
      <Button
        disabled={!document.is_candidate}
        onClick={onReject}
        size="sm"
        variant="destructive-outline"
      >
        Reject
      </Button>
    </header>
  );
}
