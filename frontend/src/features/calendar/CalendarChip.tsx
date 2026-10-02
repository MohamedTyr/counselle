// One chip anatomy for four kinds of item (plan §2.2), told apart by form —
// fill, a dashed outline, weight and a glyph — never by hue. Hue appears only
// as state, in the same forms the Tasks page's deadline chip uses.
//
// No control is ever nested in another: deadline, due and aggregate chips are a
// single <button>; a task chip is a plain <div> holding two siblings, its done
// circle and its title (`role="button"`), the same split TaskRow makes.
import {
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import {
  Building2,
  CalendarClock,
  Check,
  CircleAlert,
  Flag,
} from "lucide-react";

import { useCalendarContext } from "@/features/calendar/calendar-context";
import {
  getItemState,
  type CalendarItem,
  type CalendarItemState,
} from "@/features/calendar/calendar-items";
import {
  chipAccessibleName,
  chipSubtitle,
  chipText,
} from "@/features/calendar/calendar-labels";
import { SchoolFavicon } from "@/features/schools/school-cells";
import { TaskRowContextMenu } from "@/features/tasks/TaskRowMenu";
import {
  addDays,
  getDateKey,
  getDeadlineState,
  parseDateOnly,
} from "@/features/tasks/task-dates";
import { cn } from "@/lib/utils";

export type ChipDensity = "compact" | "comfortable";

const CHIP_BASE = cn(
  "group/chip relative flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-left text-xs outline-none select-none",
  "transition-[background-color,opacity] duration-150 ease-out motion-reduce:transition-none",
  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset",
  "has-[[data-calendar-focus]:focus-visible]:ring-2 has-[[data-calendar-focus]:focus-visible]:ring-[var(--focus-ring)] has-[[data-calendar-focus]:focus-visible]:ring-inset",
  "data-[dragging]:opacity-50",
);

const DENSITY: Record<ChipDensity, string> = {
  comfortable: "min-h-7 items-start py-1",
  compact:
    "h-[var(--calendar-chip-height)] pointer-coarse:h-[var(--calendar-chip-height-touch)]",
};

const GLYPH = "size-[var(--calendar-glyph-box)] shrink-0";

/** Fill, ink and hover for a deadline-shaped chip in each state. */
function stateSurface(state: CalendarItemState, filled: boolean): string {
  switch (state) {
    case "overdue":
      return "bg-[var(--danger-surface)] text-[var(--danger-fg)] hover:bg-[var(--calendar-danger-hover)]";
    case "due-soon":
      return "bg-[var(--warning-surface)] text-[var(--warning-fg)] hover:bg-[var(--calendar-warning-hover)]";
    case "submitted":
    case "passed":
      return "bg-[var(--calendar-school-fill)] text-[var(--ink-faint)] hover:bg-[var(--calendar-school-hover)]";
    case "done":
      return cn(
        "text-[var(--calendar-done-ink)]",
        filled
          ? "bg-[var(--calendar-school-fill)] hover:bg-[var(--calendar-school-hover)]"
          : "hover:bg-[var(--calendar-task-hover)]",
      );
    case "normal":
      return filled
        ? "bg-[var(--calendar-school-fill)] text-[var(--calendar-school-ink)] hover:bg-[var(--calendar-school-hover)]"
        : "text-[var(--ink)] hover:bg-[var(--calendar-task-hover)]";
  }
}

function ChipLabel({
  density,
  done,
  item,
  subtitle,
}: {
  density: ChipDensity;
  done: boolean;
  item: CalendarItem;
  subtitle?: string;
}) {
  const { name, suffix } = chipText(item);
  const title = suffix ? `${name} ${suffix}` : name;
  const comfortable = density === "comfortable";
  // Comfortable (Week) chips give a school's name both lines to wrap in and
  // move the round down beside the subtitle, so a narrow column never splits
  // a word to make room for "· ED". A count ("94 · RD") keeps it inline.
  const suffixBelow = comfortable && Boolean(suffix) && !/^\d+$/.test(name);
  const meta = comfortable
    ? [suffixBelow ? suffix?.replace(/^·\s*/, "") : undefined, subtitle]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <span
      aria-hidden="true"
      className="flex min-w-0 flex-1 flex-col"
      title={title}
    >
      <span className="flex min-w-0 items-baseline gap-1">
        <span
          className={cn(
            "min-w-0",
            comfortable ? "line-clamp-2 hyphens-auto break-words" : "truncate",
            done && "line-through decoration-[var(--calendar-done-ink)]",
            item.kind === "aggregate" &&
              item.schools.length > 1 &&
              "tabular-nums",
          )}
        >
          {name}
        </span>
        {suffix && !suffixBelow ? (
          <span className="shrink-0">{suffix}</span>
        ) : null}
      </span>
      {meta ? (
        <span className="truncate text-xs font-normal text-[var(--ink-faint)]">
          {meta}
        </span>
      ) : null}
    </span>
  );
}

