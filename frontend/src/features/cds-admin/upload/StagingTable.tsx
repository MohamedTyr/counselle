import type { JobStatusRow, UploadPatchBody } from "@/api/cds-admin/types";
import {
  Table,
  TableBody,
  TableCaption,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StagingRow } from "@/features/cds-admin/upload/StagingRow";
import type { StagingEntry } from "@/features/cds-admin/upload/staging-model";
import { cn } from "@/lib/utils";

/** DESIGN.md §4.6/§4.4 — same bounded-height `render`-prop trick as
 * Coverage §3.3: `Table`'s container is hardcoded
 * `relative w-full overflow-x-auto`, which silently defeats `sticky top-0`.
 * Swapping the container for one with `h-full overflow-auto` gives the
 * sticky header something real to stick to, with no change to `table.tsx`. */
export function StagingTable({
  academicYearOptions,
  className,
  entries,
  jobsByExtractionId,
  onDelete,
  onPatch,
}: {
  academicYearOptions: number[];
  className?: string;
  entries: StagingEntry[];
  jobsByExtractionId: Map<string, JobStatusRow>;
  onDelete: (entry: StagingEntry) => void;
  onPatch: (fileId: string, body: UploadPatchBody) => void;
}) {
  return (
    <Table
      className="w-full table-fixed"
      render={
        <div
          className={cn(
            "h-full max-h-full overflow-auto overscroll-contain rounded-xl border",
            className,
          )}
        />
      }
    >
      <TableCaption className="sr-only">
        Files staged for this Common Data Set upload batch
      </TableCaption>
      <colgroup>
        <col style={{ width: "auto" }} />
        <col style={{ width: 260 }} />
        <col style={{ width: 132 }} />
        <col style={{ width: 72 }} />
        <col style={{ width: 180 }} />
        <col style={{ width: 48 }} />
      </colgroup>
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          <TableHead scope="col">File</TableHead>
          <TableHead scope="col">School</TableHead>
          <TableHead scope="col">Year</TableHead>
          <TableHead className="hidden xl:table-cell" scope="col">
            Pages
          </TableHead>
          <TableHead scope="col">Status</TableHead>
          <TableHead scope="col">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <StagingRow
            academicYearOptions={academicYearOptions}
            entry={entry}
            job={
              entry.row?.committed_extraction_id
                ? jobsByExtractionId.get(entry.row.committed_extraction_id)
                : undefined
            }
            key={entry.clientId}
            onDelete={onDelete}
            onPatch={onPatch}
          />
        ))}
      </TableBody>
    </Table>
  );
}
