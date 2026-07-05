import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type {
  Task,
  TaskAssignee,
  TaskCategory,
  TaskPriority,
  TaskStatus,
} from "@/domain/task"
import { createTimestamp } from "@/domain/time"
import {
  assigneeBadgeVariant,
  assigneeLabel,
  assigneeOptions,
  booleanOptions,
  categoryChipClass,
  categoryLabel,
  categoryOptions,
  priorityBadgeVariant,
  priorityLabel,
  priorityOptions,
  statusBadgeVariant,
  statusOptions,
} from "@/features/tasks/task-config"
import {
  formatPickerDate,
  mergeDateWithTime,
} from "@/features/tasks/task-dates"
import type { EditableTaskField } from "@/features/tasks/task-types"
import { cn } from "@/lib/utils"
import { CalendarIcon, CircleAlert, Sparkles, UserRound } from "lucide-react"

export function TaskAssigneeBadge({ task }: { task: Task }) {
  const needsCounselleInput = task.assignee === "counselle" && task.needs_input

  return (
    <Badge
      variant={
        needsCounselleInput ? "error" : assigneeBadgeVariant[task.assignee]
      }
    >
      {needsCounselleInput ? (
        <CircleAlert aria-hidden="true" />
      ) : task.assignee === "counselle" ? (
        <Sparkles aria-hidden="true" />
      ) : (
        <UserRound aria-hidden="true" />
      )}
      {needsCounselleInput
        ? "Counselle needs input"
        : assigneeLabel[task.assignee]}
    </Badge>
  )
}

export function TaskPropertyRow({
  children,
  editing,
  field,
  label,
  onEdit,
}: {
  children: ReactNode
  editing?: boolean
  field?: EditableTaskField
  label: string
  onEdit?: () => void
}) {
  return (
    <div
      className={cn(
        "group/property grid grid-cols-[7.25rem_minmax(0,1fr)] gap-3 border-b border-border/60 px-3 py-2.5 transition-colors last:border-b-0",
        field && "hover:bg-muted/15",
        field && onEdit && "cursor-text",
        editing && "bg-muted/20"
      )}
      onClick={(event) => {
        if (!field) {
          return
        }

        event.stopPropagation()
        onEdit?.()
      }}
    >
      <dt className="text-sm leading-5 text-muted-foreground/90">{label}</dt>
      <dd className="min-w-0 text-sm leading-5 text-foreground">{children}</dd>
    </div>
  )
}

export function TaskPropertyValue({
  children,
  className,
  muted = false,
  onEdit,
}: {
  children: ReactNode
  className?: string
  muted?: boolean
  onEdit: () => void
}) {
  return (
    <button
      className={cn(
        "-mx-1 flex min-h-6 w-full items-start rounded px-1 text-left leading-5 transition-colors outline-none hover:text-foreground focus-visible:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/35",
        muted && "text-muted-foreground/80",
        className
      )}
      onClick={(event) => {
        event.stopPropagation()
        onEdit()
      }}
      type="button"
    >
      {children}
    </button>
  )
}

export function TaskReadOnlyValue({
  children,
  muted = false,
}: {
  children: ReactNode
  muted?: boolean
}) {
  return (
    <span
      className={cn(
        "flex min-h-6 items-start leading-5",
        muted && "text-muted-foreground/80"
      )}
    >
      {children}
    </span>
  )
}

export function ReadableDate({
  emptyLabel = "Not set",
  value,
}: {
  emptyLabel?: string
  value?: string
}) {
  if (!value) {
    return <span className="text-muted-foreground">{emptyLabel}</span>
  }

  return (
    <span className="tabular-nums">
      {new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))}
    </span>
  )
}

