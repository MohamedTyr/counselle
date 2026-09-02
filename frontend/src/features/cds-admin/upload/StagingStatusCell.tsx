import { Link } from "react-router";

import type { JobStatusRow, UploadRow } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import {
  cdsStatusFromJob,
  jobProgress,
} from "@/features/cds-admin/upload/document-status";
import {
  stagingChipStatus,
  stagingReason,
  type StagingEntry,
} from "@/features/cds-admin/upload/staging-model";
import { StatusChip, UploadStatusChip } from "@/features/cds-admin/cds-status";

/** Once queued, a row switches from the upload-readiness chip to the shared
 * document-status chip, plus a real determinate `Meter` when the job's
 * `progress` genuinely has `{done,total}` (DESIGN.md §4.8 step 6 / law 4 —
 * never a bar for a number we don't have). */
function CommittedStatus({ job, row }: { job: JobStatusRow | undefined; row: UploadRow }) {
  const { running, status } = cdsStatusFromJob(job);
  const progress = jobProgress(job);

  // `items-start`: a flex column stretches its children, which made the status
  // badge span the whole column and read as a wide disabled button, not a chip.
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusChip running={running} status={status} />
      {progress ? (
        <div className="flex items-center gap-2">
          <Meter
            aria-label={`${progress.done} of ${progress.total} domains extracted`}
            className="w-16"
            max={progress.total}
            value={progress.done}
          >
            <MeterTrack className="h-1 rounded-full">
              <MeterIndicator className="rounded-full" />
            </MeterTrack>
          </Meter>
          <span className="text-xs text-muted-foreground tabular-nums">
            {progress.done}/{progress.total} domains
          </span>
        </div>
      ) : null}
      {status !== "processing" && row.committed_document_id ? (
        <Button
          className="h-auto w-fit p-0"
          render={<Link to={`/app/admin/cds/documents/${row.committed_document_id}`} />}
          size="sm"
          variant="link"
        >
          Review
        </Button>
      ) : null}
    </div>
  );
}

export function StagingStatusCell({
  entry,
  job,
  queueFailureReason,
}: {
  entry: StagingEntry;
  job: JobStatusRow | undefined;
  queueFailureReason?: string;
}) {
  if (entry.row?.status === "committed") {
    return <CommittedStatus job={job} row={entry.row} />;
  }

  const chipStatus = stagingChipStatus(entry);
  if (chipStatus === "committed") {
    // Unreachable in practice (guarded above) — keeps the switch exhaustive
    // for TypeScript without a fallthrough default that could hide a bug.
    return null;
  }
  const reason = stagingReason(entry, queueFailureReason);

  return (
    <div className="flex flex-col items-start gap-0.5">
      <UploadStatusChip status={chipStatus} />
      {reason.text ? (
        <span className="text-xs text-muted-foreground">
          {reason.text}
          {reason.linkedDocumentId ? (
            <>
              {" · "}
              <Link
                className="underline underline-offset-2 hover:text-foreground"
                to={`/app/admin/cds/documents/${reason.linkedDocumentId}`}
              >
                View existing
              </Link>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
