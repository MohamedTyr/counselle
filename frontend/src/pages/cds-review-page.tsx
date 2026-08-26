import { useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  useApproveDocument,
  useDocumentReview,
  useRejectDocument,
  useRerunExtraction,
} from "@/api/cds-admin/hooks";
import type { DocumentReviewOut } from "@/api/cds-admin/types";
import { isTransportError } from "@/api/http/errors";
import { CdsErrorCard } from "@/features/cds-admin/CdsErrorCard";
import { CdsUnavailable } from "@/features/cds-admin/CdsUnavailable";
import { ApproveAnywayDialog } from "@/features/cds-admin/review/ApproveAnywayDialog";
import { ApproveBar } from "@/features/cds-admin/review/ApproveBar";
import { countPendingEdits } from "@/features/cds-admin/review/flag-queue";
import {
  PdfPageViewer,
  type PdfPageViewerHandle,
} from "@/features/cds-admin/review/PdfPageViewer";
import { RejectDialog } from "@/features/cds-admin/review/RejectDialog";
import { ReviewControllerContext } from "@/features/cds-admin/review/review-context";
import { ReviewHeader } from "@/features/cds-admin/review/ReviewHeader";
import { ReviewPanel } from "@/features/cds-admin/review/ReviewPanel";
import { ReviewSkeleton } from "@/features/cds-admin/review/ReviewSkeleton";
import { useReviewController } from "@/features/cds-admin/review/use-review-controller";

/** Document review (`/app/admin/cds/documents/:documentId`, DESIGN.md §5) —
 * the flag-queue workbench. No `PageHeader`: the 56px `ReviewHeader` strip
 * buys back a whole metric row of PDF (§5.3). The whole page never scrolls
 * — only the two inner panes do. */
export function CdsReviewPage() {
  const { documentId: rawId } = useParams<{ documentId: string }>();
  const parsedId = rawId ? Number(rawId) : Number.NaN;
  const validId = Number.isFinite(parsedId) && parsedId > 0;

  if (!validId) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden p-6">
        <CdsErrorCard
          message="This document link is not valid."
          onRetry={() => window.history.back()}
          title="Could not load this document"
        />
      </section>
    );
  }

  return <DocumentReview documentId={parsedId} />;
}

/** Handles the query only. Deliberately does *not* build
 * `useReviewController` or hold any section-derived state itself — those
 * live in `DocumentReviewLoaded`, which only ever mounts once `review` is
 * real data. Calling the controller hook here with a `sections: [] `
 * fallback while pending would let its "expand sections with unresolved
 * flags on load" logic run once against an empty array (React's
 * `useState(() => …)` lazy initializer only runs on first mount) and never
 * again — every section would silently start collapsed even on a heavily
 * flagged document. Splitting the component is what a fresh mount buys. */
function DocumentReview({ documentId }: { documentId: number }) {
  const navigate = useNavigate();
  const reviewQuery = useDocumentReview(documentId);

  if (reviewQuery.isPending) {
    return <ReviewSkeleton />;
  }

  if (reviewQuery.isError) {
    const error = reviewQuery.error;
    if (isTransportError(error) && error.status === 503) {
      return (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <CdsUnavailable />
        </section>
      );
    }
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden p-6">
        <CdsErrorCard
          message="It may have been removed, or you may not have access."
          onRetry={() => void reviewQuery.refetch()}
          title="Could not load this document"
        />
      </section>
    );
  }

  return (
    <DocumentReviewLoaded documentId={documentId} navigate={navigate} review={reviewQuery.data} />
  );
}

