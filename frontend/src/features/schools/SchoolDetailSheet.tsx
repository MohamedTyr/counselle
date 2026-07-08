import { Archive, ExternalLink } from "lucide-react"
import { useReducedMotion } from "motion/react"
import { Link } from "react-router"

import {
  useApplication,
  useArchiveApplication,
  useRestoreApplication,
  useUpdateApplication,
} from "@/api/workspace/hooks"
import type {
  ApplicationPatch,
  ApplicationStatus,
  ListType,
  Round,
  TestPlan,
} from "@/api/workspace/types"
import { UndoToast } from "@/components/undo-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { schoolFromApplication } from "@/domain/school"
import {
  DeadlineValue,
  EssaysValue,
  ListTypeBadge,
  ProgressValue,
  SchoolLogo,
  StatusBadge,
} from "@/features/schools/school-cells"
import { useUndoableDelete } from "@/hooks/useUndoableDelete"

const statusOptions: ApplicationStatus[] = [
  "Considering",
  "Applying",
  "Submitted",
  "Deferred",
  "Accepted",
  "Enrolled",
  "Rejected",
  "Waitlisted",
  "Withdrawn",
]
const listTypeOptions: ListType[] = ["Reach", "Target", "Safety"]
const roundOptions: Round[] = ["EA", "ED", "ED2", "REA", "RD", "Rolling", "Priority"]
type TestPlanOption = TestPlan | "none"
const testPlanOptions: TestPlanOption[] = [
  "none",
  "submit",
  "withhold",
  "undecided",
]
const testPlanLabel: Record<TestPlanOption, string> = {
  none: "Not set",
  submit: "Submit scores",
  withhold: "Withhold scores",
  undecided: "Undecided",
}

function FieldSelect<TValue extends string>({
  label,
  onChange,
  options,
  value,
  getOptionLabel,
}: {
  label: string
  onChange: (value: TValue) => void
  options: TValue[]
  value: TValue
  getOptionLabel?: (option: TValue) => string
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
      {label}
      <Select onValueChange={(nextValue) => onChange(nextValue as TValue)} value={value}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {getOptionLabel ? getOptionLabel(option) : option}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  )
}

