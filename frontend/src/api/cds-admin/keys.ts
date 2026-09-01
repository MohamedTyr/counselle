import type { CoverageFilters } from "@/api/cds-admin/types";

/**
 * Query-key factory for the three CDS admin screens (Coverage, Batch
 * upload, Document review). `useQuery`/`useMutation`'s `invalidateQueries`
 * does a prefix match on the key array, so invalidating a `.all()` branch
 * invalidates every more-specific key under it (e.g. every `coverage.list`
 * variant, regardless of filters).
 *
 * ── Invalidation map — READ THIS BEFORE WIRING A MUTATION ──────────────
 *
 * The three screens are built by three agents who will not coordinate with
 * each other. `frontend/src/api/cds-admin/hooks.ts` already wires every
 * mutation below to the invalidations it lists — screens should not need
 * to invalidate anything by hand. If you add a new mutation, follow the
 * same table.
 *
 *   Mutation                          Invalidates
 *   ─────────────────────────────────────────────────────────────────────
 *   createUpload (POST /uploads)      batch.detail(batch_id from response)
 *   patchUploadRow (PATCH .../{id})   batch.detail(batch_id from response)
 *   deleteUploadRow (DELETE .../{id}) batch.detail(batchId — caller-supplied,
 *                                       the 204 response carries nothing)
 *   processBatch (POST .../process)   batch.detail(batchId), jobs.byBatch(batchId),
 *                                       coverage.all() — cells flip to "processing".
 *                                       batch.queueFailures(batchId) is written directly
 *                                       via setQueryData with the response's `skipped`
 *                                       list (survives the calling screen unmounting,
 *                                       [F-03]) — never invalidated, only overwritten by
 *                                       the next processBatch call for the same batch.
 *   patchMetrics (PATCH .../metrics)  document.detail(documentId) is written
 *                                       directly via setQueryData with the
 *                                       response (no coverage change — a
 *                                       pending edit doesn't move the
 *                                       document's status)
 *   approveDocument (POST .../approve) document.detail(documentId), coverage.all()
 *                                       — the school-year cell flips to "approved"
 *   rejectDocument (POST .../reject)  document.detail(documentId), coverage.all()
 *                                       — the cell flips to "failed"/"none"
 *   rerunExtraction (POST .../rerun)  document.detail(documentId), coverage.all(),
 *                                       jobs.all() — a fresh extraction starts;
 *                                       any mounted job list should reflect it
 *
 * Reads (`useCoverage`, `useJobs`, `useDocumentReview`) additionally poll on
 * their own per DESIGN.md §1.8 — invalidation here is what keeps *other*
 * screens correct after a write, polling is what keeps *this* screen
 * correct while work is in flight. Cross-screen example: approving a
 * document on the Review screen must be visible on the Coverage grid
 * without the admin reloading it — that's `coverage.all()` above; starting
 * a batch on the Upload screen must start the Jobs poll — that's
 * `jobs.byBatch(batchId)` above.
 */
export const cdsAdminKeys = {
  all: ["cds-admin"] as const,

  coverage: {
    all: () => [...cdsAdminKeys.all, "coverage"] as const,
    list: (filters: CoverageFilters) =>
      [...cdsAdminKeys.coverage.all(), filters] as const,
  },

  schools: {
    all: () => [...cdsAdminKeys.all, "schools"] as const,
    search: (q: string) => [...cdsAdminKeys.schools.all(), q.trim()] as const,
  },

  batch: {
    all: () => [...cdsAdminKeys.all, "batch"] as const,
    detail: (batchId: string) => [...cdsAdminKeys.batch.all(), batchId] as const,
    // [F-03]: the last `processBatch` response's `skipped` list, written by
    // `useProcessBatch`'s hook-level `onSuccess` (survives the triggering
    // component unmounting, unlike a call-level `mutate()` callback) and
    // read back by `useBatchUpload` via its own `useQuery` on this key.
    queueFailures: (batchId: string) =>
      [...cdsAdminKeys.batch.all(), batchId, "queue-failures"] as const,
  },

  jobs: {
    all: () => [...cdsAdminKeys.all, "jobs"] as const,
    byBatch: (batchId: string) =>
      [...cdsAdminKeys.jobs.all(), "batch", batchId] as const,
    byIds: (ids: string[]) =>
      [...cdsAdminKeys.jobs.all(), "ids", [...ids].sort()] as const,
  },

  document: {
    all: () => [...cdsAdminKeys.all, "document"] as const,
    detail: (documentId: number) =>
      [...cdsAdminKeys.document.all(), documentId] as const,
  },
};