function DocumentReviewLoaded({
  documentId,
  review,
  navigate,
}: {
  documentId: number;
  review: DocumentReviewOut;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const approveDocument = useApproveDocument();
  const rejectDocument = useRejectDocument();
  const rerunExtraction = useRerunExtraction();

  const [searchParams, setSearchParams] = useSearchParams();
  const flaggedFirst = searchParams.get("flagged") !== "0";
  function setFlaggedFirst(next: boolean) {
    setSearchParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        if (next) copy.delete("flagged");
        else copy.set("flagged", "0");
        return copy;
      },
      { replace: true },
    );
  }

  const [approveAnywayOpen, setApproveAnywayOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [liveMessage, setLiveMessage] = useState("");
  const viewerRef = useRef<PdfPageViewerHandle>(null);

  // Broadened per SHIP-PLAN §2.4/§2.1: the same screen reviews both an
  // ordinary candidate document and an already-active document with a
  // still-pending `active_update` correction — mirrors the backend's
  // `_require_reviewable` gate (`app/cds/service_review.py`), which admits
  // exactly these two cases and nothing else.
  const isCorrection = review.document.is_correction_pending;
  const readOnly = !review.document.is_candidate && !isCorrection;

  function handleApprove() {
    approveDocument.mutate(
      { documentId, body: {} },
      {
        onSuccess: () =>
          toast.success(isCorrection ? "Correction approved." : "Document approved."),
        onError: (error) => {
          // A 409 (unresolved flags changed server-side) refetches via the
          // hook's own `onSettled` — the fresh `flags_summary` re-renders
          // the blocking sentence. `useApproveDocument` already skips its
          // own toast for `kind: "conflict"` (DESIGN.md §5.10); this just
          // moves attention to the blocking sentence via the live region.
          if (isTransportError(error) && error.kind === "conflict") {
            setLiveMessage("Flags changed on the server — review before approving.");
          }
        },
      },
    );
  }

  function handleApproveAnywayConfirm(note: string) {
    approveDocument.mutate(
      { documentId, body: { note: note.trim() || undefined, override_flags: true } },
      {
        onSuccess: () => {
          setApproveAnywayOpen(false);
          toast.success(isCorrection ? "Correction approved." : "Document approved.");
        },
      },
    );
  }

  function handleReject(reason: string) {
    rejectDocument.mutate(
      { documentId, body: { reason } },
      {
        onSuccess: () => {
          setRejectOpen(false);
          toast.success(isCorrection ? "Correction discarded." : "Document rejected.");
          void navigate("/app/admin/cds");
        },
      },
    );
  }

  function handleRerun() {
    rerunExtraction.mutate(
      { documentId, body: {} },
      { onSuccess: () => toast.success("Re-extraction queued.") },
    );
  }

  const controller = useReviewController({
    announce: setLiveMessage,
    currentPage,
    flaggedFirst,
    onApprove: () => {
      if (review.flags_summary.unresolved > 0) return;
      handleApprove();
    },
    sections: review.sections,
    viewerRef,
  });

  return (
    <ReviewControllerContext value={controller}>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ReviewHeader
          document={review.document}
          extraction={review.extraction}
          onReject={() => setRejectOpen(true)}
          onRerun={handleRerun}
          rerunPending={rerunExtraction.isPending}
        />
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <PdfPageViewer
            className="min-h-0 border-r"
            documentId={documentId}
            onPageChange={setCurrentPage}
            pageCount={review.document.page_count}
            ref={viewerRef}
          />
          <ReviewPanel
            className="min-h-0"
            documentId={documentId}
            flaggedFirst={flaggedFirst}
            onFlaggedFirstChange={setFlaggedFirst}
            onRerun={handleRerun}
            readOnly={readOnly}
            review={review}
          />
        </div>
        {!readOnly && (
          <ApproveBar
            approving={approveDocument.isPending}
            disabled={approveDocument.isPending}
            flagsSummary={review.flags_summary}
            onApprove={handleApprove}
            onApproveAnywayClick={() => setApproveAnywayOpen(true)}
            pendingEditsCount={countPendingEdits(review.sections)}
          />
        )}
        <div aria-live="polite" className="sr-only">
          {liveMessage}
        </div>
      </section>
      <ApproveAnywayDialog
        confirming={approveDocument.isPending}
        onConfirm={handleApproveAnywayConfirm}
        onOpenChange={setApproveAnywayOpen}
        open={approveAnywayOpen}
        review={review}
      />
      <RejectDialog
        confirming={rejectDocument.isPending}
        isCorrection={isCorrection}
        onConfirm={handleReject}
        onOpenChange={setRejectOpen}
        open={rejectOpen}
      />
    </ReviewControllerContext>
  );
}
