import { useEffect, useState } from "react";

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

// The same breakpoint the Pages column hides at (DESIGN.md §1.10). School's
// content — a matched name (`truncate`) or the "Pick a school" button — is
// the one column here that can give some width back without clipping
// anything, so it narrows here rather than staying fixed at its ≥xl size.
// Mirrors `CoverageGrid.tsx`'s `useSchoolColumnWidth` (not shared — Coverage
// is a different screen with its own owner, and the two hooks would only
// look alike, not share a reason to change together).
const WIDE_BREAKPOINT = 1280;
const SCHOOL_COLUMN_WIDTH_WIDE = 260;
const SCHOOL_COLUMN_WIDTH_NARROW = 200;
// File is `1fr, min 240` per DESIGN.md §4.4 — a genuine, breakpoint-
// independent floor, not something that flexes down when the other columns
// need room. `table-fixed` gives an `auto` column whatever is left over
// and browsers don't honour `min-width` to grow it back — measured on this
// exact table, an `auto` File column rendered as little as 86px at exactly
// 1280px (the moment the Pages column reappears alongside School widening
// to 260), which is unreadable for a filename. A fixed pixel width (not
// "auto") is the one thing `table-fixed` always honours, so File keeps its
// floor at every breakpoint; School, Year, Pages, Status, and Actions never
// yield to it. When the fixed floors don't all fit, the table's own
// `overflow-auto` container scrolls — the same fallback DESIGN.md §1.10
// already prescribes below 1024px; this just applies it consistently
// instead of only below `xl`.
const FILE_COLUMN_WIDTH = 240;

function useIsWide(): boolean {
  const [isWide, setIsWide] = useState(
    () => window.innerWidth >= WIDE_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`);
    const onChange = () => setIsWide(window.innerWidth >= WIDE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isWide;
}

/** DESIGN.md §4.6/§4.4 — same bounded-height `render`-prop trick as
 * Coverage §3.3: `Table`'s container is hardcoded
 * `relative w-full overflow-x-auto`, which silently defeats `sticky top-0`.
 * Swapping the container for one with `max-h-full overflow-auto` gives the
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
  const isWide = useIsWide();
  const schoolColumnWidth = isWide
    ? SCHOOL_COLUMN_WIDTH_WIDE
    : SCHOOL_COLUMN_WIDTH_NARROW;
  return (
    <Table
      className="w-full max-w-6xl table-fixed"
      render={
        // max-h-full (not h-full): the frame hugs a short batch (the common
        // case — a handful of files) instead of stretching a bordered box
        // full of dead space, same reasoning as CoverageGrid.tsx. max-w-6xl
        // caps the table below its container's full bleed width: File/
        // School/Year/Pages/Status/Actions are each a measured pixel floor
        // (comment below) summing to 1040px, and table-fixed distributes
        // any *extra* table width proportionally across every column —
        // uncapped, that stretched Status and even the icon-only Actions
        // column into wide bands of blank space. 6xl (1152px) leaves room
        // to breathe without reproducing that gap.
        <div
          className={cn(
            "max-h-full w-full max-w-6xl overflow-auto overscroll-contain rounded-xl border",
            className,
          )}
        />
      }
    >
      <TableCaption className="sr-only">
        Files staged for this Common Data Set upload batch
      </TableCaption>
      {/* No `<colgroup>`. `table-fixed` takes column widths from the first
          row's own cells when there's no colgroup (CSS 2.1 §17.5.2), so the
          width lives on the same `TableHead` element that carries the
          responsive `hidden xl:table-cell` class. A `<colgroup>`'s `<col>`
          count has to be hand-kept in sync with how many cells are actually
          visible — DESIGN.md §4.6 shipped with 6 `<col>`s but only 5 visible
          headers below `xl`, so every column after the hidden one silently
          took its neighbour's width. Putting width and visibility on one
          element makes that class of drift impossible: hide a header, its
          width goes with it, nothing to desync.
          Widths below are what the content actually measures, not §4.6's
          estimates: the year `Select` renders 154px (not 132), the
          "Pick a school" button needs ~126px, and the longest status
          reason — "Matches an existing document · View existing" — measures
          259px (not 180); none of those three can shrink further without
          clipping. School is the one column here that flexes below `xl`
          — see the constants above for why. File stays fixed at every
          breakpoint instead of flexing: see `FILE_COLUMN_WIDTH` above. */}
      <TableHeader className="sticky top-0 z-10 bg-background">
        <TableRow>
          <TableHead scope="col" style={{ width: FILE_COLUMN_WIDTH }}>
            File
          </TableHead>
          <TableHead scope="col" style={{ width: schoolColumnWidth }}>
            School
          </TableHead>
          <TableHead scope="col" style={{ width: 156 }}>
            Year
          </TableHead>
          <TableHead
            className="hidden xl:table-cell"
            scope="col"
            style={{ width: 72 }}
          >
            Pages
          </TableHead>
          <TableHead scope="col" style={{ width: 264 }}>
            Status
          </TableHead>
          <TableHead scope="col" style={{ width: 48 }}>
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
