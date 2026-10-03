import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { Calendar } from "@/components/ui/calendar";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { getNowDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  schedulerOptions,
  type SchedulerOption,
} from "@/features/tasks/task-config";
import { getDateKey, parseDateOnly } from "@/features/tasks/task-dates";
import { Check, ChevronLeft } from "lucide-react";

type SchedulerField = "when_on" | "deadline_on";

type SchedulerPopoverProps = {
  value: string | undefined;
  field: SchedulerField;
  onChange: (value: string | null) => void;
  /** The trigger. Left out, `anchor` places the popover instead. */
  children?: ReactNode;
  /** Pins the popover to an element it does not own — the calendar opens a
   * task chip's deadline picker from its context menu this way. */
  anchor?: HTMLElement | null;
  /**
   * Optional controlled open state, for the one caller that opens this from
   * somewhere other than its own trigger — the row's `Deadline…` menu item,
   * whose trigger is a zero-size anchor (TaskRow). Left out, the popover owns
   * its own state exactly as before.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** The blur+fade duration for the list↔calendar swap (design doc §6.3). */
const CROSSFADE_MS = 120;
const CROSSFADE_MS_REDUCED = 100;

/** "Sep 4" — the resolved-date column next to each quick-pick row. */
function formatResolvedDate(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parseDateOnly(dateKey));
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * design doc §6, spec §5. One component for every place a date is shown or
 * set: row chip, quick-add hint, both detail-panel date rows, agent-proposed
 * dates.
 *
 * A single column of six rows, not the spec's 2×2 grid (deliberate
 * deviation, plan §P5.4 / design doc §6.2): each row carries its resolved
 * date and its shortcut key, which a grid cannot fit at 280px.
 */