export function TaskPropertySelect<TValue extends string>({
  onChange,
  options,
  renderOption,
  value,
}: {
  onChange: (value: TValue) => void
  options: readonly { label: string; value: TValue }[]
  renderOption?: (option: { label: string; value: TValue }) => ReactNode
  value: TValue
}) {
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0]

  return (
    <Select
      items={options}
      onValueChange={(nextValue) => onChange(nextValue as TValue)}
      value={value}
    >
      <SelectTrigger
        className="-mx-1 min-h-6 w-fit max-w-full min-w-0 justify-start gap-1.5 border-transparent !bg-transparent px-1 text-sm !shadow-none before:hidden hover:!bg-transparent focus-visible:ring-2 focus-visible:ring-ring/35 data-[popup-open]:!bg-transparent sm:min-h-6 dark:!bg-transparent dark:hover:!bg-transparent [&_[data-slot=select-icon]]:opacity-0 group-hover/property:[&_[data-slot=select-icon]]:opacity-45 data-[popup-open]:[&_[data-slot=select-icon]]:opacity-65"
        onClick={(event) => event.stopPropagation()}
        size="sm"
      >
        <SelectValue className="sr-only" />
        <span className="max-w-full min-w-0 truncate">
          {renderOption && selectedOption
            ? renderOption(selectedOption)
            : selectedOption?.label}
        </span>
      </SelectTrigger>
      <SelectPopup
        align="start"
        alignItemWithTrigger={false}
        className="min-w-44"
        side="bottom"
        sideOffset={5}
      >
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {renderOption ? renderOption(option) : option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  )
}

export function TaskDatePickerInput({
  autoFocus,
  clearable = true,
  defaultHour,
  defaultMinute,
  onChange,
  value,
}: {
  autoFocus?: boolean
  clearable?: boolean
  defaultHour: number
  defaultMinute: number
  onChange: (value: string | undefined) => void
  value?: string
}) {
  const [open, setOpen] = useState(autoFocus)
  const selectedDate = value ? new Date(value) : undefined

  useEffect(() => {
    if (!autoFocus) {
      return
    }

    window.requestAnimationFrame(() => {
      setOpen(true)
    })
  }, [autoFocus])

  function handleSelectDate(nextDate: Date | undefined) {
    if (!nextDate) {
      return
    }

    onChange(mergeDateWithTime(nextDate, value, defaultHour, defaultMinute))
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className="flex min-w-0 items-center gap-2"
        data-task-editing-field
        onClick={(event) => event.stopPropagation()}
      >
        <PopoverTrigger
          render={
            <Button
              className="h-7 min-w-0 justify-start px-2 text-left font-normal shadow-none"
              type="button"
              variant="outline"
            />
          }
        >
          <CalendarIcon data-icon="inline-start" />
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {formatPickerDate(value)}
          </span>
        </PopoverTrigger>
        {clearable && value ? (
          <Button
            onClick={() => onChange(undefined)}
            size="xs"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
        ) : null}
      </div>
      <PopoverPopup
        align="start"
        className="w-auto !transition-opacity !duration-100 !ease-out data-ending-style:!scale-100 data-starting-style:!scale-100"
        positionerClassName="!transition-none"
        sideOffset={6}
      >
        <Calendar
          mode="single"
          onSelect={handleSelectDate}
          selected={selectedDate}
        />
      </PopoverPopup>
    </Popover>
  )
}

