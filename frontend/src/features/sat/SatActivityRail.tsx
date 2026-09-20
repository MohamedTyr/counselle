/**
 * The dashboard's Activity panel (plan §5.2; ui-spec §3.4; parity
 * F14-F17): calendar heatmap, streak, and today's progress.
 */
import { Flame } from "lucide-react";
import type React from "react";
import type { DayButtonProps } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SAT_DASHBOARD_COPY } from "@/features/sat/sat-copy";
import { formatHeatmapTooltip, formatPrepTime, formatStreak } from "@/features/sat/sat-format";
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

/** F14a: `0`, `<25%`, `<50%`, `<75%`, `>=75%` of the all-time daily max. */
const HEAT_BG_CLASS = [
  "bg-[var(--sat-heat-0)]",
  "bg-[var(--sat-heat-1)]",
  "bg-[var(--sat-heat-2)]",
  "bg-[var(--sat-heat-3)]",
  "bg-[var(--sat-heat-4)]",
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

function ActivitySkeleton(): React.ReactElement {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-64 w-full max-w-72" />
    </div>
  );
}

function makeDayButton(heatByDate: ReadonlyMap<string, number>, maxCount: number) {
  return function SatDayButton({
    day,
    modifiers,
    className,
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
              className,
              "cursor-default",
              HEAT_BG_CLASS[level],
              modifiers.today && "ring-1 ring-[var(--edge-strong)] ring-inset",
            )}
            data-heat={level}
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

export function SatActivityRail({
  stats,
  isLoading,
  isError,
  onRetry,
  today,
}: SatActivityRailProps): React.ReactElement {
  const heading = <h2 className="text-sm font-semibold">{SAT_DASHBOARD_COPY.activityHeading}</h2>;

  if (isError) {
    return (
      <div className="flex flex-col gap-4" data-slot="sat-activity-rail">
        {heading}
        <ErrorCard
          message={SAT_DASHBOARD_COPY.activityError.description}
          onRetry={onRetry}
          retryLabel={SAT_DASHBOARD_COPY.activityError.retry}
          title={SAT_DASHBOARD_COPY.activityError.title}
        />
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="flex flex-col gap-4" data-slot="sat-activity-rail">
        {heading}
        <ActivitySkeleton />
      </div>
    );
  }

  const heatmapEntries = Object.entries(stats.heatmap);
  const maxCount = Math.max(1, ...heatmapEntries.map(([, count]) => count));
  const heatByDate = new Map(heatmapEntries);
  const hasAnyPractice = stats.totalAttemptsCount > 0;

  return (
    <div className="flex flex-col gap-4" data-slot="sat-activity-rail">
      {heading}
      <Calendar
        components={{ DayButton: makeDayButton(heatByDate, maxCount) }}
        mode="single"
        showOutsideDays={false}
        today={today}
      />
      <div aria-hidden="true" className="flex items-center gap-2 text-xs text-[var(--ink-secondary)]">
        <span>{SAT_DASHBOARD_COPY.legendLess}</span>
        {HEAT_BG_CLASS.map((className, level) => (
          <span className={cn("size-3 rounded-sm", className)} key={level} />
        ))}
        <span>{SAT_DASHBOARD_COPY.legendMore}</span>
      </div>

      {!hasAnyPractice ? (
        <p className="text-sm text-[var(--ink-secondary)]">{SAT_DASHBOARD_COPY.noPracticeYet}</p>
      ) : (
        <>
          {stats.currentStreakDays > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <Flame aria-hidden="true" className="size-4" />
              <span className="tabular-nums">{formatStreak(stats.currentStreakDays)}</span>
            </div>
          )}
          <p className="text-sm tabular-nums text-[var(--ink-secondary)]">
            EBRW {stats.today.ebrwSolved} · Math {stats.today.mathSolved} ·{" "}
            {formatPrepTime(stats.today.totalTimeSeconds)}
          </p>
        </>
      )}
    </div>
  );
}
