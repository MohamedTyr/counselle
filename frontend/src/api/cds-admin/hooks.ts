import {
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
} from "@tanstack/react-query";

import { getCoverage, searchSchools } from "@/api/cds-admin/coverage";
import {
  approveDocument,
  getDocument,
  patchMetrics,
  rejectDocument,
  rerunExtraction,
} from "@/api/cds-admin/documents";
import { handleCdsError } from "@/api/cds-admin/hook-utils";
import { getJobs, type JobsQuery } from "@/api/cds-admin/jobs";
import { cdsAdminKeys } from "@/api/cds-admin/keys";
import {
  createUpload,
  deleteUploadRow,
  listBatch,
  patchUploadRow,
  processBatch,
} from "@/api/cds-admin/uploads";
import { isTransportError } from "@/api/http/errors";
import {
  isNonTerminalExtractionStatus,
  type ApproveBody,
  type CoverageFilters,
  type CoverageResult,
  type DocumentReviewOut,
  type JobStatusRow,
  type MetricEditsBody,
  type RejectBody,
  type RerunBody,
  type UploadPatchBody,
} from "@/api/cds-admin/types";

// Polling cadences, DESIGN.md §1.8: `refetchInterval` returned from a
// function so it turns itself off once nothing is in flight.
// `refetchOnWindowFocus: false` on all three — an admin alt-tabbing to a
// PDF should not see the table reshuffle.
const COVERAGE_POLL_MS = 4000;
const JOBS_POLL_MS = 2000;
const REVIEW_POLL_MS = 3000;

// ---------------------------------------------------------------------------
// Coverage + schools
// ---------------------------------------------------------------------------

function coverageHasProcessingCell(
  query: Query<CoverageResult, unknown, CoverageResult>,
): number | false {
  const data = query.state.data;
  if (!data) return false;
  const processing = data.rows.some((row) =>
    Object.values(row.cells).some((cell) => cell.status === "processing"),
  );
  return processing ? COVERAGE_POLL_MS : false;
}

export function useCoverage(filters: CoverageFilters) {
  return useQuery({
    queryKey: cdsAdminKeys.coverage.list(filters),
    queryFn: () => getCoverage(filters),
    refetchInterval: coverageHasProcessingCell,
    refetchOnWindowFocus: false,
  });
}

export function useSearchSchools(q: string, limit = 20) {
  return useQuery({
    queryKey: cdsAdminKeys.schools.search(q),
    queryFn: () => searchSchools(q, limit),
    enabled: q.trim().length > 0,
  });
}

// ---------------------------------------------------------------------------
// Uploads / staging
// ---------------------------------------------------------------------------

export function useUploadBatch(batchId: string | undefined) {
  return useQuery({
    queryKey: cdsAdminKeys.batch.detail(batchId ?? ""),
    queryFn: () => listBatch(batchId as string),
    enabled: Boolean(batchId),
  });
}

export function useCreateUpload() {
  return useMutation({
    mutationFn: createUpload,
    onError: (error, _input, _snapshot, context) => {
      handleCdsError(error, context);
    },
    onSettled: (data, _error, input, _snapshot, context) => {
      const batchId = data?.batch_id ?? input.batchId;
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.batch.detail(batchId),
      });
    },
  });
}

export function usePatchUploadRow() {
  return useMutation({
    mutationFn: (input: { fileId: string; body: UploadPatchBody }) =>
      patchUploadRow(input),
    onError: (error, _input, _snapshot, context) => {
      handleCdsError(error, context);
    },
    onSettled: (data, _error, _input, _snapshot, context) => {
      if (!data) return;
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.batch.detail(data.batch_id),
      });
    },
  });
}

export function useDeleteUploadRow() {
  return useMutation({
    mutationFn: (input: { fileId: string; batchId: string }) =>
      deleteUploadRow(input.fileId),
    onError: (error, _input, _snapshot, context) => {
      handleCdsError(error, context);
    },
    onSettled: (_data, _error, input, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.batch.detail(input.batchId),
      });
    },
  });
}

export function useProcessBatch() {
  return useMutation({
    mutationFn: (batchId: string) => processBatch(batchId),
    onError: (error, _batchId, _snapshot, context) => {
      handleCdsError(error, context);
    },
    onSettled: (_data, _error, batchId, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.batch.detail(batchId),
      });
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.jobs.byBatch(batchId),
      });
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.coverage.all(),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