export function TaskDetailSheet({
  onUpdateTask,
  onOpenChange,
  open,
  task,
}: {
  onUpdateTask: (
    taskId: string,
    patch: Partial<Task>,
    options?: { touch?: boolean }
  ) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  task?: Task
}) {
  const [focusedField, setFocusedField] = useState<EditableTaskField | null>(
    null
  )
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!focusedField) {
      return
    }

    function handleDocumentPointerDown(event: globalThis.PointerEvent) {
      const target = event.target

      if (
        target instanceof Element &&
        target.closest("[data-task-editing-field]")
      ) {
        return
      }

      setFocusedField(null)
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true)

    return () =>
      document.removeEventListener(
        "pointerdown",
        handleDocumentPointerDown,
        true
      )
  }, [focusedField])

  useEffect(() => {
    if (focusedField !== "notes") {
      return
    }

    window.requestAnimationFrame(() => {
      const textarea = notesTextareaRef.current

      if (!textarea) {
        return
      }

      const textLength = textarea.value.length
      textarea.focus()
      textarea.setSelectionRange(textLength, textLength)
    })
  }, [focusedField, task?.id])

  if (!task) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetPopup className="sm:max-w-[29rem]" side="right" variant="inset" />
      </Sheet>
    )
  }

  function updateTask(patch: Partial<Task>, options?: { touch?: boolean }) {
    if (!task) {
      return
    }

    onUpdateTask(task.id, patch, options)
  }

  function updateStatus(status: TaskStatus) {
    updateTask({
      completed_at:
        status === "done"
          ? (task?.completed_at ?? createTimestamp())
          : undefined,
      status,
    })
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.currentTarget.blur()
    }
  }

  function handleNotesKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.blur()
      setFocusedField(null)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setFocusedField(null)
    }

    onOpenChange(nextOpen)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetPopup className="sm:max-w-[29rem]" side="right" variant="inset">
        <SheetHeader className="pr-14">
          <SheetTitle className="sr-only">{task.title}</SheetTitle>
          <Input
            aria-label="Task title"
            className="-mx-2 border-transparent bg-transparent shadow-none before:hidden [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-2 [&_[data-slot=input]]:text-base [&_[data-slot=input]]:leading-6 [&_[data-slot=input]]:font-semibold"
            data-task-editing-field
            onBlur={() => setFocusedField(null)}
            onChange={(event) => updateTask({ title: event.target.value })}
            onFocus={() => setFocusedField("title")}
            onKeyDown={handleTitleKeyDown}
            unstyled
            value={task.title}
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge
              className={categoryChipClass[task.category]}
              variant="outline"
            >
              {categoryLabel[task.category]}
            </Badge>
            <Badge variant={priorityBadgeVariant[task.priority]}>
              {priorityLabel[task.priority]} priority
            </Badge>
            <TaskAssigneeBadge task={task} />
          </div>
        </SheetHeader>

        <SheetPanel>
          <dl className="overflow-hidden rounded-xl border bg-card shadow-xs/5">
            <TaskPropertyRow
              editing={focusedField === "notes"}
              field="notes"
              label="Notes"
              onEdit={() => setFocusedField("notes")}
            >
              {focusedField === "notes" ? (
                <div data-task-editing-field>
                  <Textarea
                    aria-label="Task notes"
                    autoFocus
                    className="block w-full [&_[data-slot=textarea]]:min-h-24 [&_[data-slot=textarea]]:resize-none [&_[data-slot=textarea]]:rounded-none [&_[data-slot=textarea]]:bg-transparent [&_[data-slot=textarea]]:px-0 [&_[data-slot=textarea]]:py-0 [&_[data-slot=textarea]]:leading-5"
                    onChange={(event) =>
                      updateTask({ notes: event.target.value || undefined })
                    }
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={handleNotesKeyDown}
                    placeholder="Add notes"
                    ref={notesTextareaRef}
                    unstyled
                    value={task.notes ?? ""}
                  />
                </div>
              ) : (
                <TaskPropertyValue
                  muted={!task.notes}
                  onEdit={() => setFocusedField("notes")}
                >
                  {task.notes ?? "Add notes"}
                </TaskPropertyValue>
              )}
            </TaskPropertyRow>
            <TaskPropertyRow field="status" label="Status">
              <TaskPropertySelect
                onChange={updateStatus}
                options={statusOptions}
                renderOption={(option) => (
                  <Badge
                    variant={statusBadgeVariant[option.value as TaskStatus]}
                  >
                    {option.label}
                  </Badge>
                )}
                value={task.status}
              />
            </TaskPropertyRow>
            <TaskPropertyRow field="category" label="Category">
              <TaskPropertySelect
                onChange={(category) => updateTask({ category })}
                options={categoryOptions}
                renderOption={(option) => {
                  const category = option.value as TaskCategory

                  return (
                    <Badge
                      className={categoryChipClass[category]}
                      variant="outline"
                    >
                      {option.label}
                    </Badge>
                  )
                }}
                value={task.category}
              />
            </TaskPropertyRow>
            <TaskPropertyRow field="priority" label="Priority">
              <TaskPropertySelect
                onChange={(priority) => updateTask({ priority })}
                options={priorityOptions}
                renderOption={(option) => {
                  const priority = option.value as TaskPriority

                  return (
                    <Badge variant={priorityBadgeVariant[priority]}>
                      {option.label}
                    </Badge>
                  )
                }}
                value={task.priority}
              />
            </TaskPropertyRow>
            <TaskPropertyRow field="assignee" label="Assignee">
              <TaskPropertySelect
                onChange={(assignee) => updateTask({ assignee })}
                options={assigneeOptions}
                renderOption={(option) => {
                  const assignee = option.value as TaskAssignee
                  const needsCounselleInput =
                    assignee === "counselle" && task.needs_input

                  return (
                    <Badge
                      variant={
                        needsCounselleInput
                          ? "error"
                          : assigneeBadgeVariant[assignee]
                      }
                    >
                      {needsCounselleInput ? (
                        <CircleAlert aria-hidden="true" />
                      ) : assignee === "counselle" ? (
                        <Sparkles aria-hidden="true" />
                      ) : (
                        <UserRound aria-hidden="true" />
                      )}
                      {needsCounselleInput
                        ? "Counselle needs input"
                        : option.label}
                    </Badge>
                  )
                }}
                value={task.assignee}
              />
            </TaskPropertyRow>
            <TaskPropertyRow field="needs_input" label="Needs input">
              <TaskPropertySelect
                onChange={(needsInput) =>
                  updateTask({ needs_input: needsInput === "true" })
                }
                options={booleanOptions}
                renderOption={(option) =>
                  option.value === "true" ? (
                    <Badge variant="error">
                      <CircleAlert aria-hidden="true" />
                      Yes
                    </Badge>
                  ) : (
                    <Badge variant="secondary">No</Badge>
                  )
                }
                value={task.needs_input ? "true" : "false"}
              />
            </TaskPropertyRow>
            <TaskPropertyRow
              editing={focusedField === "planned_for"}
              field="planned_for"
              label="Work on"
              onEdit={() => setFocusedField("planned_for")}
            >
              {focusedField === "planned_for" ? (
                <TaskDatePickerInput
                  autoFocus
                  defaultHour={9}
                  defaultMinute={0}
                  onChange={(planned_for) => updateTask({ planned_for })}
                  value={task.planned_for}
                />
              ) : (
                <TaskPropertyValue
                  muted={!task.planned_for}
                  onEdit={() => setFocusedField("planned_for")}
                >
                  <ReadableDate value={task.planned_for} />
                </TaskPropertyValue>
              )}
            </TaskPropertyRow>
            <TaskPropertyRow
              editing={focusedField === "due_at"}
              field="due_at"
              label="Due at"
              onEdit={() => setFocusedField("due_at")}
            >
              {focusedField === "due_at" ? (
                <TaskDatePickerInput
                  autoFocus
                  defaultHour={23}
                  defaultMinute={59}
                  onChange={(due_at) => updateTask({ due_at })}
                  value={task.due_at}
                />
              ) : (
                <TaskPropertyValue
                  muted={!task.due_at}
                  onEdit={() => setFocusedField("due_at")}
                >
                  <ReadableDate value={task.due_at} />
                </TaskPropertyValue>
              )}
            </TaskPropertyRow>
            <TaskPropertyRow
              editing={focusedField === "reminder_at"}
              field="reminder_at"
              label="Reminder at"
              onEdit={() => setFocusedField("reminder_at")}
            >
              {focusedField === "reminder_at" ? (
                <TaskDatePickerInput
                  autoFocus
                  defaultHour={9}
                  defaultMinute={0}
                  onChange={(reminder_at) => updateTask({ reminder_at })}
                  value={task.reminder_at}
                />
              ) : (
                <TaskPropertyValue
                  muted={!task.reminder_at}
                  onEdit={() => setFocusedField("reminder_at")}
                >
                  <ReadableDate value={task.reminder_at} />
                </TaskPropertyValue>
              )}
            </TaskPropertyRow>
            <TaskPropertyRow label="Completed at">
              <TaskReadOnlyValue muted={!task.completed_at}>
                <ReadableDate
                  emptyLabel="Not completed"
                  value={task.completed_at}
                />
              </TaskReadOnlyValue>
            </TaskPropertyRow>
            <TaskPropertyRow label="Created at">
              <TaskReadOnlyValue>
                <ReadableDate value={task.created_at} />
              </TaskReadOnlyValue>
            </TaskPropertyRow>
            <TaskPropertyRow label="Updated at">
              <TaskReadOnlyValue>
                <ReadableDate value={task.updated_at} />
              </TaskReadOnlyValue>
            </TaskPropertyRow>
          </dl>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  )
}