function DeadlineGlyph({
  item,
  state,
}: {
  item: CalendarItem;
  state: CalendarItemState;
}) {
  if (item.kind === "school") {
    return (
      <SchoolFavicon
        className={GLYPH}
        size={14}
        websiteUrl={item.application.website_url}
      />
    );
  }
  if (item.kind === "aggregate") {
    return item.schools.length === 1 ? (
      <SchoolFavicon
        className={GLYPH}
        size={14}
        websiteUrl={item.schools[0].website_url}
      />
    ) : (
      <Building2 aria-hidden="true" className={GLYPH} />
    );
  }
  if (state === "overdue") {
    return <CircleAlert aria-hidden="true" className={GLYPH} />;
  }
  return (
    <CalendarClock
      aria-hidden="true"
      className={cn(GLYPH, state === "normal" && "text-[var(--ink-faint)]")}
    />
  );
}

function useChipDrag(item: CalendarItem) {
  const ctx = useCalendarContext();
  const [dragging, setDragging] = useState(false);
  const payload =
    item.kind === "task"
      ? { field: "when_on" as const, fromDay: item.date, taskId: item.task.id }
      : item.kind === "due" && "task" in item.source
        ? {
            field: "deadline_on" as const,
            fromDay: item.date,
            taskId: item.source.task.id,
          }
        : null;

  if (!payload || !ctx.canDrag) {
    return { dragProps: {}, payload };
  }

  return {
    payload,
    dragProps: {
      "data-dragging": dragging || undefined,
      draggable: true,
      onDragEnd: () => {
        setDragging(false);
        ctx.drag.end();
      },
      onDragStart: (event: DragEvent<HTMLElement>) => {
        ctx.drag.start(payload);
        // Firefox will not start a drag without data.
        event.dataTransfer.setData("text/plain", payload.taskId);
        event.dataTransfer.effectAllowed = "move";
        setDragging(true);
      },
    },
  };
}

