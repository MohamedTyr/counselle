import { AlertCircle, ArrowLeft, Check, Plus } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { requestJson } from "@/api/http/client"
import {
  useAddApplication,
  useApplications,
  useSchoolSearch,
} from "@/api/workspace/hooks"
import type {
  ListType,
  Round,
  SchoolSearchResult,
} from "@/api/workspace/types"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SchoolAvatar } from "@/features/schools/school-cells"

const listTypeOptions: ListType[] = ["Reach", "Target", "Safety"]
const roundOptions: Round[] = ["EA", "ED", "ED2", "REA", "RD", "Rolling", "Priority"]
const MIN_CYCLE_YEAR = 2020
const MAX_CYCLE_YEAR = 2100

function validCycleYear(value: number) {
  return Number.isFinite(value) && Number.isInteger(value) && value >= MIN_CYCLE_YEAR && value <= MAX_CYCLE_YEAR
}

function schoolLocation(school: SchoolSearchResult) {
  if (school.city && school.state) {
    return `${school.city}, ${school.state}`
  }

  return school.city ?? school.state ?? "Location unavailable"
}

function trackedCycleLabel(school: SchoolSearchResult) {
  if (school.active_cycle_years.length > 0) {
    const cycles = school.active_cycle_years
      .map((year) => `${year - 1}-${String(year).slice(-2)}`)
      .join(", ")
    return `Tracked for ${cycles} · choose a cycle`
  }
  if (school.has_legacy_application) {
    return "Tracked with an unconfirmed cycle · choose a cycle"
  }
  return "Tracked in your workspace · choose a cycle"
}

function useDebouncedValue(value: string, delayMs: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs)
    return () => window.clearTimeout(timeout)
  }, [delayMs, value])

  return debouncedValue
}

