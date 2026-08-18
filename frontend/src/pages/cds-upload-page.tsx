import { ArrowLeft } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/PageHeader";
import { CdsErrorCard } from "@/features/cds-admin/CdsErrorCard";
import { CdsUnavailable } from "@/features/cds-admin/CdsUnavailable";
import { BatchActionBar } from "@/features/cds-admin/upload/BatchActionBar";
import { BatchSkeleton } from "@/features/cds-admin/upload/BatchSkeleton";
import {
  FileDropZone,
  PageDropOverlay,
} from "@/features/cds-admin/upload/FileDropZone";
import { StagingTable } from "@/features/cds-admin/upload/StagingTable";
import { useBatchUpload } from "@/features/cds-admin/upload/useBatchUpload";

/** Batch upload screen, `/app/admin/cds/upload` — DESIGN.md §4. One page,
 * start to finish: the staging table becomes the job table in place, no
 * navigation, no modal. See `useBatchUpload` for the state model and
 * `plans/cds-pipeline/DESIGN.md` §4 for the full wireframe/spec this
 * implements. */
export function CdsUploadPage() {
  const batch = useBatchUpload();
  const reduceMotion = useReducedMotion() ?? false;

  // Whole-page drop target (§4.5). Drag listeners live here, not on
  // `FileDropZone`, so a drop is only ever handled once — a nested listener
  // on the zone would double-process the same `DataTransfer`. A depth
  // counter avoids flicker as the drag crosses child element boundaries.
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  function handleDragEnter(event: React.DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
    }
  }

  function handleDragLeave() {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) {
      batch.addFiles(files);
    }
  }

  const hasRows = batch.entries.length > 0;

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-6 md:px-10"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <PageHeader
        actions={
          <Button render={<Link to="/app/admin/cds" />} variant="ghost">
            <ArrowLeft data-icon="inline-start" />
            Coverage
          </Button>
        }
        title="Batch upload"
      />

      {batch.isServiceUnavailable ? (
        <CdsUnavailable />
      ) : batch.isInitialLoading ? (
        <BatchSkeleton className="mt-4" />
      ) : batch.isBatchFetchError ? (
        <CdsErrorCard
          message="This batch could not be loaded. It may still exist — try again."
          onRetry={batch.retryBatchFetch}
          title="Could not load this batch"
        />
      ) : (
        <>
          <FileDropZone
            className="mt-4"
            isDragging={isDragging}
            onFilesSelected={batch.addFiles}
            variant={hasRows ? "strip" : "hero"}
          />

          {hasRows ? (
            <div className="mt-4 min-h-0 flex-1">
              <StagingTable
                academicYearOptions={batch.academicYearOptions}
                entries={batch.entries}
                jobsByExtractionId={batch.jobsByExtractionId}
                onDelete={batch.deleteEntry}
                onPatch={batch.patchRow}
              />
            </div>
          ) : batch.hasFetchedEmptyBatch ? (
            <p className="mt-2 text-xs text-muted-foreground">
              This batch is empty.
            </p>
          ) : null}

          {hasRows ? (
            <BatchActionBar
              isBatchComplete={batch.isBatchComplete}
              isProcessed={batch.isProcessed}
              isProcessing={batch.isProcessing}
              onProcess={batch.triggerProcess}
              readyCount={batch.readyCount}
              sentence={batch.isProcessed ? batch.processedSentence : batch.readinessSentence}
            />
          ) : null}
        </>
      )}

      <PageDropOverlay reduceMotion={reduceMotion} visible={isDragging} />
    </section>
  );
}
