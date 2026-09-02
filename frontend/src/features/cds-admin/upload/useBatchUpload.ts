import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  useCreateUpload,
  useDeleteUploadRow,
  useJobs,
  usePatchUploadRow,
  useProcessBatch,
  useUploadBatch,
} from "@/api/cds-admin/hooks";
import { cdsAdminKeys } from "@/api/cds-admin/keys";
import { isTransportError } from "@/api/http/errors";
import type { ProcessSkippedItem, UploadPatchBody, UploadRow } from "@/api/cds-admin/types";
import { buildAcademicYearOptions } from "@/features/cds-admin/upload/academic-years";
import { createConcurrencyQueue } from "@/features/cds-admin/upload/concurrency-queue";
import {
  buildProcessedSentence,
  indexJobsByExtractionId,
} from "@/features/cds-admin/upload/document-status";
import {
  buildReadinessSentence,
  markEntryFailed,
  partitionFiles,
  queueFailureReasons,
  readyToProcessCount,
  reconcileWithServer,
  rejectedFilesMessage,
  removeEntry,
  updateEntryRow,
  type StagingEntry,
} from "@/features/cds-admin/upload/staging-model";

// DESIGN.md §4.8 step 2.
const MAX_CONCURRENT_UPLOADS = 4;

function parseIntParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestErrorMessage(error: unknown): string {
  return isTransportError(error) ? error.message : "Could not upload this file.";
}

/**
 * Owns the whole batch-upload lifecycle: staging state, the bounded upload
 * queue, deep-link prefill, and the transition into job polling once
 * `Process all` fires.
 *
 * State shape is deliberately thin: `localEntries` holds only what this
 * client itself created via `addFiles` (and merely keeps it, in place, as
 * each one resolves); `deletedRowIds` is an optimistic tombstone set so a
 * delete disappears instantly instead of waiting on a refetch. Everything
 * else — the merged, render-ready row list, the two summary sentences, the
 * job index — is derived during render, not copied into state through an
 * effect.
 */