function jobsHaveNonTerminal(
  query: Query<JobStatusRow[], unknown, JobStatusRow[]>,
): number | false {
  const data = query.state.data;
  if (!data) return false;
  const active = data.some((row) => isNonTerminalExtractionStatus(row.status));
  return active ? JOBS_POLL_MS : false;
}

/** `enabled` follows whichever branch of `JobsQuery` is non-empty — a
 * `batchId: ""` or `ids: []` query never fires (mirrors the route's own
 * 422 on "batch_id or ids is required"). */
export function useJobs(query: JobsQuery) {
  const enabled = "batchId" in query ? Boolean(query.batchId) : query.ids.length > 0;
  return useQuery({
    queryKey:
      "batchId" in query
        ? cdsAdminKeys.jobs.byBatch(query.batchId)
        : cdsAdminKeys.jobs.byIds(query.ids),
    queryFn: () => getJobs(query),
    enabled,
    refetchInterval: jobsHaveNonTerminal,
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Document review
// ---------------------------------------------------------------------------

function reviewIsExtracting(
  query: Query<DocumentReviewOut, unknown, DocumentReviewOut>,
): number | false {
  const status = query.state.data?.extraction?.status;
  return status && isNonTerminalExtractionStatus(status) ? REVIEW_POLL_MS : false;
}

export function useDocumentReview(documentId: number) {
  return useQuery({
    queryKey: cdsAdminKeys.document.detail(documentId),
    queryFn: () => getDocument(documentId),
    refetchInterval: reviewIsExtracting,
    refetchOnWindowFocus: false,
  });
}

/** Writes the response straight into the `document.detail` cache instead of
 * invalidating — the PATCH already returns the fresh `DocumentReviewOut`,
 * and a save should feel instant (DESIGN.md law 7). No coverage
 * invalidation: a pending edit doesn't change the document's `CdsStatus`. */
export function usePatchMetrics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: number; body: MetricEditsBody }) =>
      patchMetrics(input),
    onError: (error, _input, _snapshot, context) => {
      handleCdsError(error, context);
    },
    onSuccess: (data, input) => {
      queryClient.setQueryData(
        cdsAdminKeys.document.detail(input.documentId),
        data,
      );
    },
  });
}

/** 409 (`kind: "conflict"`) means unresolved flags without
 * `override_flags` — an expected, recoverable state, not a failure. The
 * review screen turns it into flow control (open "Approve anyway") instead
 * of a generic error toast, so it's deliberately excluded below. 422
 * (`kind: "invalid_edit"`) means the document isn't a candidate — a real
 * error, and still toasts via `handleCdsError`. Both are available on the
 * thrown `TransportError` via `.kind`/`.status` for the screen to branch on
 * beyond the toast. */
export function useApproveDocument() {
  return useMutation({
    mutationFn: (input: { documentId: number; body: ApproveBody }) =>
      approveDocument(input),
    onError: (error, _input, _snapshot, context) => {
      if (isTransportError(error) && error.kind === "conflict") {
        return;
      }
      handleCdsError(error, context);
    },
    onSettled: (_data, _error, input, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.document.detail(input.documentId),
      });
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.coverage.all(),
      });
    },
  });
}

export function useRejectDocument() {
  return useMutation({
    mutationFn: (input: { documentId: number; body: RejectBody }) =>
      rejectDocument(input),
    onError: (error, _input, _snapshot, context) => {
      handleCdsError(error, context);
    },
    onSettled: (_data, _error, input, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.document.detail(input.documentId),
      });
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.coverage.all(),
      });
    },
  });
}

export function useRerunExtraction() {
  return useMutation({
    mutationFn: (input: { documentId: number; body: RerunBody }) =>
      rerunExtraction(input),
    onError: (error, _input, _snapshot, context) => {
      handleCdsError(error, context);
    },
    onSettled: (_data, _error, input, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.document.detail(input.documentId),
      });
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.coverage.all(),
      });
      void context.client.invalidateQueries({
        queryKey: cdsAdminKeys.jobs.all(),
      });
    },
  });
}

export { pageImageUrl } from "@/api/cds-admin/documents";
