import {
  useEffect,
  useState,
  useRef,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Task } from "@/domain/task";
import type { UpdateTask } from "@/features/tasks/task-types";
import {
  assigneeBadgeVariant,
  assigneeLabel,
  assigneeOptions,
  booleanOptions,
  categoryChipClass,
  categoryOptions,
  priorityBadgeVariant,
  priorityOptions,
  statusBadgeVariant,
  statusOptions,
} from "@/features/tasks/task-config";
import {
  formatShortDate,
  getDueState,
  mergeDateWithTime,
} from "@/features/tasks/task-dates";
import { getTaskStatusPatch } from "@/features/tasks/task-mutations";
import { cn } from "@/lib/utils";
import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Sparkles,
  UserRound,
} from "lucide-react";

function stopTaskInlineEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function normalizeInlineText(value: string, multiline = false) {
  const text = value.replace(/\u00a0/g, " ");

  return multiline ? text.trim() : text.replace(/\s+/g, " ").trim();
}

function insertPlainTextAtSelection(value: string) {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  const textNode = document.createTextNode(value);

  range.deleteContents();
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function InlineTaskText({
  ariaLabel,
  className,
  emptyFallback,
  multiline = false,
  onCommit,
  value,
}: {
  ariaLabel: string;
  className?: string;
  emptyFallback?: string;
  multiline?: boolean;
  onCommit: (value: string | undefined) => void;
  value?: string;
}) {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const displayValue = value ?? "";

  useEffect(() => {
    const element = textRef.current;

    if (!element || document.activeElement === element) {
      return;
    }

    if (element.textContent !== displayValue) {
      element.textContent = displayValue;
    }
  }, [displayValue]);

  function commitValue(element: HTMLElement) {
    const normalizedValue = normalizeInlineText(
      element.textContent ?? "",
      multiline,
    );
    const nextValue = normalizedValue || emptyFallback;

    if (nextValue !== value) {
      onCommit(nextValue);
    }

    if (!normalizedValue && emptyFallback) {
      element.textContent = emptyFallback;
    }
  }

  function handleBlur(event: FocusEvent<HTMLSpanElement>) {
    commitValue(event.currentTarget);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    event.stopPropagation();

    if (event.key === "Enter" && (!multiline || !event.shiftKey)) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.textContent = displayValue;
      event.currentTarget.blur();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLSpanElement>) {
    event.preventDefault();
    insertPlainTextAtSelection(event.clipboardData.getData("text/plain"));
  }

  return (
    <span
      aria-label={ariaLabel}
      aria-multiline={multiline || undefined}
      className={cn(
        "-mx-1 rounded-md px-1 transition-[background-color,box-shadow] outline-none hover:bg-[var(--surface-hover)] focus:bg-[var(--surface-active)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
        className,
      )}
      contentEditable
      data-task-editing-field
      draggable={false}
      onBlur={handleBlur}
      onClick={stopTaskInlineEvent}
      onInput={stopTaskInlineEvent}
      onKeyDown={handleKeyDown}
      onMouseDown={stopTaskInlineEvent}
      onPaste={handlePaste}
      onPointerDown={stopTaskInlineEvent}
      ref={textRef}
      role="textbox"
      spellCheck
      suppressContentEditableWarning
      tabIndex={0}
    >
      {displayValue}
    </span>
  );
}

export function InlineTaskSelect<TValue extends string>({
  ariaLabel,
  onChange,
  options,
  popupClassName,
  renderOption,
  value,
}: {
  ariaLabel: string;
  onChange: (value: TValue) => void;
  options: readonly { label: string; value: TValue }[];
  popupClassName?: string;
  renderOption: (option: { label: string; value: TValue }) => ReactNode;
  value: TValue;
}) {
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <Select
      items={options}
      onValueChange={(nextValue) => onChange(nextValue as TValue)}
      value={value}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-auto min-h-0 w-fit min-w-0 rounded-md border-transparent !bg-transparent p-0 !shadow-none before:hidden hover:!bg-transparent focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] data-[popup-open]:!bg-transparent [&_[data-slot=select-icon]]:hidden"
        data-task-editing-field
        draggable={false}
        onClick={stopTaskInlineEvent}
        onKeyDown={stopTaskInlineEvent}
        onMouseDown={stopTaskInlineEvent}
        onPointerDown={stopTaskInlineEvent}
        size="sm"
      >
        <SelectValue className="sr-only" />
        {selectedOption ? renderOption(selectedOption) : null}
      </SelectTrigger>
      <SelectPopup
        align="start"
        alignItemWithTrigger={false}
        className={cn("min-w-44", popupClassName)}
        side="bottom"
        sideOffset={6}
      >
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {renderOption(option)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
}

export function InlineTaskStatusBadge({
  onUpdateTask,
  task,
}: {
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  return (
    <InlineTaskSelect
      ariaLabel={`Change status for ${task.title}`}
      onChange={(status) =>
        onUpdateTask(task.id, getTaskStatusPatch(task, status))
      }
      options={statusOptions}
      renderOption={(option) => (
        <Badge variant={statusBadgeVariant[option.value]}>{option.label}</Badge>
      )}
      value={task.status}
    />
  );
}

export function InlineTaskCategoryBadge({
  badgeClassName,
  onUpdateTask,
  task,
}: {
  badgeClassName?: string;
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  return (
    <InlineTaskSelect
      ariaLabel={`Change type for ${task.title}`}
      onChange={(category) => onUpdateTask(task.id, { category })}
      options={categoryOptions}
      renderOption={(option) => (
        <Badge
          className={cn(categoryChipClass[option.value], badgeClassName)}
          variant="outline"
        >
          {option.label}
        </Badge>
      )}
      value={task.category}
    />
  );
}

export function InlineTaskPriorityBadge({
  onUpdateTask,
  task,
}: {
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  return (
    <InlineTaskSelect
      ariaLabel={`Change priority for ${task.title}`}
      onChange={(priority) => onUpdateTask(task.id, { priority })}
      options={priorityOptions}
      renderOption={(option) => (
        <Badge variant={priorityBadgeVariant[option.value]}>
          {option.label}
        </Badge>
      )}
      value={task.priority}
    />
  );
}

export function InlineTaskAssigneeBadge({
  onUpdateTask,
  task,
}: {
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  return (
    <InlineTaskSelect
      ariaLabel={`Change assignee for ${task.title}`}
      onChange={(assignee) => onUpdateTask(task.id, { assignee })}
      options={assigneeOptions}
      renderOption={(option) => {
        const assignee = option.value;
        const needsCounselleInput =
          assignee === "counselle" && task.needs_input;

        return (
          <Badge
            variant={
              needsCounselleInput ? "error" : assigneeBadgeVariant[assignee]
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
              : assigneeLabel[assignee]}
          </Badge>
        );
      }}
      value={task.assignee}
    />
  );
}

export function InlineTaskNeedsInputBadge({
  onUpdateTask,
  task,
}: {
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  if (!task.needs_input || task.assignee === "counselle") {
    return null;
  }

  return (
    <InlineTaskSelect
      ariaLabel={`Change input need for ${task.title}`}
      onChange={(needsInput) =>
        onUpdateTask(task.id, { needs_input: needsInput === "true" })
      }
      options={booleanOptions}
      renderOption={(option) =>
        option.value === "true" ? (
          <Badge variant="error">
            <CircleAlert aria-hidden="true" />
            Needs input
          </Badge>
        ) : (
          <Badge variant="secondary">No input needed</Badge>
        )
      }
      value={task.needs_input ? "true" : "false"}
    />
  );
}

export function InlineTaskDate({
  ariaLabel,
  children,
  className,
  defaultHour,
  defaultMinute,
  field,
  onUpdateTask,
  task,
  value,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  defaultHour: number;
  defaultMinute: number;
  field: "due_at" | "planned_for" | "reminder_at";
  onUpdateTask: UpdateTask;
  task: Task;
  value?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = value ? new Date(value) : undefined;

  function handleSelectDate(nextDate: Date | undefined) {
    if (!nextDate) {
      return;
    }

    onUpdateTask(task.id, {
      [field]: mergeDateWithTime(nextDate, value, defaultHour, defaultMinute),
    });
    setOpen(false);
  }

  function handleClear(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onUpdateTask(task.id, { [field]: undefined });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span
        data-task-editing-field
        onClick={stopTaskInlineEvent}
        onMouseDown={stopTaskInlineEvent}
        onPointerDown={stopTaskInlineEvent}
      >
        <PopoverTrigger
          render={
            <button
              aria-label={ariaLabel}
              className={cn(
                "-mx-1 inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-md px-1 text-left whitespace-nowrap transition-[background-color,color,box-shadow] outline-none hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                className,
              )}
              draggable={false}
              onKeyDown={stopTaskInlineEvent}
              type="button"
            />
          }
        >
          {children}
        </PopoverTrigger>
      </span>
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
        {value ? (
          <div className="border-t px-2 py-2">
            <Button
              className="w-full justify-center"
              onClick={handleClear}
              size="sm"
              type="button"
              variant="ghost"
            >
              Clear
            </Button>
          </div>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

export function TaskDueMeta({
  onUpdateTask,
  task,
}: {
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  if (!task.due_at) {
    return null;
  }

  const dueState = getDueState(task);

  return (
    <InlineTaskDate
      ariaLabel={`Change due date for ${task.title}`}
      className={cn(
        "text-xs font-medium text-[color:var(--lane-muted)] tabular-nums",
        dueState === "soon" && "text-destructive",
        dueState === "overdue" && "text-destructive",
      )}
      defaultHour={23}
      defaultMinute={59}
      field="due_at"
      onUpdateTask={onUpdateTask}
      task={task}
      value={task.due_at}
    >
      <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
      <span>Due {formatShortDate(task.due_at)}</span>
    </InlineTaskDate>
  );
}

export function TaskTrailingMeta({
  isDone,
  onUpdateTask,
  task,
}: {
  isDone: boolean;
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  const statusMeta = isDone ? (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 text-xs text-[color:var(--lane-muted)]">
      <CheckCircle2 aria-hidden="true" className="size-3.5" />
      Done
    </span>
  ) : task.reminder_at ? (
    <InlineTaskDate
      ariaLabel={`Change reminder for ${task.title}`}
      className="shrink-0 text-xs text-[color:var(--lane-muted)] tabular-nums"
      defaultHour={9}
      defaultMinute={0}
      field="reminder_at"
      onUpdateTask={onUpdateTask}
      task={task}
      value={task.reminder_at}
    >
      <BellRing aria-hidden="true" className="size-4 shrink-0" />
      {formatShortDate(task.reminder_at)}
    </InlineTaskDate>
  ) : null;

  if (!task.due_at && !statusMeta) {
    return null;
  }

  return (
    <span className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <TaskDueMeta onUpdateTask={onUpdateTask} task={task} />
      {statusMeta}
    </span>
  );
}

export function TaskMetaRail({
  isDone,
  onUpdateTask,
  task,
}: {
  isDone: boolean;
  onUpdateTask: UpdateTask;
  task: Task;
}) {
  return (
    <div className="mt-2.5 flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <InlineTaskPriorityBadge onUpdateTask={onUpdateTask} task={task} />
        <InlineTaskAssigneeBadge onUpdateTask={onUpdateTask} task={task} />
        <InlineTaskNeedsInputBadge onUpdateTask={onUpdateTask} task={task} />
      </div>

      <TaskTrailingMeta
        isDone={isDone}
        onUpdateTask={onUpdateTask}
        task={task}
      />
    </div>
  );
}
