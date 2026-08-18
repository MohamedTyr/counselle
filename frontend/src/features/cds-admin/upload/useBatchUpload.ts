import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  useCreateUpload,
  useDeleteUploadRow,
  useJobs,
  usePatchUploadRow,
  useProcessBatch,
  useUploadBatch,
} from "@/api/cds-admin/hooks";
import { isTransportError } from "@/api/http/errors";
import type { UploadPatchBody, UploadRow } from "@/api/cds-admin/types";
import { buildAcademicYearOptions } from "@/features/cds-admin/upload/academic-years";
import { createConcurrencyQueue } from "@/features/cds-admin/upload/concurrency-queue";
import {
  buildProcessedSentence,
  indexJobsByExtractionId,
} from "@/features/cds-admin/upload/document-status";
import {
  buildReadinessSentence,
  detectingDelayMs,
  flipToDetecting,
  markEntryFailed,
  partitionFiles,
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
  const [hasTriggeredProcess, setHasTriggeredProcess] = useState(false);
  const [mutationServiceUnavailable, setMutationServiceUnavailable] = useState(false);

  const queueRef = useRef(createConcurrencyQueue(MAX_CONCURRENT_UPLOADS));
  const pendingBatchIdRef = useRef<string | null>(null);
  const timersRef = useRef(new Set<number>());
  const hasAnnouncedCompletionRef = useRef(false);

  const batchQuery = useUploadBatch(batchId);
  const createUpload = useCreateUpload();
  const patchUploadRowMutation = usePatchUploadRow();
  const deleteUploadRowMutation = useDeleteUploadRow();
  const processBatchMutation = useProcessBatch();
  const jobsQuery = useJobs({ batchId: batchId ?? "" });

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

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

      const timer = window.setTimeout(() => {
        timersRef.current.delete(timer);
        setLocalEntries((current) => flipToDetecting(current, clientId));
      }, detectingDelayMs(file.size));
      timersRef.current.add(timer);

      void queueRef.current
        .add(() => createUpload.mutateAsync({ batchId: effectiveBatchId, file }))
        .then((row) => {
          setLocalEntries((current) => updateEntryRow(current, clientId, row));
          applyDeepLinkIfEligible(row, deepLinkEligible);
        })
        .catch((error: unknown) => {
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
    setHasTriggeredProcess(true);
    processBatchMutation.mutate(batchId);
  }

  const jobsByExtractionId = indexJobsByExtractionId(jobsQuery.data);
  const committedRows = entries
    .map((entry) => entry.row)
    .filter((row): row is UploadRow => row?.status === "committed");
  const isProcessed = hasTriggeredProcess || committedRows.length > 0;
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
    readinessSentence: buildReadinessSentence(entries),
    readyCount: readyToProcessCount(entries),
    retryBatchFetch: () => void batchQuery.refetch(),
    triggerProcess,
  };
}

export type UseBatchUploadResult = ReturnType<typeof useBatchUpload>;
