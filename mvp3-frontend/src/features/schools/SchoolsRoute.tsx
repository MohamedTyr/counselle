import { ChevronDown, Plus } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { schools } from "@/fixtures/schools"
import {
  listTypeFilterOptions,
  viewFilterOptions,
} from "@/features/schools/schools-config"
import {
  filterSchools,
  isDeadlineSoon,
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
import { defaultSortState } from "@/features/schools/schools-config"
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

export function SchoolsPage() {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { columnWidths, tableWidth, handleColumnResizeStart } =
    useColumnLayout()
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all")
  const [listTypeFilter, setListTypeFilter] = useState<ListTypeFilter>("all")
  const [sortState, setSortState] = useState<SortState>(defaultSortState)

  const filteredSchools = useMemo(
    () => filterSchools(schools, viewFilter, listTypeFilter),
    [listTypeFilter, viewFilter]
  )
  const sortedSchools = useMemo(
    () => sortSchools(filteredSchools, sortState),
    [filteredSchools, sortState]
  )
  const submittedCount = schools.filter(
    (school) => school.status === "Submitted"
  ).length
  const deadlinesSoonCount = schools.filter(isDeadlineSoon).length
  const visibleSchoolsLabel =
    filteredSchools.length === 1
      ? "1 school shown"
      : `${filteredSchools.length} schools shown`
  const activeViewFilter =
    viewFilterOptions.find((option) => option.value === viewFilter) ??
    viewFilterOptions[0]

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

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        className="workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto py-6 pr-8 pl-6 md:pr-10"
        ref={scrollAreaRef}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm text-muted-foreground">Schools</p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Application workspace
            </h1>
            <p className="text-sm text-muted-foreground">
              {schools.length} schools, {submittedCount} submitted,{" "}
              {deadlinesSoonCount} deadlines in 30 days
            </p>
          </div>
          <Button variant="outline">
            <Plus data-icon="inline-start" />
            Add school
          </Button>
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
            </div>
          </div>
        </div>

        <SchoolsTable
          columnWidths={columnWidths}
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
