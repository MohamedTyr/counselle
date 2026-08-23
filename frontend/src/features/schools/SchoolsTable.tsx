import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { School } from "@/domain/school";
import { tableColumns } from "@/features/schools/schools-config";
import type {
  ColumnId,
  ColumnWidths,
  SortState,
  TableColumn,
} from "@/features/schools/schools-types";
import {
  DeadlineValue,
  EssaysValue,
  ListTypeBadge,
  ProgressValue,
  SchoolIdentity,
  SchoolWebsiteLink,
  StatusBadge,
} from "@/features/schools/school-cells";
import { cn } from "@/lib/utils";

function ResizableTableHead({
  column,
  onResizeKeyDown,
  onResizeStart,
  onSort,
  sortState,
}: {
  column: TableColumn;
  onResizeKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    column: TableColumn,
  ) => void;
  onResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
    column: TableColumn,
  ) => void;
  onSort: (columnId: ColumnId) => void;
  sortState: SortState;
}) {
  const isSorted = sortState.columnId === column.id;
  const SortIcon = isSorted
    ? sortState.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <TableHead
      aria-sort={
        isSorted
          ? sortState.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className="relative overflow-hidden pr-5"
    >
      <button
        className={cn(
          "group/sort flex min-w-0 items-center gap-1.5 rounded-sm text-left transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
          isSorted && "text-foreground",
        )}
        onClick={() => onSort(column.id)}
        type="button"
      >
        <span className="block truncate">{column.label}</span>
        <SortIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-opacity",
            isSorted
              ? "opacity-0 group-hover/sort:opacity-90 group-focus-visible/sort:opacity-90"
              : "opacity-0 group-hover/sort:opacity-70 group-focus-visible/sort:opacity-70",
          )}
        />
      </button>
      <button
        aria-label={`Resize ${column.label} column`}
        className="absolute top-1 right-0 h-[calc(100%-0.5rem)] w-2 cursor-col-resize rounded-sm opacity-0 transition-opacity hover:bg-border hover:opacity-100 focus-visible:bg-border focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]"
        onKeyDown={(event) => onResizeKeyDown(event, column)}
        onPointerDown={(event) => onResizeStart(event, column)}
        type="button"
      />
    </TableHead>
  );
}

export function SchoolsTable({
  columnWidths,
  onColumnResizeKeyDown,
  onColumnResizeStart,
  onOpenSchool,
  onSort,
  schools,
  sortState,
  tableWidth,
}: {
  columnWidths: ColumnWidths;
  onColumnResizeKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    column: TableColumn,
  ) => void;
  onColumnResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>,
    column: TableColumn,
  ) => void;
  onOpenSchool: (schoolId: string) => void;
  onSort: (columnId: ColumnId) => void;
  schools: School[];
  sortState: SortState;
  tableWidth: number;
}) {
  return (
    <div className="hidden md:block">
      <Table
        variant="card"
        className="table-fixed"
        style={{ minWidth: tableWidth, width: "100%" }}
      >
        <colgroup>
          {tableColumns.map((column) => (
            <col
              data-column={column.id}
              key={column.id}
              style={{ width: columnWidths[column.id] }}
            />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            {tableColumns.map((column) => (
              <ResizableTableHead
                column={column}
                key={column.id}
                onResizeKeyDown={onColumnResizeKeyDown}
                onResizeStart={onColumnResizeStart}
                onSort={onSort}
                sortState={sortState}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {schools.length === 0 ? (
            <TableRow>
              <TableCell
                className="h-24 text-center text-muted-foreground"
                colSpan={tableColumns.length}
              >
                No schools match these filters.
              </TableCell>
            </TableRow>
          ) : (
            schools.map((school) => (
              <TableRow
                className="cursor-pointer"
                key={school.id}
                onClick={() => onOpenSchool(school.id)}
              >
                <TableCell className="overflow-hidden">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <SchoolIdentity onOpen={onOpenSchool} school={school} />
                    <SchoolWebsiteLink school={school} />
                  </div>
                </TableCell>
                <TableCell className="overflow-hidden">
                  <StatusBadge status={school.status} />
                </TableCell>
                <TableCell className="overflow-hidden">
                  <ListTypeBadge listType={school.listType} />
                </TableCell>
                <TableCell className="overflow-hidden">
                  <Badge variant="outline">{school.round}</Badge>
                </TableCell>
                <TableCell className="overflow-hidden">
                  <DeadlineValue school={school} />
                </TableCell>
                <TableCell className="overflow-hidden">
                  <ProgressValue progress={school.progress} />
                </TableCell>
                <TableCell className="overflow-hidden">
                  <EssaysValue essays={school.essays} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
