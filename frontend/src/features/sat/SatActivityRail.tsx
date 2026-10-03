/**
 * The dashboard's Activity panel (plan §5.2; ui-spec §3.4; parity
 * F14-F17): the calendar heatmap on a light well, its legend, and today's
 * progress.
 */
import type React from "react";
import type { DayButtonProps } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SAT_DASHBOARD_COPY } from "@/features/sat/sat-copy";
import {
  formatHeatmapTooltip,
  formatPrepTime,
} from "@/features/sat/sat-format";
import type { SatStatsResponse } from "@/api/sat/types";

export interface SatActivityRailProps {
  stats: SatStatsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Captured once at mount by the dashboard (plan §4.4) so the "today"
   * ring never moves at midnight mid-visit. */
  today: Date;
}

/** F14a: `0`, `<25%`, `<50%`, `<75%`, `>=75%` of the all-time daily max. The
 * two darkest steps are solid brand fills and carry white numerals. */
const HEAT_BG_CLASS = [
  "bg-[var(--sat-heat-0)]",
  "bg-[var(--sat-heat-1)]",
  "bg-[var(--sat-heat-2)]",
  "bg-[var(--sat-heat-3)]",
  "bg-[var(--sat-heat-4)]",
] as const;

const HEAT_INK_CLASS = [
  "text-[var(--ink-faint)]",
  "text-[var(--ink)]",
  "text-[var(--ink)]",
  "text-[var(--on-brand)]",
  "text-[var(--on-brand)]",
] as const;

function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  const pct = count / max;
  if (pct < 0.25) return 1;
  if (pct < 0.5) return 2;
  if (pct < 0.75) return 3;
  return 4;
}

/** The device's local `YYYY-MM-DD` — matches `local_date` server-side (plan
 * §4.3). Exported so the dashboard can build the same key for `GET /stats`. */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The group label above the sheet, shared by every state of the rail. */
function ActivityHeading(): React.ReactElement {
  return (
    <h2 className="mb-2 flex h-7 items-center text-chrome font-semibold">
      {SAT_DASHBOARD_COPY.activityHeading}
    </h2>
  );
}

const SHEET_CLASS =
  "rounded-xl border border-[var(--hairline)] bg-[var(--surface-raised)] shadow-[var(--elevation-1)]";

function ActivitySkeleton(): React.ReactElement {
  return (
    <div aria-busy="true" className={cn(SHEET_CLASS, "p-4")}>
      <Skeleton className="h-6 w-32" />
      <div className="mt-3 grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }, (_, index) => (
          <Skeleton className="aspect-square rounded-lg" key={index} />
        ))}
      </div>
    </div>
  );
}

function makeDayButton(
  heatByDate: ReadonlyMap<string, number>,
  maxCount: number,
) {
  return function SatDayButton({
    day,
    modifiers,
    // Dropped on purpose: the default cell styling would repaint a heat step.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    className: _className,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    children: _children,
    ...props
  }: DayButtonProps): React.ReactElement {
    const key = toLocalDateKey(day.date);
    const count = heatByDate.get(key) ?? 0;
    const level = heatLevel(count, maxCount);
    const label = formatHeatmapTooltip(day.date, count);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            {...props}
            aria-label={label}
            className={cn(
              "relative flex aspect-square w-full cursor-default items-center justify-center rounded-lg text-xs tabular-nums outline-none",
              "transition-[box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none",
              // The day cells are a read-only picture of practice, not a date
              // picker; the default "today" dot would vanish on a dark step.
              "after:hidden!",
              HEAT_BG_CLASS[level],
              HEAT_INK_CLASS[level],
              modifiers.today &&
                "font-semibold ring-[1.5px] ring-[var(--ink)] ring-inset",
            )}
            data-heat={level}
            onClick={(event) => event.preventDefault()}
            type="button"
          >
            {day.date.getDate()}
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };
}

function HeatLegend(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-1.5 text-xs text-[var(--ink-faint)]"
    >
      <span>{SAT_DASHBOARD_COPY.legendLess}</span>
      {HEAT_BG_CLASS.map((className, level) => (
        <span
          className={cn(
            "size-3.5 rounded-[4px]",
            className,
            level === 0 && "ring-1 ring-[var(--hairline)] ring-inset",
          )}
          key={level}
        />
      ))}
      <span>{SAT_DASHBOARD_COPY.legendMore}</span>
    </div>
  );
}

function TodayFigure({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-[var(--ink-faint)]">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function SatActivityRail({
  stats,
  isLoading,
  isError,
  onRetry,
  today,
}: SatActivityRailProps): React.ReactElement {
  if (isError) {
    return (
      <section data-slot="sat-activity-rail">
        <ActivityHeading />
        <ErrorCard
          message={SAT_DASHBOARD_COPY.activityError.description}
          onRetry={onRetry}
          retryLabel={SAT_DASHBOARD_COPY.activityError.retry}
          title={SAT_DASHBOARD_COPY.activityError.title}
        />
      </section>
    );
  }

  if (isLoading || !stats) {
    return (
      <section data-slot="sat-activity-rail">
        <ActivityHeading />
        <ActivitySkeleton />
      </section>
    );
  }

  const heatmapEntries = Object.entries(stats.heatmap);
  const maxCount = Math.max(1, ...heatmapEntries.map(([, count]) => count));
  const heatByDate = new Map(heatmapEntries);
  const hasAnyPractice = stats.totalAttemptsCount > 0;

  return (
    <section data-slot="sat-activity-rail">
      <ActivityHeading />
      <div className={SHEET_CLASS}>
        <div className="flex flex-col gap-3 p-4">
          <Calendar
            className="w-full max-w-sm [--cell-size:2rem] sm:[--cell-size:2rem] [&_table]:w-full [&_table]:table-fixed"
            classNames={{
              day: "size-auto p-[2px]",
              weekday: "size-auto h-8 text-center",
            }}
            components={{ DayButton: makeDayButton(heatByDate, maxCount) }}
            mode="single"
            showOutsideDays={false}
            today={today}
          />
          <HeatLegend />
        </div>
        <div className="border-t border-[var(--hairline)] px-4 py-3">
          {hasAnyPractice ? (
            <div className="grid grid-cols-3 gap-3">
              <TodayFigure
                label="R&W today"
                value={String(stats.today.ebrwSolved)}
              />
              <TodayFigure
                label="Math today"
                value={String(stats.today.mathSolved)}
              />
              <TodayFigure
                label="Time today"
                value={formatPrepTime(stats.today.totalTimeSeconds)}
              />
            </div>
          ) : (
            <p className="text-sm text-[var(--ink-secondary)]">
              {SAT_DASHBOARD_COPY.noPracticeYet}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
