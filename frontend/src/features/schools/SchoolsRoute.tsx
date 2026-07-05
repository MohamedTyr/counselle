import { ArrowDown, ArrowUp, ChevronDown, Plus } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import type { School } from "@/domain/school"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import {
  defaultSortState,
  listTypeFilterOptions,
  tableColumns,
  viewFilterOptions,
} from "@/features/schools/schools-config"
import {
  filterSchools,
  matchesListTypeFilter,
  matchesViewFilter,
} from "@/features/schools/schools-filters"
import { SchoolMobileList } from "@/features/schools/SchoolMobileList"
import { SchoolsTable } from "@/features/schools/SchoolsTable"
import { sortSchools } from "@/features/schools/schools-sort"
import type {
  ColumnId,
  ListTypeFilter,
  SortState,
  ViewFilter,
} from "@/features/schools/schools-types"
import { useColumnLayout } from "@/features/schools/useColumnLayout"
import { WorkspaceScrollIndicator } from "@/features/schools/WorkspaceScrollIndicator"

function FilterTabLabel({ label, count }: { label: string; count: number }) {
  return (
    <>
      <span>{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </>
  )
}

function DropdownOptionLabel({
  label,
  count,
}: {
  label: string
  count: number
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
      <span>{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
    </span>
  )
}

export function SchoolsPage({ schools }: { schools: School[] }) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const {
    columnWidths,
    handleColumnResizeKeyDown,
    handleColumnResizeStart,
    tableWidth,
  } = useColumnLayout()
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all")
  const [listTypeFilter, setListTypeFilter] = useState<ListTypeFilter>("all")
  const [sortState, setSortState] = useState<SortState>(defaultSortState)

  const filteredSchools = useMemo(
    () => filterSchools(schools, viewFilter, listTypeFilter),
    [listTypeFilter, schools, viewFilter]
  )
  const sortedSchools = useMemo(
    () => sortSchools(filteredSchools, sortState),
    [filteredSchools, sortState]
  )
  const visibleSchoolsLabel =
    filteredSchools.length === 1
      ? "1 school shown"
      : `${filteredSchools.length} schools shown`
  const activeViewFilter =
    viewFilterOptions.find((option) => option.value === viewFilter) ??
    viewFilterOptions[0]
  const activeSortColumn =
    tableColumns.find((column) => column.id === sortState.columnId) ??
    tableColumns[0]

  function handleColumnSort(columnId: ColumnId) {
    setSortState((currentSortState) => {
      if (currentSortState.columnId !== columnId) {
        return { columnId, direction: "asc" }
      }

      return {
        columnId,
        direction: currentSortState.direction === "asc" ? "desc" : "asc",
      }
    })
  }

  function handleSortColumnSelect(columnId: ColumnId) {
    setSortState((currentSortState) => {
      if (currentSortState.columnId === columnId) {
        return currentSortState
      }

      return { columnId, direction: "asc" }
    })
  }

  function handleSortDirectionToggle() {
    setSortState((currentSortState) => ({
      ...currentSortState,
      direction: currentSortState.direction === "asc" ? "desc" : "asc",
    }))
  }

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        className="workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10"
        ref={scrollAreaRef}
      >
        <div className="relative -mx-6 flex items-center px-6 py-4 md:-mx-10 md:px-10">
          <div className="flex w-full flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-xl leading-none font-semibold tracking-tight">
                Application workspace
              </h1>
            </div>
            <Button variant="outline">
              <Plus data-icon="inline-start" />
              Add school
            </Button>
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 right-5 border-b"
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <Tabs
              aria-label="School list type filters"
              className="min-w-0"
              onValueChange={(value) =>
                setListTypeFilter(value as ListTypeFilter)
              }
              value={listTypeFilter}
            >
              <TabsList className="w-full flex-wrap justify-start gap-y-1 sm:w-fit">
                {listTypeFilterOptions.map((option) => (
                  <TabsTab
                    className="sm:h-7 sm:px-2 sm:text-xs"
                    key={option.value}
                    value={option.value}
                  >
                    <FilterTabLabel
                      count={
                        schools.filter(
                          (school) =>
                            matchesViewFilter(school, viewFilter) &&
                            matchesListTypeFilter(school, option.value)
                        ).length
                      }
                      label={option.label}
                    />
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between xl:justify-end">
              <span className="text-sm text-muted-foreground">
                {visibleSchoolsLabel}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="Choose application view filter"
                    className="w-full justify-between sm:w-auto"
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
                    onValueChange={(value) =>
                      setViewFilter(value as ViewFilter)
                    }
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
                              matchesViewFilter(school, option.value)
                            ).length
                          }
                          label={option.label}
                        />
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:hidden">
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
                        handleSortColumnSelect(value as ColumnId)
                      }
                      value={sortState.columnId}
                    >
                      {tableColumns.map((column) => (
                        <DropdownMenuRadioItem
                          key={column.id}
                          value={column.id}
                        >
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
                  onClick={handleSortDirectionToggle}
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
        </div>

        <SchoolsTable
          columnWidths={columnWidths}
          onColumnResizeKeyDown={handleColumnResizeKeyDown}
          onColumnResizeStart={handleColumnResizeStart}
          onSort={handleColumnSort}
          schools={sortedSchools}
          sortState={sortState}
          tableWidth={tableWidth}
        />

        <SchoolMobileList schools={sortedSchools} />
      </div>
      <WorkspaceScrollIndicator scrollAreaRef={scrollAreaRef} />
    </section>
  )
}