export function CalendarChip({
  density = "compact",
  item,
  tabbable = false,
}: {
  density?: ChipDensity;
  item: CalendarItem;
  /** Inside the grid only the focused cell is a tab stop; in a list (the day
   * popover) every chip is. */
  tabbable?: boolean;
}) {
  const ctx = useCalendarContext();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { dragProps, payload } = useChipDrag(item);
  const state = getItemState(item, ctx.today);
  const done = state === "done";
  const name = chipAccessibleName(item, ctx.today);
  const subtitle =
    density === "comfortable" ? chipSubtitle(item, ctx, ctx.today) : undefined;
  const tabIndex = tabbable ? 0 : -1;

  function handleMoveKeys(event: KeyboardEvent<HTMLElement>) {
    if (!payload || !event.altKey) {
      return false;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const shift = event.key === "ArrowLeft" ? -1 : 1;
    const toDay = getDateKey(addDays(parseDateOnly(item.date), shift));
    ctx.moveTask(payload, toDay, "keyboard");
    return true;
  }

  if (item.kind === "task") {
    const task = item.task;
    const dueState = item.isAlsoDue
      ? getDeadlineState(item.date, ctx.today)
      : null;
    return (
      <TaskRowContextMenu
        actions={ctx.actions}
        onPickDeadline={() =>
          rootRef.current && ctx.openDeadlinePicker(task.id, rootRef.current)
        }
        task={task}
      >
        <div
          {...dragProps}
          className={cn(
            CHIP_BASE,
            DENSITY[density],
            "cursor-pointer gap-1.5 font-normal",
            stateSurface(done ? "done" : "normal", false),
            "data-[state=open]:bg-[var(--calendar-task-hover)]",
          )}
          data-calendar-chip=""
          data-chip-key={item.key}
          ref={rootRef}
        >
          <button
            aria-label={
              done
                ? `Mark “${task.title}” as not done`
                : `Mark “${task.title}” as done`
            }
            aria-pressed={done}
            className={cn(
              // 1.5px: the Tasks page's done circle, scaled to a 12px chip.
              "relative grid size-3 shrink-0 place-items-center rounded-full border-[1.5px] outline-none",
              "transition-[background-color,border-color] duration-150 ease-out motion-reduce:transition-none",
              "after:absolute after:-inset-1 pointer-coarse:after:-inset-2.5",
              density === "comfortable" && "mt-0.5",
              done
                ? "border-[var(--calendar-done-ink)] bg-[var(--calendar-done-ink)] text-[var(--on-brand)]"
                : "border-[var(--ink-faint)] hover:border-[var(--ink-secondary)] hover:bg-[var(--surface-inset)]",
            )}
            onClick={(event) => {
              event.stopPropagation();
              ctx.actions.onComplete(task.id, !done);
            }}
            tabIndex={-1}
            type="button"
          >
            {done ? (
              <Check aria-hidden="true" className="size-2" strokeWidth={3} />
            ) : null}
          </button>
          <div
            aria-label={name}
            className="flex min-w-0 flex-1 items-center gap-1 outline-none"
            data-calendar-focus=""
            onClick={(event) => {
              event.stopPropagation();
              ctx.actions.onOpen(task.id);
            }}
            onKeyDown={(event) => {
              if (handleMoveKeys(event)) {
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                ctx.actions.onOpen(task.id);
              } else if (event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                ctx.actions.onComplete(task.id, !done);
              }
            }}
            aria-keyshortcuts="Space"
            role="button"
            tabIndex={tabIndex}
          >
            <ChipLabel
              density={density}
              done={done}
              item={item}
              subtitle={subtitle}
            />
            {task.flagged ? (
              <Flag
                aria-hidden="true"
                className="size-2.5 shrink-0 text-[var(--task-flag-ink)]"
                fill="currentColor"
              />
            ) : null}
            {dueState && !done ? (
              <CalendarClock
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0",
                  dueState === "overdue"
                    ? "text-[var(--danger-fg)]"
                    : dueState === "due-soon"
                      ? "text-[var(--warning-fg)]"
                      : "text-[var(--ink-faint)]",
                )}
              />
            ) : null}
          </div>
        </div>
      </TaskRowContextMenu>
    );
  }

  const filled = item.kind === "school";
  const isAggregate = item.kind === "aggregate";

  function activate() {
    const anchor = buttonRef.current;
    if (!anchor) {
      return;
    }
    if (item.kind === "due") {
      if ("task" in item.source) {
        ctx.actions.onOpen(item.source.task.id);
      } else {
        ctx.openEssay(item.source.essay.id);
      }
      return;
    }
    if (item.kind === "aggregate" && item.schools.length > 1) {
      ctx.openDayPanel({ day: item.date, round: item.round });
      return;
    }
    ctx.openDeadline(item, anchor);
  }

  const chip: ReactElement = (
    <button
      {...dragProps}
      aria-label={name}
      className={cn(
        CHIP_BASE,
        DENSITY[density],
        "cursor-pointer font-medium",
        isAggregate
          ? "border border-dashed border-[var(--calendar-aggregate-edge)] text-[var(--ink-secondary)] hover:bg-[var(--calendar-task-hover)]"
          : stateSurface(state, filled),
        "data-[popup-open]:bg-[var(--calendar-task-hover)]",
      )}
      data-calendar-chip=""
      data-calendar-focus=""
      data-chip-key={item.key}
      onClick={(event) => {
        event.stopPropagation();
        activate();
      }}
      onKeyDown={(event) => {
        if (handleMoveKeys(event)) {
          return;
        }
        if (event.key === " " && payload) {
          event.preventDefault();
          event.stopPropagation();
          ctx.actions.onComplete(payload.taskId, !done);
        }
      }}
      ref={buttonRef}
      tabIndex={tabIndex}
      type="button"
    >
      <DeadlineGlyph item={item} state={state} />
      <ChipLabel
        density={density}
        done={done}
        item={item}
        subtitle={subtitle}
      />
      {state === "submitted" ? (
        <Check
          aria-hidden="true"
          className="size-3 shrink-0 text-[var(--success-fg)]"
          strokeWidth={2.5}
        />
      ) : null}
    </button>
  );

  if (item.kind === "due" && "task" in item.source) {
    const task = item.source.task;
    return (
      <TaskRowContextMenu
        actions={ctx.actions}
        onPickDeadline={() =>
          buttonRef.current &&
          ctx.openDeadlinePicker(task.id, buttonRef.current)
        }
        task={task}
      >
        {chip}
      </TaskRowContextMenu>
    );
  }
  return chip;
}