export function AddSchoolDialog({
  onAdded,
  onOpenChange,
  open,
}: {
  onAdded?: (applicationId: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [query, setQuery] = useState("")
  const [selectedSchool, setSelectedSchool] =
    useState<SchoolSearchResult | null>(null)
  const [listType, setListType] = useState<ListType>("Target")
  const [round, setRound] = useState<Round>("RD")
  const [deadline, setDeadline] = useState("")
  const [cycleYear, setCycleYear] = useState<string | null>(null)
  const cycleConfig = useQuery({
    queryKey: ["config", "current-admissions-cycle"],
    queryFn: () => requestJson<{ current_admissions_cycle_year?: number }>("/config"),
  })
  const defaultCycleYear = validCycleYear(cycleConfig.data?.current_admissions_cycle_year ?? NaN)
    ? cycleConfig.data!.current_admissions_cycle_year!
    : null
  const effectiveCycleYear = cycleYear ?? (defaultCycleYear ? String(defaultCycleYear) : "")
  const debouncedQuery = useDebouncedValue(query, 250)
  const trimmedQuery = debouncedQuery.trim()
  const search = useSchoolSearch(trimmedQuery)
  const applications = useApplications()
  const addApplication = useAddApplication()
  const isConfirmStep = selectedSchool !== null
  const selectedCycleYear = Number(effectiveCycleYear)
  const isCycleYearValid = validCycleYear(selectedCycleYear)
  const isDuplicateCycle = Boolean(
    selectedSchool &&
      selectedCycleYear &&
      applications.data?.some(
        (application) =>
          application.school_unitid === selectedSchool.unitid &&
          application.cycle_year === selectedCycleYear,
      ),
  )

  const searchResults = useMemo(
    () => search.data ?? [],
    [search.data],
  )

  function resetDialog() {
    setQuery("")
    setSelectedSchool(null)
    setListType("Target")
    setRound("RD")
    setDeadline("")
    setCycleYear(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDialog()
    }
    onOpenChange(nextOpen)
  }

  async function confirmAdd() {
    if (!selectedSchool) {
      return
    }

    try {
      const result = await addApplication.mutateAsync({
        cycle_year: selectedCycleYear,
        deadline: deadline || null,
        list_type: listType,
        optimisticSchool: selectedSchool,
        round,
        unitid: selectedSchool.unitid,
      })
      toast.success(`${result.application.school_name} added`)
      resetDialog()
      onOpenChange(false)
      onAdded?.(result.application.id)
    } catch {
      // The workspace mutation hook owns rollback and error toast behavior.
    }
  }

  return (
    <CommandDialog
      className="sm:max-w-xl"
      description="Search colleges and add one to your application workspace."
      onOpenChange={handleOpenChange}
      open={open}
      showCloseButton
      title="Add school"
    >
      {isConfirmStep ? (
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-start gap-3">
            <SchoolAvatar
              name={selectedSchool.name}
              websiteUrl={selectedSchool.website_url}
            />
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-base font-medium">
                {selectedSchool.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {schoolLocation(selectedSchool)}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              List type
              <Select
                onValueChange={(value) => setListType(value as ListType)}
                value={listType}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {listTypeOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>

            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
              Round
              <Select
                onValueChange={(value) => setRound(value as Round)}
                value={round}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {roundOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          </div>

          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
            Deadline
            <Input
              nativeInput
              onChange={(event) => setDeadline(event.currentTarget.value)}
              type="date"
              value={deadline}
            />
          </label>

          {isDuplicateCycle ? (
            <p className="text-sm text-destructive" role="alert">
              This school is already in your workspace for the {selectedCycleYear - 1}-{String(selectedCycleYear).slice(-2)} cycle.
            </p>
          ) : null}

          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
            Fall enrollment year
            <Input
              aria-label="Fall enrollment year"
              nativeInput
              max={MAX_CYCLE_YEAR}
              min={MIN_CYCLE_YEAR}
              onChange={(event) => setCycleYear(event.currentTarget.value)}
              placeholder="e.g. 2027"
              required
              type="number"
              value={effectiveCycleYear}
            />
            <span className="text-xs font-normal text-muted-foreground">
              This selects the correct admissions-cycle catalog. It cannot be guessed safely.
            </span>
            {effectiveCycleYear && !isCycleYearValid ? <span className="text-xs font-normal text-destructive">Enter a whole year from {MIN_CYCLE_YEAR} to {MAX_CYCLE_YEAR}.</span> : null}
          </label>

          <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-muted/50 p-4 sm:flex-row sm:justify-between">
            <Button
              onClick={() => setSelectedSchool(null)}
              type="button"
              variant="outline"
            >
              <ArrowLeft data-icon="inline-start" />
              Back
            </Button>
            <Button
              disabled={!isCycleYearValid || isDuplicateCycle}
              loading={addApplication.isPending}
              onClick={() => void confirmAdd()}
              type="button"
            >
              <Plus data-icon="inline-start" />
              Add school
            </Button>
          </div>
        </div>
      ) : (
        <Command shouldFilter={false}>
          <CommandInput
            onValueChange={setQuery}
            placeholder="Search for a school..."
            value={query}
          />
          <CommandList>
            {search.isError ? (
              <div
                className="flex flex-col items-center gap-3 px-6 py-8 text-center text-sm"
                role="alert"
              >
                <AlertCircle className="size-5 text-destructive" />
                <div>
                  <p className="font-medium">Could not search schools.</p>
                  <p className="text-muted-foreground">
                    The school search request failed. Try again.
                  </p>
                </div>
                <Button
                  onClick={() => void search.refetch()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Retry
                </Button>
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {trimmedQuery
                    ? search.isFetching
                      ? "Searching..."
                      : "No schools found."
                    : "Type a school name to search."}
                </CommandEmpty>
                <CommandGroup heading={trimmedQuery ? "Results" : undefined}>
                  {searchResults.map((school) => (
                    <CommandItem
                      disabled={false}
                      key={school.unitid}
                      onSelect={() => {
                        setSelectedSchool(school)
                      }}
                      value={`${school.name} ${schoolLocation(school)}`}
                    >
                      <SchoolAvatar name={school.name} websiteUrl={school.website_url} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium">{school.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {schoolLocation(school)}
                        </span>
                      </span>
                      {school.on_list ? (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {trackedCycleLabel(school)}
                        </span>
                      ) : (
                        <Check className="ml-auto opacity-0" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      )}
    </CommandDialog>
  )
}