export function useBatchUpload() {
  const [searchParams, setSearchParams] = useSearchParams();
  const batchId = searchParams.get("batch") ?? undefined;
  const deepLinkSchoolId = parseIntParam(searchParams.get("school_id"));
  const deepLinkYear = parseIntParam(searchParams.get("year"));

  const [localEntries, setLocalEntries] = useState<StagingEntry[]>([]);
  const [deletedRowIds, setDeletedRowIds] = useState<ReadonlySet<string>>(new Set());
  const [mutationServiceUnavailable, setMutationServiceUnavailable] = useState(false);

  const queueRef = useRef(createConcurrencyQueue(MAX_CONCURRENT_UPLOADS));
  const pendingBatchIdRef = useRef<string | null>(null);
  const hasAnnouncedCompletionRef = useRef(false);
  // §6.1 data-integrity fix: an entry deleted before its `POST` resolves has
  // no server row yet, so there's nothing for a normal delete to target.
  // `abortControllersRef` cancels the in-flight request; `deletedClientIdsRef`
  // is the correctness backstop for the case the abort loses the race — it
  // tombstones the client id for exactly as long as that one request is in
  // flight (removed the moment it settles, in `addFiles`'s `.then`/`.catch`),
  // so it never blocks a later, deliberate re-upload of the same file (which
  // gets a fresh `crypto.randomUUID()` client id) and never accumulates
  // beyond the requests actually in flight at delete time.
  const abortControllersRef = useRef(new Map<string, AbortController>());
  const deletedClientIdsRef = useRef(new Set<string>());

  const batchQuery = useUploadBatch(batchId);
  const createUpload = useCreateUpload();
  const patchUploadRowMutation = usePatchUploadRow();
  const deleteUploadRowMutation = useDeleteUploadRow();
  const processBatchMutation = useProcessBatch();
  const jobsQuery = useJobs({ batchId: batchId ?? "" });
  // [F-03]: the last "Process all" response's `skipped` list, read back off
  // the query cache `useProcessBatch` writes into on success (hook-level,
  // not a call-level `mutate()` callback) -- this is what lets the reason
  // survive the admin navigating away before the mutation settles. Never
  // fetched (`enabled: false`); `initialData` only seeds an empty list the
  // first time this batch has no cache entry yet.
  const queueFailuresQuery = useQuery({
    queryKey: cdsAdminKeys.batch.queueFailures(batchId ?? ""),
    queryFn: () => [] as ProcessSkippedItem[],
    enabled: false,
    initialData: () => [] as ProcessSkippedItem[],
  });

  // A 503 means the pipeline DSN isn't configured — page-scoped, overrides
  // everything else (DESIGN.md §1.9 #2). It can surface from either the
  // initial batch fetch (derived straight from the query, no state needed)
  // or the first upload attempt (an async mutation failure, latched below).
  const queryServiceUnavailable =
    isTransportError(batchQuery.error) && batchQuery.error.status === 503;
  const isServiceUnavailable = mutationServiceUnavailable || queryServiceUnavailable;

  const entries = useMemo(() => {
    const reconciled = reconcileWithServer(localEntries, batchQuery.data?.rows ?? []);
    if (deletedRowIds.size === 0) {
      return reconciled;
    }
    return reconciled.filter((entry) => !entry.row || !deletedRowIds.has(entry.row.id));
  }, [batchQuery.data, deletedRowIds, localEntries]);

  function ensureBatchId(): string {
    if (batchId) return batchId;
    if (pendingBatchIdRef.current) return pendingBatchIdRef.current;
    const created = crypto.randomUUID();
    pendingBatchIdRef.current = created;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("batch", created);
        return next;
      },
      { replace: true },
    );
    return created;
  }

  /** Deep-link prefill (§4 route contract): a Coverage empty-cell click
   * arrives here with `?school_id=&year=`. Auto-applying it only when this
   * is the sole file in the very first drop into an empty batch avoids
   * stamping one school-year onto an unrelated multi-file upload. */
  function applyDeepLinkIfEligible(row: UploadRow, eligible: boolean) {
    if (!eligible) return;
    const body: UploadPatchBody = {};
    if (row.school_id === null && deepLinkSchoolId !== null) {
      body.school_id = deepLinkSchoolId;
    }
    if (row.academic_year === null && deepLinkYear !== null) {
      body.academic_year = deepLinkYear;
    }
    if (Object.keys(body).length === 0) return;
    patchUploadRowMutation.mutate({ body, fileId: row.id });
  }

  function addFiles(files: File[]) {
    const { accepted, rejected } = partitionFiles(files);
    if (rejected.length > 0) {
      toast.error(rejectedFilesMessage(rejected.length));
    }
    if (accepted.length === 0) return;

    const effectiveBatchId = ensureBatchId();
    const deepLinkEligible =
      entries.length === 0 &&
      accepted.length === 1 &&
      (deepLinkSchoolId !== null || deepLinkYear !== null);

    const newEntries: StagingEntry[] = accepted.map((file) => ({
      clientId: crypto.randomUUID(),
      file,
      phase: "uploading",
      requestError: null,
      row: null,
    }));
    setLocalEntries((current) => [...current, ...newEntries]);

    accepted.forEach((file, index) => {
      const clientId = newEntries[index].clientId;

      const controller = new AbortController();
      abortControllersRef.current.set(clientId, controller);

      void queueRef.current
        .add(() =>
          createUpload.mutateAsync({
            batchId: effectiveBatchId,
            file,
            signal: controller.signal,
          }),
        )
        .then((row) => {
          abortControllersRef.current.delete(clientId);
          const wasDeleted = deletedClientIdsRef.current.delete(clientId);
          if (wasDeleted) {
            // The admin deleted this row before the upload resolved and the
            // abort lost the race — the server now has a row nobody asked
            // for. Clean it up server-side, and only tombstone once that
            // DELETE actually succeeds (mirrors the explicit-delete path
            // below) — tombstoning first, unconditionally, would hide a row
            // from the UI forever even if the DELETE failed, while it stays
            // in a `_READY_STATUSES` state on the server and is silently
            // swept up by the next "Process all". `useDeleteUploadRow`'s
            // built-in `onError` still surfaces the failure toast.
            deleteUploadRowMutation.mutate(
              { batchId: effectiveBatchId, fileId: row.id },
              {
                onSuccess: () =>
                  setDeletedRowIds((current) => new Set(current).add(row.id)),
              },
            );
            return;
          }
          setLocalEntries((current) => updateEntryRow(current, clientId, row));
          applyDeepLinkIfEligible(row, deepLinkEligible);
        })
        .catch((error: unknown) => {
          abortControllersRef.current.delete(clientId);
          const wasDeleted = deletedClientIdsRef.current.delete(clientId);
          if (wasDeleted) {
            // A deliberate delete-triggered abort surfaces here too —
            // nothing to report, the row is already gone.
            return;
          }
          if (isTransportError(error) && error.status === 503) {
            setMutationServiceUnavailable(true);
          }
          setLocalEntries((current) =>
            markEntryFailed(current, clientId, requestErrorMessage(error)),
          );
        });
    });
  }

  function patchRow(fileId: string, body: UploadPatchBody) {
    patchUploadRowMutation.mutate({ body, fileId });
  }

  function deleteEntry(entry: StagingEntry) {
    // Tombstone + abort only while the request can still be in flight
    // (§6.1) — `entry.row` is set only after the `.then`/`.catch` in
    // `addFiles` already settled and removed this client id from both
    // refs, so adding it here for an already-resolved entry would never be
    // cleaned up and would leak for the life of the hook.
    if (!entry.row) {
      deletedClientIdsRef.current.add(entry.clientId);
      abortControllersRef.current.get(entry.clientId)?.abort();
      abortControllersRef.current.delete(entry.clientId);
    }

    if (!entry.row || !batchId) {
      setLocalEntries((current) => removeEntry(current, entry.clientId));
      return;
    }
    const rowId = entry.row.id;
    deleteUploadRowMutation.mutate(
      { batchId, fileId: rowId },
      {
        onSuccess: () =>
          setDeletedRowIds((current) => new Set(current).add(rowId)),
      },
    );
  }

  function triggerProcess() {
    if (!batchId) return;
    processBatchMutation.mutate(batchId);
  }

  const jobsByExtractionId = indexJobsByExtractionId(jobsQuery.data);
  const committedRows = entries
    .map((entry) => entry.row)
    .filter((row): row is UploadRow => row?.status === "committed");
  const readyCount = readyToProcessCount(entries);
  // [F-04] Driven off *current* readiness, not batch history: a row only
  // ever counts as "processed" once nothing is left to queue. Recomputing
  // this from live entries (rather than latching a one-way
  // `hasTriggeredProcess` flag) is what lets "Process all" reappear for a
  // file added after an earlier batch already finished.
  const isProcessed = readyCount === 0 && committedRows.length > 0;
  const { sentence: processedSentence, isComplete: isBatchComplete } = buildProcessedSentence(
    committedRows,
    jobsByExtractionId,
  );

  // One toast, once, at the moment every queued row lands (DESIGN.md §4.8.8
  // — a single batch-level toast, never per row). A ref (not state) guards
  // it since nothing needs to re-render off this flag.
  useEffect(() => {
    if (isBatchComplete && !hasAnnouncedCompletionRef.current && committedRows.length > 0) {
      hasAnnouncedCompletionRef.current = true;
      toast.success(`Batch finished — ${processedSentence}.`);
    }
  }, [committedRows.length, isBatchComplete, processedSentence]);

  const hasOptimisticContent = entries.length > 0;

  return {
    academicYearOptions: buildAcademicYearOptions(),
    addFiles,
    batchId,
    deleteEntry,
    entries,
    hasFetchedEmptyBatch: Boolean(batchId) && batchQuery.isSuccess && entries.length === 0,
    isBatchComplete,
    isBatchFetchError: batchQuery.isError && !isServiceUnavailable && !hasOptimisticContent,
    isInitialLoading: Boolean(batchId) && batchQuery.isLoading && !hasOptimisticContent,
    isProcessed,
    isProcessing: processBatchMutation.isPending,
    isServiceUnavailable,
    jobsByExtractionId,
    patchRow,
    processedSentence,
    queueFailuresByFileId: queueFailureReasons(queueFailuresQuery.data),
    readinessSentence: buildReadinessSentence(entries),
    readyCount,
    retryBatchFetch: () => void batchQuery.refetch(),
    triggerProcess,
  };
}
