import { Trash2 } from "lucide-react";

import type { JobStatusRow, SchoolSummary, UploadPatchBody } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  SelectItem,
  SelectPopup,
  Select as YearSelect,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAcademicYear, formatBytes } from "@/features/cds-admin/cds-format";
import { SchoolPicker } from "@/features/cds-admin/upload/SchoolPicker";
import { StagingStatusCell } from "@/features/cds-admin/upload/StagingStatusCell";
import type { StagingEntry } from "@/features/cds-admin/upload/staging-model";
import { cn } from "@/lib/utils";

export function StagingRow({
  academicYearOptions,
  entry,
  job,
  onDelete,
  onPatch,
}: {
  academicYearOptions: number[];
  entry: StagingEntry;
  job: JobStatusRow | undefined;
  onDelete: (entry: StagingEntry) => void;
  onPatch: (fileId: string, body: UploadPatchBody) => void;
}) {
  const row = entry.row;
  const isDuplicate = row?.status === "duplicate";
  const isCommitted = row?.status === "committed";
  const isEditable = Boolean(row) && !isCommitted;

  return (
    <TableRow className="group/row h-14">
      <TableCell className="min-w-0">
        <div className="flex min-w-0 flex-col">
          <span
            className={cn(
              "truncate text-sm font-medium",
              isDuplicate && "text-muted-foreground line-through decoration-muted-foreground",
            )}
          >
            {entry.file.name}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatBytes(row?.size_bytes ?? entry.file.size)}
          </span>
        </div>
      </TableCell>

      <TableCell className="min-w-0">
        <SchoolPicker
          disabled={!isEditable}
          onSelect={(school: SchoolSummary) =>
            row && onPatch(row.id, { school_id: school.id })
          }
          schoolName={row?.school_name ?? null}
        />
      </TableCell>

      <TableCell>
        <YearSelect
          disabled={!isEditable}
          items={academicYearOptions.map((year) => ({
            label: formatAcademicYear(year),
            value: String(year),
          }))}
          onValueChange={(value) =>
            row && onPatch(row.id, { academic_year: Number(value) })
          }
          value={row?.academic_year ? String(row.academic_year) : null}
        >
          <SelectTrigger aria-label="Academic year" size="sm">
            <SelectValue placeholder="Pick a year" />
          </SelectTrigger>
          <SelectPopup>
            {academicYearOptions.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {formatAcademicYear(year)}
              </SelectItem>
            ))}
          </SelectPopup>
        </YearSelect>
      </TableCell>

      <TableCell className="hidden text-xs text-muted-foreground tabular-nums xl:table-cell">
        {row?.page_count ?? "—"}
      </TableCell>

      <TableCell>
        <StagingStatusCell entry={entry} job={job} />
      </TableCell>

      <TableCell className="text-right">
        <Button
          aria-label={`Remove ${entry.file.name}`}
          className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
          disabled={isCommitted}
          onClick={() => onDelete(entry)}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </TableCell>
    </TableRow>
  );
}
