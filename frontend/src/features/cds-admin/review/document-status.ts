import type { DocumentMeta, ReviewExtraction } from "@/api/cds-admin/types";
import { isNonTerminalExtractionStatus } from "@/api/cds-admin/types";
import type { CdsStatus } from "@/features/cds-admin/cds-status";

/**
 * Maps the review screen's `document`/`extraction` pair onto the shared
 * six-status vocabulary (`cds-status.tsx` §2.1) for the header chip.
 *
 * `DocumentReviewOut` has no direct `CdsStatus` field (only the Coverage
 * grid's cells carry one), so this is derived: `is_candidate` means
 * "awaiting review", `is_correction_pending` means "active, but an
 * unreviewed `active_update` correction exists" (SHIP-PLAN.md §2.4 — read
 * directly off the backend-resolved boolean, never re-derived here), and
 * `is_active` means "the data reaching students." A document that's none
 * of those (rejected, superseded, or invalidated) has no home in the
 * six-status vocabulary — the header falls back to plain text rather than
 * forcing it into a chip that would misstate what happened (DESIGN.md law
 * 2: colour/label must be true, never a guess).
 */
export function documentStatus(
  document: DocumentMeta,
  extraction: ReviewExtraction | null,
): CdsStatus | null {
  if (extraction && isNonTerminalExtractionStatus(extraction.status)) {
    return "processing";
  }
  if (document.is_candidate) return "needs_review";
  if (document.is_correction_pending) return "correction_pending";
  if (document.is_active) return "approved";
  if (extraction?.status === "failed") return "failed";
  return null;
}

/** Plain-text fallback for the `documentStatus === null` case above. */
export function documentStatusFallbackLabel(document: DocumentMeta): string {
  if (document.invalidated_at) return "Rejected";
  if (document.superseded_at) return "Superseded";
  return "Inactive";
}
