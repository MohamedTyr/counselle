import { ArrowDown, ArrowUp, ChevronDown, Compass, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { School } from "@/domain/school";
import { ListBalanceBar } from "@/features/schools/ListBalanceBar";
import {
  defaultSortState,
  tableColumns,
  viewFilterOptions,
} from "@/features/schools/schools-config";
import {
  filterSchools,
  matchesViewFilter,
} from "@/features/schools/schools-filters";
import { SchoolMobileList } from "@/features/schools/SchoolMobileList";
import { SchoolsTable } from "@/features/schools/SchoolsTable";
import { sortSchools } from "@/features/schools/schools-sort";
import type {
  ColumnId,
  ListTypeFilter,
  SortState,
  ViewFilter,
} from "@/features/schools/schools-types";
import { useColumnLayout } from "@/features/schools/useColumnLayout";

/*
 * My list — the application tracker. A table, not cards, because this
 * answers "what do I owe and when?": a status read down aligned columns.
 * Explore answers "which of these do I want?" and gets cards for it. Same
 * data model, correctly different affordances — don't unify them.
 *
 * The table and the mobile list are unchanged from before the tab split.
 * What is new above them is the balance bar, which took over the old pill
 * row's filtering job and added the one thing the pills could not say.
 */

function DropdownOptionLabel({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
      <span>{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </span>
  );
}

export function MyListPanel({
  schools,
  onAddSchool,
  onOpenSchool,
}: {
  schools: School[];
  onAddSchool: () => void;
  onOpenSchool: (schoolId: string) => void;
}) {
  const {
    columnWidths,
    handleColumnResizeKeyDown,
    handleColumnResizeStart,
    tableWidth,
  } = useColumnLayout();
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [listTypeFilter, setListTypeFilter] = useState<ListTypeFilter>("all");
  const [sortState, setSortState] = useState<SortState>(defaultSortState);

  const filteredSchools = useMemo(
    () => filterSchools(schools, viewFilter, listTypeFilter),
    [listTypeFilter, schools, viewFilter],
  );
  const sortedSchools = useMemo(
    () => sortSchools(filteredSchools, sortState),
    [filteredSchools, sortState],
  );
  const activeViewFilter =
    viewFilterOptions.find((option) => option.value === viewFilter) ??
    viewFilterOptions[0];
  const activeSortColumn =
    tableColumns.find((column) => column.id === sortState.columnId) ??
    tableColumns[0];

  function handleColumnSort(columnId: ColumnId) {
    setSortState((current) =>
      current.columnId === columnId
        ? {
            columnId,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { columnId, direction: "asc" },
    );
  }

  if (schools.length === 0) {
    return (
      <Empty className="rounded-xl border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Plus />
          </EmptyMedia>
          <EmptyTitle>No schools yet</EmptyTitle>
          <EmptyDescription>
            Build your college list, then track deadlines, tasks, and essays
            from one place.
          </EmptyDescription>
        </EmptyHeader>
        {/* Two actions, because a first-run student has nothing to add
         * *from* yet — "browse" is the honest first step and "add" is for
         * the one who already knows the name. */}
        <EmptyContent className="flex-row flex-wrap justify-center gap-2">
          <Button onClick={onAddSchool}>
            <Plus data-icon="inline-start" />
            Add your first school
          </Button>
          <Button
            render={<Link to="/app/schools?tab=explore" />}
            variant="outline"
          >
            <Compass data-icon="inline-start" />
            Browse schools
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ListBalanceBar
        listTypeFilter={listTypeFilter}
        onListTypeFilterChange={setListTypeFilter}
        schools={schools}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-muted-foreground">
          {filteredSchools.length === 1
            ? "1 school shown"
            : `${filteredSchools.length} schools shown`}
        </span>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Choose application view filter"
                className="justify-between"
                variant="outline"
              >
                <span className="min-w-0 truncate">
                  {activeViewFilter.label}
                </span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>View</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={(value) => setViewFilter(value as ViewFilter)}
                value={viewFilter}
              >
                {viewFilterOptions.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                  >
                    <DropdownOptionLabel
                      count={
                        schools.filter((school) =>
                          matchesViewFilter(school, option.value),
                        ).length
                      }
                      label={option.label}
                    />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Choose school sort column"
                  className="min-w-0 justify-between"
                  variant="outline"
                >
                  <span className="min-w-0 truncate">
                    Sort: {activeSortColumn.label}
                  </span>
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  onValueChange={(value) =>
                    setSortState((current) =>
                      current.columnId === value
                        ? current
                        : { columnId: value as ColumnId, direction: "asc" },
                    )
                  }
                  value={sortState.columnId}
                >
                  {tableColumns.map((column) => (
                    <DropdownMenuRadioItem key={column.id} value={column.id}>
                      {column.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              aria-label={
                sortState.direction === "asc"
                  ? "Sort ascending"
                  : "Sort descending"
              }
              onClick={() =>
                setSortState((current) => ({
                  ...current,
                  direction: current.direction === "asc" ? "desc" : "asc",
                }))
              }
              variant="outline"
            >
              {sortState.direction === "asc" ? (
                <ArrowUp data-icon="inline-start" />
              ) : (
                <ArrowDown data-icon="inline-start" />
              )}
              {sortState.direction === "asc" ? "Asc" : "Desc"}
            </Button>
          </div>
        </div>
      </div>

      <SchoolsTable
        columnWidths={columnWidths}
        onColumnResizeKeyDown={handleColumnResizeKeyDown}
        onColumnResizeStart={handleColumnResizeStart}
        onOpenSchool={onOpenSchool}
        onSort={handleColumnSort}
        schools={sortedSchools}
        sortState={sortState}
        tableWidth={tableWidth}
      />

      <SchoolMobileList onOpenSchool={onOpenSchool} schools={sortedSchools} />
    </div>
  );
}
