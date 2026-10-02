// The rail (plan §2.6): a mini-month, then a Google-style calendar list. One
// component rendered in two places — the column beside the grid, and the
// header's `Calendars` popover when the grid needs that width back.
import { useState, type ReactNode } from "react";
import {
  Building2,
  CalendarClock,
  Circle,
  GraduationCap,
  LoaderCircle,
} from "lucide-react";

import type {
  CalendarRound,
  SchoolDeadlineCalendar,
} from "@/api/calendar/types";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { WEEK_STARTS_ON } from "@/features/calendar/calendar-grid";
import {
  CALENDAR_ROUND_ORDER,
  calendarRoundLabel,
  type CalendarLayers,
} from "@/features/calendar/calendar-items";
import { formatCycle } from "@/features/calendar/calendar-labels";
import type { LayerFlag } from "@/features/calendar/useCalendarLayers";
import { cn } from "@/lib/utils";

const COUNT = new Intl.NumberFormat("en-US");

const GLYPH = "size-3.5 shrink-0 text-[var(--ink-secondary)]";

/** The mini-month, restyled through its own class hooks rather than forked:
 * the selected day is a quiet pill and today the ink one, the same two marks
 * the main grid uses. */
const MINI_MONTH_CLASSES = {
  day_button: cn(
    "size-(--cell-size) rounded-full text-xs tabular-nums",
    "in-data-selected:bg-[var(--calendar-selected-date)] in-data-selected:text-[var(--ink)]",
    "in-data-selected:in-data-outside:text-[var(--ink-faint)]",
    "not-in-data-selected:hover:bg-[var(--canvas-hover)]",
  ),
  month_caption:
    "relative mx-(--cell-size) mb-1 flex h-(--cell-size) items-center justify-start ps-1",
  caption_label: "text-sm font-medium text-[var(--ink)]",
  nav: "absolute top-0 end-0 flex gap-0.5 z-1",
  today:
    "*:after:hidden [&>button]:bg-[var(--calendar-today-fill)] [&>button]:font-medium [&>button]:text-[var(--calendar-today-ink)] [&>button]:hover:bg-[var(--brand-hover)]",
  weekday:
    "size-(--cell-size) p-0 text-[11px] font-normal text-[var(--ink-faint)]",
};

function MiniMonth({
  anchor,
  onSelect,
}: {
  anchor: Date;
  onSelect: (day: Date) => void;
}) {
  // Browsing the mini-month never moves the main grid, and it snaps back to
  // the anchor's month whenever the anchor moves.
  const anchorMonth = `${anchor.getFullYear()}-${anchor.getMonth()}`;
  const [displayMonth, setDisplayMonth] = useState(anchor);
  const [shownFor, setShownFor] = useState(anchorMonth);
  if (shownFor !== anchorMonth) {
    setShownFor(anchorMonth);
    setDisplayMonth(anchor);
  }

  return (
    <Calendar
      className="p-0 [--cell-size:--spacing(8)] sm:[--cell-size:--spacing(8)]"
      classNames={MINI_MONTH_CLASSES}
      mode="single"
      month={displayMonth}
      onMonthChange={setDisplayMonth}
      onSelect={(day: Date | undefined) => day && onSelect(day)}
      required
      selected={anchor}
      weekStartsOn={WEEK_STARTS_ON}
    />
  );
}

function LayerRow({
  checked,
  glyph,
  label,
  onChange,
}: {
  checked: boolean;
  glyph: ReactNode;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="group/layer flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-[var(--ink)] transition-[background-color] duration-150 ease-out hover:bg-[var(--canvas-hover)] motion-reduce:transition-none">
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <span className="grid size-3.5 place-items-center">{glyph}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </label>
  );
}