export function SchoolDetailSheet({
  onClose,
  open,
  schoolId,
}: {
  onClose: () => void
  open: boolean
  schoolId: string | null
}) {
  const detail = useApplication(schoolId)
  const updateApplication = useUpdateApplication()
  const archiveApplication = useArchiveApplication()
  const restoreApplication = useRestoreApplication()
  const reduceMotion = useReducedMotion()
  const application = detail.data?.application
  const school = application ? schoolFromApplication(application) : null
  const undo = useUndoableDelete({
    archiveMutation: archiveApplication,
    getLabel: () => school?.schoolName ?? "School",
    restoreMutation: restoreApplication,
  })

  function patchApplication(patch: ApplicationPatch) {
    if (!schoolId) {
      return
    }
    updateApplication.mutate({ id: schoolId, patch })
  }

  function archiveSchool() {
    if (!application) {
      return
    }
    undo.archive(application)
    onClose()
  }

  return (
    <>
      <Sheet onOpenChange={(nextOpen) => !nextOpen && onClose()} open={open}>
        <SheetPopup side="right" variant="inset">
          <SheetHeader>
            {school ? (
              <div className="flex min-w-0 items-start gap-3 pr-8">
                <SchoolLogo school={school} />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate">
                    {school.schoolName}
                  </SheetTitle>
                  <SheetDescription>{school.location}</SheetDescription>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 pr-8">
                <Skeleton className="size-10 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            )}
          </SheetHeader>

          <SheetPanel className="space-y-6">
            {detail.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : detail.isError || !application || !school ? (
              <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                Could not load this school.
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldSelect
                    label="Status"
                    onChange={(status) => patchApplication({ status })}
                    options={statusOptions}
                    value={application.status}
                  />
                  <FieldSelect
                    label="List type"
                    onChange={(list_type) => patchApplication({ list_type })}
                    options={listTypeOptions}
                    value={application.list_type}
                  />
                  <FieldSelect
                    label="Round"
                    onChange={(round) => patchApplication({ round })}
                    options={roundOptions}
                    value={application.round}
                  />
                  <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                    Deadline
                    <Input
                      nativeInput
                      onChange={(event) =>
                        patchApplication({
                          deadline: event.currentTarget.value || null,
                        })
                      }
                      type="date"
                      value={application.deadline ?? ""}
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Program & scores</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                      Intended major
                      <Input
                        nativeInput
                        onChange={(event) =>
                          patchApplication({
                            intended_major: event.currentTarget.value || null,
                          })
                        }
                        placeholder="e.g. Computer Science"
                        value={application.intended_major ?? ""}
                      />
                    </label>
                    <FieldSelect
                      getOptionLabel={(option) => testPlanLabel[option]}
                      label="Test plan"
                      onChange={(option) =>
                        patchApplication({
                          test_plan: option === "none" ? null : option,
                        })
                      }
                      options={testPlanOptions}
                      value={application.test_plan ?? "none"}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Financial aid</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                      Aid deadline
                      <Input
                        nativeInput
                        onChange={(event) =>
                          patchApplication({
                            aid_deadline: event.currentTarget.value || null,
                          })
                        }
                        type="date"
                        value={application.aid_deadline ?? ""}
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                      Scholarship deadline
                      <Input
                        nativeInput
                        onChange={(event) =>
                          patchApplication({
                            scholarship_deadline:
                              event.currentTarget.value || null,
                          })
                        }
                        type="date"
                        value={application.scholarship_deadline ?? ""}
                      />
                    </label>
                  </div>
                </div>

                <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                  Notes
                  <Textarea
                    onChange={(event) =>
                      patchApplication({
                        notes: event.currentTarget.value || null,
                      })
                    }
                    placeholder="Fit impressions, visit notes, portal URLs..."
                    value={application.notes ?? ""}
                  />
                </label>

                <div className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3">
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">
                      Status
                    </div>
                    <StatusBadge status={school.status} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">
                      List
                    </div>
                    <ListTypeBadge listType={school.listType} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">
                      Deadline
                    </div>
                    <DeadlineValue school={school} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">
                      Tasks
                    </div>
                    <ProgressValue progress={school.progress} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">
                      Essays
                    </div>
                    <EssaysValue essays={school.essays} />
                  </div>
                </div>

                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Linked tasks</h3>
                  {detail.data.tasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No tasks linked to this school yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.data.tasks.map((task) => (
                        <li
                          className="rounded-lg border bg-card p-3 text-sm"
                          key={task.id}
                        >
                          <Link
                            className="font-medium underline-offset-4 hover:underline"
                            to={`/app/tasks?task=${task.id}`}
                          >
                            {task.title}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {task.status}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Linked essays</h3>
                  {detail.data.essays.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No essays linked to this school yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.data.essays.map((essay) => (
                        <li
                          className="rounded-lg border bg-card p-3 text-sm"
                          key={essay.id}
                        >
                          <Link
                            className="font-medium underline-offset-4 hover:underline"
                            to={`/app/essays/${essay.id}`}
                          >
                            {essay.title}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {essay.status}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </SheetPanel>

          <SheetFooter>
            {school?.websiteUrl ? (
              <Button render={<a href={school.websiteUrl} rel="noreferrer" target="_blank" />} variant="outline">
                <ExternalLink data-icon="inline-start" />
                Website
              </Button>
            ) : null}
            <Button
              disabled={!application}
              onClick={archiveSchool}
              type="button"
              variant="destructive-outline"
            >
              <Archive data-icon="inline-start" />
              Archive
            </Button>
          </SheetFooter>
        </SheetPopup>
      </Sheet>

      <UndoToast
        onDismiss={undo.clearPending}
        onUndo={undo.undo}
        pending={undo.pending}
        reduceMotion={Boolean(reduceMotion)}
      />
    </>
  )
}