export function SchedulerPopover({
  value,
  field,
  onChange,
  children,
  anchor,
  open: controlledOpen,
  onOpenChange,
}: SchedulerPopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [mode, setMode] = useState<"list" | "calendar">("list");
  const [transitioning, setTransitioning] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const referenceDate = getNowDate();
  const todayKey = getDateKey(referenceDate);
  const isDeadline = field === "deadline_on";
  const selectedDate = value ? parseDateOnly(value) : undefined;

  function clearResetTimeout() {
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
  }

  function swapTo(nextMode: "list" | "calendar") {
    clearResetTimeout();
    setTransitioning(true);
    setMode(nextMode);
    const duration = prefersReducedMotion()
      ? CROSSFADE_MS_REDUCED
      : CROSSFADE_MS;
    resetTimeoutRef.current = setTimeout(
      () => setTransitioning(false),
      duration,
    );
  }

  function handleOpenChange(nextOpen: boolean) {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) {
      // Reset to list mode after the exit transition so a re-open never
      // flashes the calendar.
      clearResetTimeout();
      resetTimeoutRef.current = setTimeout(() => {
        setMode("list");
        setTransitioning(false);
      }, 150);
    }
  }

  function selectOption(option: SchedulerOption) {
    if (option.id === "pickDate") {
      swapTo("calendar");
      return;
    }
    if (!option.resolveDate) {
      return;
    }
    onChange(option.resolveDate(referenceDate));
    handleOpenChange(false);
  }

  function handleCalendarSelect(nextDate: Date | undefined) {
    if (!nextDate) {
      return;
    }
    onChange(getDateKey(nextDate));
    handleOpenChange(false);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // Escape closes the whole popover — it never steps calendar → list.
      return;
    }
    const key = event.key.toLowerCase();
    const option = schedulerOptions.find((item) => item.shortcutKey === key);
    if (option) {
      event.preventDefault();
      selectOption(option);
    }
  }

  function isCurrentValue(option: SchedulerOption): boolean {
    if (option.id === "pickDate") {
      return false;
    }
    if (option.id === "anytime") {
      return !value;
    }
    if (!value || !option.resolveDate) {
      return false;
    }
    return option.resolveDate(referenceDate) === value;
  }

  // Most callers pass a real `<button>` as the trigger, but the deadline
  // picker's anchor (TaskRow) is a zero-size `<span>` with no tab stop by
  // design — telling Base UI it isn't a native button avoids the "expected a
  // native <button>" warning without changing that anchor's semantics.
  const isNativeButtonChild =
    Boolean(children) && (children as ReactElement).type === "button";

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      {children ? (
        <PopoverTrigger
          nativeButton={isNativeButtonChild}
          render={children as ReactElement}
        />
      ) : null}
      <PopoverPopup
        align="start"
        anchor={anchor}
        className={cn(
          "w-[280px] rounded-lg border-0 bg-[var(--surface-overlay)] p-0 shadow-[var(--elevation-2)]",
          "!duration-150 !ease-out data-ending-style:!duration-100",
          "data-starting-style:!scale-[0.97] data-ending-style:!scale-100",
          "motion-reduce:data-starting-style:!scale-100",
        )}
        sideOffset={6}
      >
        {mode === "list" ? (
          <div
            className={cn(
              "-m-4 p-1.5 transition-[filter,opacity] ease-out",
              transitioning && "opacity-0 blur-[2px] motion-reduce:blur-none",
            )}
            onKeyDown={handleListKeyDown}
            role="listbox"
            style={{
              transitionDuration: prefersReducedMotion()
                ? `${CROSSFADE_MS_REDUCED}ms`
                : `${CROSSFADE_MS}ms`,
            }}
          >
            {schedulerOptions.map((option, index) => {
              const showSeparator = option.id === "pickDate";
              const current = isCurrentValue(option);
              const label =
                isDeadline && option.deadlineLabel
                  ? option.deadlineLabel
                  : option.label;
              const showResolvedDate =
                option.id !== "today" &&
                option.id !== "pickDate" &&
                option.id !== "anytime" &&
                Boolean(option.resolveDate);
              const resolvedDate = showResolvedDate
                ? formatResolvedDate(
                    option.resolveDate!(referenceDate) ?? todayKey,
                  )
                : undefined;

              return (
                <div key={option.id}>
                  {showSeparator ? (
                    <div className="my-1.5 -mx-1.5 h-px bg-[var(--hairline)]" />
                  ) : null}
                  <button
                    aria-selected={current}
                    autoFocus={index === 0}
                    className={cn(
                      "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-left outline-none",
                      "hover:bg-[var(--surface-hover)] active:bg-[var(--surface-active)]",
                      "focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]",
                      current &&
                        "bg-[var(--brand-subtle)] text-[var(--brand-subtle-ink)]",
                    )}
                    onClick={() => selectOption(option)}
                    role="option"
                    type="button"
                  >
                    <span
                      className={cn(
                        "flex-1 text-chrome",
                        current
                          ? "text-[var(--brand-subtle-ink)]"
                          : "text-[var(--ink)]",
                      )}
                    >
                      {label}
                    </span>
                    {resolvedDate ? (
                      <span className="text-xs tabular-nums text-[var(--ink-faint)]">
                        {resolvedDate}
                      </span>
                    ) : null}
                    {current ? (
                      <Check aria-hidden="true" className="size-3.5 shrink-0" />
                    ) : (
                      <Kbd>{option.shortcutKey.toUpperCase()}</Kbd>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={cn(
              "p-2 transition-[filter,opacity] ease-out",
              transitioning && "opacity-0 blur-[2px] motion-reduce:blur-none",
            )}
            style={{
              transitionDuration: prefersReducedMotion()
                ? `${CROSSFADE_MS_REDUCED}ms`
                : `${CROSSFADE_MS}ms`,
            }}
          >
            <button
              className="flex h-7 items-center gap-1 rounded-md px-1 text-xs text-[var(--ink-faint)] outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]"
              onClick={() => swapTo("list")}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-3.5" />
              Back
            </button>
            <Calendar
              autoFocus
              mode="single"
              onSelect={handleCalendarSelect}
              selected={selectedDate}
            />
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}