function RoundToggles({
  onToggle,
  rounds,
}: {
  onToggle: (round: CalendarRound) => void;
  rounds: readonly CalendarRound[];
}) {
  return (
    <div
      aria-label="Rounds"
      className="flex flex-wrap gap-1 ps-[calc(--spacing(2)+--spacing(4)+--spacing(2.5))] pe-2"
      role="group"
    >
      {CALENDAR_ROUND_ORDER.map((round) => {
        const on = rounds.includes(round);
        return (
          <button
            aria-label={calendarRoundLabel(round, "long")}
            aria-pressed={on}
            className={cn(
              "inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium tabular-nums outline-none",
              "transition-[background-color,border-color,color,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none",
              "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              on
                ? "border-[var(--edge-button)] bg-[var(--surface-raised)] text-[var(--ink)] shadow-[var(--elevation-1)] hover:border-[var(--edge-button-strong)]"
                : "border-dashed border-[var(--edge-control-strong)] bg-transparent text-[var(--ink-faint)] hover:text-[var(--ink-secondary)]",
            )}
            key={round}
            onClick={() => onToggle(round)}
            type="button"
          >
            {calendarRoundLabel(round)}
          </button>
        );
      })}
    </div>
  );
}

export type SchoolDeadlinesState = {
  data: SchoolDeadlineCalendar | undefined;
  isPending: boolean;
};

export type CalendarRailProps = {
  anchor: Date;
  layers: CalendarLayers;
  onSelectDay: (day: Date) => void;
  onSetFlag: (flag: LayerFlag, value: boolean) => void;
  onToggleRound: (round: CalendarRound) => void;
  schoolDeadlines: SchoolDeadlinesState;
};

export function CalendarRail({
  anchor,
  layers,
  onSelectDay,
  onSetFlag,
  onToggleRound,
  schoolDeadlines,
}: CalendarRailProps) {
  const loadingAllSchools = layers.allSchools && schoolDeadlines.isPending;
  const coverage = schoolDeadlines.data;

  return (
    <div className="flex flex-col gap-5" data-calendar-rail="">
      <MiniMonth anchor={anchor} onSelect={onSelectDay} />

      <div className="flex flex-col gap-0.5">
        <h2 className="px-2 pb-1 text-xs font-medium text-[var(--ink-faint)]">
          My calendars
        </h2>
        <LayerRow
          checked={layers.tasks}
          glyph={
            <Circle aria-hidden="true" className={GLYPH} strokeWidth={2.25} />
          }
          label="Tasks"
          onChange={(value) => onSetFlag("tasks", value)}
        />
        <LayerRow
          checked={layers.due}
          glyph={<CalendarClock aria-hidden="true" className={GLYPH} />}
          label="Due dates"
          onChange={(value) => onSetFlag("due", value)}
        />
        <LayerRow
          checked={layers.mySchools}
          glyph={<GraduationCap aria-hidden="true" className={GLYPH} />}
          label="My schools"
          onChange={(value) => onSetFlag("mySchools", value)}
        />

        <div className="mx-2 my-2 h-px bg-[var(--hairline)]" />

        <LayerRow
          checked={layers.allSchools}
          glyph={
            loadingAllSchools ? (
              <LoaderCircle
                aria-label="Loading school deadlines"
                className="size-3 animate-spin text-[var(--ink-faint)] motion-reduce:animate-none"
              />
            ) : (
              <Building2 aria-hidden="true" className={GLYPH} />
            )
          }
          label="All schools"
          onChange={(value) => onSetFlag("allSchools", value)}
        />
        {layers.allSchools ? (
          <div className="flex flex-col gap-2 pt-1.5 pb-1">
            <RoundToggles
              onToggle={onToggleRound}
              rounds={layers.allSchoolsRounds}
            />
            {coverage ? (
              <p className="ps-[calc(--spacing(2)+--spacing(4)+--spacing(2.5))] pe-2 text-xs leading-4 text-[var(--ink-faint)]">
                Deadlines for{" "}
                <span className="tabular-nums">
                  {COUNT.format(coverage.schools_with_dates)}
                </span>{" "}
                of{" "}
                <span className="tabular-nums">
                  {COUNT.format(coverage.schools_total)}
                </span>{" "}
                schools · {formatCycle(coverage.reported_period)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <label className="flex h-8 cursor-pointer items-center justify-between gap-3 rounded-lg px-2 text-sm text-[var(--ink)] transition-[background-color] duration-150 ease-out hover:bg-[var(--canvas-hover)] motion-reduce:transition-none">
        Show completed
        <Switch
          checked={layers.showCompleted}
          onCheckedChange={(value) => onSetFlag("showCompleted", value)}
        />
      </label>
    </div>
  );
}
