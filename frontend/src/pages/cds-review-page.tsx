import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  useApproveDocument,
  useDocumentReview,
  useRejectDocument,
  useRerunExtraction,
} from "@/api/cds-admin/hooks";
import {
  isNonTerminalExtractionStatus,
  type DocumentReviewOut,
} from "@/api/cds-admin/types";
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
import {
  ReviewPanel,
  type ReviewPanelHandle,
} from "@/features/cds-admin/review/ReviewPanel";
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
  // Set only for the 409 `handleApprove` can't see coming: the admin's own
  // pending edit introduces a blocking flag on a packet the server refuses
  // to write (see `useApproveDocument`'s doc comment for both 409 cases).
  // `flags_summary.unresolved` never moves for this one, so it's the only
  // record that a refusal happened and why.
  const [ownEditConflictMessage, setOwnEditConflictMessage] = useState<
    string | null
  >(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [liveMessage, setLiveMessage] = useState("");
  const viewerRef = useRef<PdfPageViewerHandle>(null);
  const reviewPanelRef = useRef<ReviewPanelHandle>(null);
  const pendingConflictFocusRef = useRef(false);

  // Refs whose pending edit disappeared specifically because *this* Re-run
  // (never approve/reject, which never puts `extraction.status` through a
  // non-terminal phase) just superseded it -- see `review-context.tsx`'s
  // `supersededRefs` doc comment for why the wire can't say this on its own.
  const [supersededRefs, setSupersededRefs] = useState<Set<string>>(new Set());
  const preRerunPendingRefsRef = useRef<Set<string> | null>(null);
  const prevExtractionStatusRef = useRef(review.extraction?.status);

  useEffect(() => {
    const prevStatus = prevExtractionStatusRef.current;
    const nextStatus = review.extraction?.status;
    prevExtractionStatusRef.current = nextStatus;
    const watching = preRerunPendingRefsRef.current;
    if (!watching) return;
    const justFinishedRerun =
      prevStatus != null &&
      isNonTerminalExtractionStatus(prevStatus) &&
      nextStatus != null &&
      !isNonTerminalExtractionStatus(nextStatus);
    if (!justFinishedRerun) return;
    const stillPending = new Set<string>();
    for (const section of review.sections) {
      for (const metric of section.metrics) {
        if (metric.pending_edit) stillPending.add(metric.ref);
      }
    }
    const superseded = new Set<string>();
    for (const ref of watching) {
      if (!stillPending.has(ref)) superseded.add(ref);
    }
    setSupersededRefs(superseded);
    preRerunPendingRefsRef.current = null;
  }, [review.extraction?.status, review.sections]);

  // Two-step focus (mirrors `use-review-controller.ts`'s `pendingFocusRef`):
  // the 409 handler can't focus the next-flag button synchronously — it's
  // disabled until the mutation's `onSettled` refetch lands a fresh
  // `flags_summary` with `unresolved > 0`. Wait for that re-render instead.
  useEffect(() => {
    if (pendingConflictFocusRef.current && review.flags_summary.unresolved > 0) {
      reviewPanelRef.current?.focusNextFlag();
      pendingConflictFocusRef.current = false;
    }
  }, [review.flags_summary.unresolved]);

  // Broadened per SHIP-PLAN §2.4/§2.1: the same screen reviews both an
  // ordinary candidate document and an already-active document with a
  // still-pending `active_update` correction — mirrors the backend's
  // `_require_reviewable` gate (`app/cds/service_review.py`), which admits
  // exactly these two cases and nothing else.
  const isCorrection = review.document.is_correction_pending;
  const readOnly = !review.document.is_candidate && !isCorrection;

  function handleApprove() {
    // Clear any stale refusal from a previous attempt before re-checking --
    // this click might fix it, and a leftover message from the last failure
    // must never survive a successful approve (or an unrelated new one).
    setOwnEditConflictMessage(null);
    approveDocument.mutate(
      { documentId, body: {} },
      {
        onSuccess: () =>
          toast.success(isCorrection ? "Correction approved." : "Document approved."),
        onError: (error) => {
          if (!isTransportError(error) || error.kind !== "conflict") return;
          // `useApproveDocument` already skips its own toast for
          // `kind: "conflict"` (DESIGN.md §5.10) -- both branches below are
          // what replace it. Which one applies is decided by
          // `review.flags_summary.unresolved` as it stood *before* this
          // click (this closure's own render), which is exactly the signal
          // the server used to pick which of its two 409s to raise -- not a
          // string match on the message.
          if (review.flags_summary.unresolved > 0) {
            // Case 1: unresolved flags already on the document. A refetch
            // (the hook's own `onSettled`) will re-raise `flags_summary.
            // unresolved` above 0, and the effect below re-renders the
            // blocking sentence and moves focus once it does.
            setLiveMessage("Flags changed on the server — review before approving.");
            pendingConflictFocusRef.current = true;
            return;
          }
          // Case 2: `unresolved` was already 0, so the write never
          // happened and the refetch above can never raise it -- the
          // blocking-sentence path can't see this one. Never arm
          // `pendingConflictFocusRef` here: there is no new flag in the
          // queue for it to focus, and leaving it armed would misfire the
          // next time `unresolved` happens to change for an unrelated
          // reason. The server's own message is the only description of
          // what failed, so show it verbatim rather than inventing one.
          setOwnEditConflictMessage(error.message);
          toast.error(error.message, {
            action: {
              label: "Approve anyway",
              onClick: () => setApproveAnywayOpen(true),
            },
          });
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
          setOwnEditConflictMessage(null);
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

  // Dismissal (Esc, overlay click, Cancel) goes straight to the boolean --
  // clear the edit-conflict message here too, not just on the two success
  // paths below. `ApproveAnywayDialog`'s own discriminator no longer trusts
  // a stale message once `flags_summary.unresolved` moves off 0, but this
  // keeps the *state* itself from outliving the click that produced it,
  // rather than relying solely on that render-time check.
  function handleApproveAnywayOpenChange(next: boolean) {
    setApproveAnywayOpen(next);
    if (!next) setOwnEditConflictMessage(null);
  }

  function handleRerun() {
    const pending = new Set<string>();
    for (const section of review.sections) {
      for (const metric of section.metrics) {
        if (metric.pending_edit) pending.add(metric.ref);
      }
    }
    preRerunPendingRefsRef.current = pending;
    setSupersededRefs(new Set());
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
    supersededRefs,
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
            ref={reviewPanelRef}
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
            toReview={controller.flagQueueLength}
          />
        )}
        <div aria-live="polite" className="sr-only">
          {liveMessage}
        </div>
      </section>
      <ApproveAnywayDialog
        confirming={approveDocument.isPending}
        onConfirm={handleApproveAnywayConfirm}
        onOpenChange={handleApproveAnywayOpenChange}
        open={approveAnywayOpen}
        ownEditConflictMessage={ownEditConflictMessage ?? undefined}
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
