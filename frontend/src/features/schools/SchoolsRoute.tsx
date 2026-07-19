import { ArrowDown, ArrowUp, ChevronDown, Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router"

import { PageHeader } from "@/components/workspace/PageHeader"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useApplications } from "@/api/workspace/hooks"
import { schoolFromApplication } from "@/domain/school"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { AddSchoolDialog } from "@/features/schools/AddSchoolDialog"
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

function SchoolsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  )
}

export function SchoolsPage() {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const applications = useApplications()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [addSchoolOpen, setAddSchoolOpen] = useState(false)
  const {
    columnWidths,
    handleColumnResizeKeyDown,
    handleColumnResizeStart,
    tableWidth,
  } = useColumnLayout()
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all")
  const [listTypeFilter, setListTypeFilter] = useState<ListTypeFilter>("all")
  const [sortState, setSortState] = useState<SortState>(defaultSortState)
  const activeSchoolId = searchParams.get("school")
  const schools = useMemo(
    () => (applications.data ?? []).map(schoolFromApplication),
    [applications.data],
  )

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

  useEffect(() => {
    if (activeSchoolId) {
      void navigate(`/app/schools/${activeSchoolId}`, { replace: true })
    }
  }, [activeSchoolId, navigate])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setAddSchoolOpen(true)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  function openSchool(schoolId: string) {
    void navigate(`/app/schools/${schoolId}`)
  }

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
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10"
        ref={scrollAreaRef}
      >
        <PageHeader
          actions={
            <Button
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setAddSchoolOpen(true)}
              variant="outline"
            >
              <Plus data-icon="inline-start" />
              Add school
            </Button>
          }
          title="Application workspace"
        />

        {applications.isLoading ? (
          <SchoolsSkeleton />
        ) : applications.isError ? (
          <div className="rounded-xl border bg-card p-6">
            <div className="max-w-md space-y-3">
              <h2 className="font-heading text-lg font-medium">
                Could not load schools
              </h2>
              <p className="text-sm text-muted-foreground">
                The workspace could not reach your applications list.
              </p>
              <Button onClick={() => void applications.refetch()}>
                Try again
              </Button>
            </div>
          </div>
        ) : schools.length === 0 ? (
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
            <EmptyContent>
              <Button onClick={() => setAddSchoolOpen(true)}>
                <Plus data-icon="inline-start" />
                Add your first school
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
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
                                matchesListTypeFilter(school, option.value),
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
              onOpenSchool={openSchool}
              onSort={handleColumnSort}
              schools={sortedSchools}
              sortState={sortState}
              tableWidth={tableWidth}
            />

            <SchoolMobileList
              onOpenSchool={openSchool}
              schools={sortedSchools}
            />
          </>
        )}
      </div>
      <WorkspaceScrollIndicator scrollAreaRef={scrollAreaRef} />
      <AddSchoolDialog
        onAdded={openSchool}
        onOpenChange={setAddSchoolOpen}
        open={addSchoolOpen}
      />
    </section>
  )
}
