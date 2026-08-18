import { Plus } from "lucide-react";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatAcademicYear,
  formatAcademicYearShort,
  formatWhen,
} from "@/features/cds-admin/cds-format";
import { cdsStatusMeta, StatusChip } from "@/features/cds-admin/cds-status";
import type {
  CoverageCell as CoverageCellData,
  CoverageRow,
} from "@/api/cds-admin/types";

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

function EmptyCell({
  onOpenUpload,
  schoolId,
  schoolName,
  year,
}: {
  onOpenUpload: (schoolId: number, year: number) => void;
  schoolId: number;
  schoolName: string;
  year: number;
}) {
  return (
    <TableCell className="p-0 text-center">
      <button
        aria-label={`${schoolName}, ${formatAcademicYear(year)} — not uploaded. Upload a document.`}
        className={`group/cell flex h-11 w-full flex-col items-center justify-center rounded-sm transition-colors hover:bg-accent ${FOCUS_RING}`}
        onClick={() => onOpenUpload(schoolId, year)}
        type="button"
      >
        <span className="text-muted-foreground/40 transition-colors group-hover/row:hidden">
          ·
        </span>
        <Plus
          aria-hidden="true"
          className="hidden size-3.5 text-muted-foreground group-hover/row:block group-focus-visible/cell:block"
        />
      </button>
    </TableCell>
  );
}

function PopulatedCell({
  cell,
  onOpenDocument,
  schoolName,
  year,
}: {
  cell: CoverageCellData;
  onOpenDocument: (documentId: number) => void;
  schoolName: string;
  year: number;
}) {
  const meta = cdsStatusMeta[cell.status];
  const activeDomains = cell.active_domains;
  const candidateDomains = cell.candidate_domains;
  const isPartial =
    cell.status === "approved" &&
    activeDomains !== null &&
    candidateDomains !== null &&
    activeDomains < candidateDomains;

  return (
    <TableCell className="p-0 text-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={`${schoolName}, ${formatAcademicYear(year)} — ${meta.label}. Open document review.`}
            className={`flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-sm transition-colors hover:bg-accent ${FOCUS_RING}`}
            onClick={() => {
              if (cell.document_id !== null) onOpenDocument(cell.document_id);
            }}
            type="button"
          >
            <StatusChip short status={cell.status} />
            {isPartial && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {activeDomains}/{candidateDomains}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-0.5 text-left">
            {cell.extractor_version && <div>{cell.extractor_version}</div>}
            {cell.updated_at && <div>{formatWhen(cell.updated_at)}</div>}
            {candidateDomains !== null && (
              <div>
                {activeDomains ?? 0}/{candidateDomains} domains
              </div>
            )}
            {cell.status === "failed" && cell.error_code && (
              <div>{cell.error_code}</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TableCell>
  );
}

function CoverageGridRow({
  onOpenDocument,
  onOpenUpload,
  row,
  years,
}: {
  onOpenDocument: (documentId: number) => void;
  onOpenUpload: (schoolId: number, year: number) => void;
  row: CoverageRow;
  years: number[];
}) {
  return (
    <TableRow className="group/row h-11 hover:bg-muted">
      <th
        className={`sticky left-0 z-10 bg-background p-2.5 text-left align-middle transition-colors group-hover/row:bg-muted`}
        scope="row"
      >
        <div className="flex min-w-0 flex-col justify-center gap-0.5">
          <span className="truncate text-sm font-medium">{row.name}</span>
          {row.state && (
            <span className="truncate text-xs text-muted-foreground">
              {row.state}
            </span>
          )}
        </div>
      </th>
      {years.map((year) => {
        const cell = row.cells[year];
        if (!cell || cell.status === "none") {
          return (
            <EmptyCell
              key={year}
              onOpenUpload={onOpenUpload}
              schoolId={row.school_id}
              schoolName={row.name}
              year={year}
            />
          );
        }
        return (
          <PopulatedCell
            cell={cell}
            key={year}
            onOpenDocument={onOpenDocument}
            schoolName={row.name}
            year={year}
          />
        );
      })}
    </TableRow>
  );
}

/**
 * The coverage matrix, DESIGN.md §3.2-3.6 — schools × academic years,
 * sticky header row and sticky school column. Renders only once rows have
 * loaded successfully; loading/error/503/no-documents-at-all states are the
 * caller's job (`cds-coverage-page.tsx`) — this component's own empty state
 * is only the "zero rows for the current filters/find-mode" spanning cell,
 * which needs to keep the frame (and the sticky header) visible so the
 * admin can see the filters are still live.
 *
 * The sticky trap (DESIGN.md §3.3): `Table`'s container is hardcoded
 * `overflow-x-auto` with no bounded height, so `sticky top-0` silently does
 * nothing inside it. The fix is the primitive's own `render` prop — no
 * change to `table.tsx`.
 */
export function CoverageGrid({
  emptyMessage,
  onOpenDocument,
  onOpenUpload,
  rows,
  years,
}: {
  emptyMessage: string;
  onOpenDocument: (documentId: number) => void;
  onOpenUpload: (schoolId: number, year: number) => void;
  rows: CoverageRow[];
  years: number[];
}) {
  return (
    <Table
      className="w-full max-w-5xl table-fixed"
      render={
        <div className="h-full max-h-full overflow-auto overscroll-contain rounded-xl border" />
      }
    >
      <TableCaption className="sr-only">
        CDS document coverage by school and academic year
      </TableCaption>
      <colgroup>
        <col style={{ width: 280 }} />
        {years.map((year) => (
          <col key={year} style={{ minWidth: 112 }} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead
            className="sticky top-0 left-0 z-30 bg-background"
            scope="col"
          >
            School
          </TableHead>
          {years.map((year) => (
            <TableHead
              className="sticky top-0 z-20 bg-background text-center"
              key={year}
              scope="col"
            >
              {formatAcademicYearShort(year)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              className="h-24 text-center text-muted-foreground"
              colSpan={years.length + 1}
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <CoverageGridRow
              key={row.school_id}
              onOpenDocument={onOpenDocument}
              onOpenUpload={onOpenUpload}
              row={row}
              years={years}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
}
