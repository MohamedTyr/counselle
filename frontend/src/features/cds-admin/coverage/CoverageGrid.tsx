import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

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
import { getStatusLabel, StatusChip } from "@/features/cds-admin/cds-status";
import type {
  CoverageCell as CoverageCellData,
  CoverageRow,
} from "@/api/cds-admin/types";

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

// DESIGN.md §3.4/§6.10: the school column narrows to 240px below the `xl:`
// breakpoint (1280px) so the year columns keep room on laptop widths.
const WIDE_BREAKPOINT = 1280;
const SCHOOL_COLUMN_WIDTH_WIDE = 280;
const SCHOOL_COLUMN_WIDTH_NARROW = 240;

function useSchoolColumnWidth(): number {
  const [isWide, setIsWide] = useState(
    () => window.innerWidth >= WIDE_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`);
    const onChange = () => setIsWide(window.innerWidth >= WIDE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isWide ? SCHOOL_COLUMN_WIDTH_WIDE : SCHOOL_COLUMN_WIDTH_NARROW;
}

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
  const isRunning = cell.job_status === "running";
  const statusLabel = getStatusLabel(cell.status, isRunning);
  const activeDomains = cell.active_domains;
  const partialDomains = cell.partial_domains;
  const candidateDomains = cell.candidate_domains;
  // `active_domains`/`partial_domains` are only populated for "approved" and
  // "correction_pending" cells (adapters/cds_admin_queries.py `_cell_from_row`).
  // `candidate_domains` is a different count — the not-yet-active candidate
  // document's own domain total — and is only populated for "needs_review"/
  // "failed". `partial_domains` counts how many of the *active* domains have
  // packet status "partial" — a domain where not every metric resolved to a
  // verified value (docs/DATABASE_GUIDE.md §4/§5's "covered but not fully").
  // It is not "N of M domains extracted" — the payload carries no manifest
  // total to compare `active_domains` against, so we never claim one.
  const isPartial =
    (cell.status === "approved" || cell.status === "correction_pending") &&
    activeDomains !== null &&
    partialDomains !== null &&
    partialDomains > 0;
  const partialSuffix = isPartial
    ? `, ${partialDomains} of ${activeDomains} active domains partial`
    : "";

  return (
    <TableCell className="p-0 text-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={`${schoolName}, ${formatAcademicYear(year)} — ${statusLabel}${partialSuffix}. Open document review.`}
            className={`flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-sm transition-colors hover:bg-accent ${FOCUS_RING}`}
            onClick={() => {
              if (cell.document_id !== null) onOpenDocument(cell.document_id);
            }}
            type="button"
          >
            <StatusChip running={isRunning} short status={cell.status} />
            {isPartial && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {partialDomains}/{activeDomains} partial
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-0.5 text-left">
            {cell.extractor_version && <div>{cell.extractor_version}</div>}
            {cell.updated_at && <div>{formatWhen(cell.updated_at)}</div>}
            {isPartial && (
              <div>
                {partialDomains} of {activeDomains} active domains partial
              </div>
            )}
            {!isPartial && candidateDomains !== null && (
              <div>{candidateDomains} domains extracted</div>
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
        className={`sticky left-0 z-10 bg-background p-2 text-left align-middle transition-colors group-hover/row:bg-muted`}
        scope="row"
      >
        {/* DESIGN.md §1.6: 44px (h-11) row height. leading-none on both
            lines is what makes the two-line school cell actually fit —
            default line-heights alone run the row to ~58px. */}
        <div className="flex min-w-0 flex-col justify-center gap-0.5">
          <span className="truncate text-sm leading-none font-medium">
            {row.name}
          </span>
          {row.state && (
            <span className="truncate text-xs leading-none text-muted-foreground">
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
  const schoolColumnWidth = useSchoolColumnWidth();
  return (
    <Table
      className="w-full max-w-5xl table-fixed"
      render={
        // max-h-full (not h-full): the frame hugs its rows when the result
        // set is small — the common case, since "Tracked" is ~8 rows
        // and find-mode-idle is one message row — and only grows to fill
        // (then scrolls) once rows actually exceed the available height.
        // max-w-5xl mirrors the table's own cap so the border never runs
        // wider than the content it holds.
        <div className="max-h-full w-full max-w-5xl overflow-auto overscroll-contain rounded-xl border" />
      }
    >
      <TableCaption className="sr-only">
        CDS document coverage by school and academic year
      </TableCaption>
      <colgroup>
        <col style={{ width: schoolColumnWidth }} />
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
