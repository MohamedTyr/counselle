import { AlertCircle, ArrowLeft, Check, Plus } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { useAddApplication, useSchoolSearch } from "@/api/workspace/hooks"
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
const roundOptions: Round[] = [
  "EA",
  "ED",
  "RD",
  "Rolling",
  "Priority",
  "Scholarship deadline",
]

function schoolLocation(school: SchoolSearchResult) {
  if (school.city && school.state) {
    return `${school.city}, ${school.state}`
  }

  return school.city ?? school.state ?? "Location unavailable"
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
  const debouncedQuery = useDebouncedValue(query, 250)
  const trimmedQuery = debouncedQuery.trim()
  const search = useSchoolSearch(trimmedQuery)
  const addApplication = useAddApplication()
  const isConfirmStep = selectedSchool !== null

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
                      disabled={school.on_list}
                      key={school.unitid}
                      onSelect={() => {
                        if (!school.on_list) {
                          setSelectedSchool(school)
                        }
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
                          On your list
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
