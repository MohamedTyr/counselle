import type { DocumentMeta, ReviewExtraction } from "@/api/cds-admin/types";
import { isNonTerminalExtractionStatus } from "@/api/cds-admin/types";
import type { CdsStatus } from "@/features/cds-admin/cds-status";

/**
 * Maps the review screen's `document`/`extraction` pair onto the shared
 * five-status vocabulary (`cds-status.tsx` §2.1) for the header chip.
 *
 * `DocumentReviewOut` has no direct `CdsStatus` field (only the Coverage
 * grid's cells carry one), so this is derived: `is_candidate` means
 * "awaiting review" and `is_active` means "the data reaching students."
 * A document that's neither (rejected, superseded, or invalidated) has no
 * home in the five-status vocabulary — the header falls back to plain
 * text rather than forcing it into a chip that would misstate what
 * happened (DESIGN.md law 2: colour/label must be true, never a guess).
 */
export function documentStatus(
  document: DocumentMeta,
  extraction: ReviewExtraction | null,
): CdsStatus | null {
  if (extraction && isNonTerminalExtractionStatus(extraction.status)) {
    return "processing";
  }
  if (document.is_candidate) return "needs_review";
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
