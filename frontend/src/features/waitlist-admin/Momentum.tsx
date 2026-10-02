import type React from "react";
import { Bar, BarChart, Tooltip, XAxis } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { ChartFigure } from "@/features/schools/chances/ChartFigure";
import { formatRelativeTime } from "@/lib/time";
import { plural, type Bucket, type Summary } from "./derive";

const CONFIG = {
  count: { label: "Signups", color: "var(--waitlist-chart-mark)" },
} satisfies ChartConfig;

const DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const WEEKDAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const WEEK = 7;

function Count({ children }: { children: number }) {
  return (
    <span className="font-medium text-foreground tabular-nums">
      {children.toLocaleString()}
    </span>
  );
}

function SummaryLine({
  summary,
  lastSeen,
}: {
  summary: Summary;
  lastSeen: string | null;
}) {
  const parts: React.ReactNode[] = [
    <>
      <Count>{summary.total}</Count> signup{summary.total === 1 ? "" : "s"}
    </>,
    <>
      <Count>{summary.lastWeek}</Count> in the last 7 days
    </>,
    <>
      <Count>{summary.today}</Count> today
    </>,
  ];
  if (summary.newSince !== null && lastSeen !== null)
    parts.push(
      <>
        <Count>{summary.newSince}</Count> new since{" "}
        {formatRelativeTime(lastSeen)}
      </>,
    );
  return (
    <p className="text-sm text-muted-foreground">
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 ? " · " : null}
          {part}
        </span>
      ))}
    </p>
  );
}

function chartSummary(buckets: Bucket[]): string {
  const week = buckets.slice(-WEEK).reduce((n, b) => n + b.count, 0);
  const peak = buckets.reduce((max, b) => (b.count > max.count ? b : max));
  const base = `${plural(week, "signup")} in the last 7 days`;
  return peak.count > 0
    ? `${base}, peak ${peak.count} on ${DAY.format(peak.date)}.`
    : `${base}.`;
}

function DayTooltip({
  active,
  payload,
  filtered,
}: {
  active?: boolean;
  payload?: { payload: Bucket }[];
  filtered: boolean;
}) {
  const bucket = payload?.[0]?.payload;
  if (!active || !bucket) return null;
  const count = filtered
    ? `${bucket.count} of ${plural(bucket.all, "signup")}`
    : plural(bucket.count, "signup");
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      {WEEKDAY.format(bucket.date)} ·{" "}
      <span className="tabular-nums">{count}</span>
    </div>
  );
}

export function Momentum({
  summary,
  buckets,
  filtered,
  lastSeen,
}: {
  summary: Summary;
  buckets: Bucket[];
  filtered: boolean;
  lastSeen: string | null;
}): React.ReactElement {
  return (
    <section aria-label="Momentum" className="flex flex-col gap-3">
      <SummaryLine lastSeen={lastSeen} summary={summary} />
      {buckets.length > 0 ? (
        <ChartFigure summary={chartSummary(buckets)}>
          <ChartContainer className="aspect-auto h-30 w-full" config={CONFIG}>
            <BarChart
              data={buckets}
              margin={{ bottom: 0, left: 0, right: 0, top: 4 }}
            >
              <XAxis
                axisLine={false}
                dataKey="key"
                interval="preserveStartEnd"
                minTickGap={48}
                tickFormatter={(key: string) => {
                  const bucket = buckets.find((b) => b.key === key);
                  return bucket ? DAY.format(bucket.date) : "";
                }}
                tickLine={false}
              />
              <Tooltip
                content={<DayTooltip filtered={filtered} />}
                cursor={{ fill: "var(--surface-hover)" }}
                isAnimationActive={false}
              />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                isAnimationActive={false}
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </ChartFigure>
      ) : null}
    </section>
  );
}
