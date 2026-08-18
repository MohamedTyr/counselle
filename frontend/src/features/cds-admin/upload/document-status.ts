import type { JobStatusRow, UploadRow } from "@/api/cds-admin/types";
import type { CdsStatus } from "@/features/cds-admin/cds-status";

/**
 * Once a staged file is queued (`UploadRow.status === "committed"`), the
 * row switches from the upload-readiness vocabulary (§2.3) to the shared
 * document vocabulary (§2.1), joined against `GET /jobs` by
 * `committed_extraction_id`. This mapping only exists on the upload screen
 * — Coverage gets `CellStatus` precomputed from the backend directly, so it
 * never needs to interpret a raw extraction status itself.
 */

const TERMINAL_EXTRACTION_TO_CDS_STATUS: Record<string, CdsStatus> = {
  failed: "failed",
  partial: "needs_review",
  succeeded: "needs_review",
};

export function cdsStatusFromJob(job: JobStatusRow | undefined): {
  status: CdsStatus;
  running: boolean;
} {
  if (!job || job.status === "queued") {
    return { status: "processing", running: false };
  }
  if (job.status === "running") {
    return { status: "processing", running: true };
  }
  return {
    status: TERMINAL_EXTRACTION_TO_CDS_STATUS[job.status] ?? "failed",
    running: false,
  };
}

/** Only renders a `Meter` when the job's `progress` genuinely carries
 * `{done, total}` numbers — DESIGN.md law 4 / gap 4: never a bar for a
 * number we don't have. */
export function jobProgress(
  job: JobStatusRow | undefined,
): { done: number; total: number } | null {
  const progress = job?.progress;
  if (!progress) {
    return null;
  }
  const done = progress.done;
  const total = progress.total;
  if (typeof done === "number" && typeof total === "number" && total > 0) {
    return { done, total };
  }
  return null;
}

/** Builds `jobsByExtractionId` once per render from `GET /jobs`'s flat
 * array — every committed row's status lookup is then O(1). */
export function indexJobsByExtractionId(
  jobs: JobStatusRow[] | undefined,
): Map<string, JobStatusRow> {
  return new Map((jobs ?? []).map((job) => [job.extraction_id, job]));
}

/** The action bar's post-`Process all` sentence (§4.8.8): `"12 done · 1
 * failed"`. Only looks at rows the batch actually queued — `skipped` rows
 * stay in the pre-process readiness sentence forever, since nothing about
 * them changed. */
export function buildProcessedSentence(
  committedRows: UploadRow[],
  jobsByExtractionId: Map<string, JobStatusRow>,
): { sentence: string; isComplete: boolean } {
  let done = 0;
  let running = 0;
  let failed = 0;

  for (const row of committedRows) {
    const job = row.committed_extraction_id
      ? jobsByExtractionId.get(row.committed_extraction_id)
      : undefined;
    const { status } = cdsStatusFromJob(job);
    if (status === "processing") {
      running += 1;
    } else if (status === "failed") {
      failed += 1;
    } else {
      done += 1;
    }
  }

  const parts: string[] = [];
  if (done > 0) parts.push(`${done} done`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (running > 0) parts.push(`${running} processing`);

  return {
    isComplete: committedRows.length > 0 && running === 0,
    sentence: parts.length > 0 ? parts.join(" · ") : "Processing…",
  };
}
