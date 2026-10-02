import type React from "react";

import type { DeadlineRow } from "@/features/schools/facts/school-facts-types";
import { cn } from "@/lib/utils";

import {
  type Band,
  type Bucket,
  type Factor,
  daysUntil,
  usd,
} from "./digest";

/*
 * The small visuals the variants share. Every one is a plain div/SVG drawing
 * of one published number set — no axes to decode, the value is always
 * printed beside its mark, and an institutional figure is drawn in ink so
 * colour stays free for the one thing a variant wants to point at.
 */

const MARK = "bg-[var(--school-viz-mark)]";
const TRACK = "bg-[var(--school-viz-track)]";

/** 100 people, the admitted ones filled. "5 in every 100" needs no legend. */
export function DotGrid({
  rate,
  className,
  dot = "size-2.5",
}: {
  rate: number;
  className?: string;
  dot?: string;
}) {
  const filled = Math.round(rate);
  return (
    <div
      aria-label={`${rate}% admitted: about ${filled} of every 100 applicants`}
      className={cn("grid w-fit grid-cols-10 gap-1.5", className)}
      role="img"
    >
      {Array.from({ length: 100 }, (_, i) => (
        <span
          className={cn(
            "rounded-full",
            dot,
            i < filled ? "bg-[var(--school-viz-accent)]" : TRACK,
          )}
          key={i}
        />
      ))}
    </div>
  );
}

/** Applied → admitted → enrolled, each bar to the applicant pool's scale. */
export function Funnel({
  steps,
}: {
  steps: { label: string; value: number; display: string }[];
}) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {steps.map((step, i) => (
        <div
          className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-3"
          key={step.label}
        >
          <span className="text-sm text-[var(--ink-secondary)]">
            {step.label}
          </span>
          <span className={cn("h-2.5 rounded-full", TRACK)}>
            <span
              className={cn(
                "block h-full min-w-1 rounded-full",
                i === 1 ? "bg-[var(--school-viz-accent)]" : MARK,
              )}
              style={{ width: `${(step.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right text-sm font-medium tabular-nums text-[var(--ink)]">
            {step.display}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The middle 50% of the class on the test's full scale. */
export function RangeBar({
  band,
  compact = false,
}: {
  band: Band;
  compact?: boolean;
}) {
  const span = band.max - band.min;
  const left = ((band.p25 - band.min) / span) * 100;
  const width = ((band.p75 - band.p25) / span) * 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-[var(--ink-secondary)]">
          {band.label}
        </span>
        <span className="text-sm font-medium tabular-nums text-[var(--ink)]">
          {band.p25}–{band.p75}
        </span>
      </div>
      <div
        aria-label={`${band.label}: middle 50% scored ${band.p25} to ${band.p75}, on a ${band.min} to ${band.max} scale`}
        className={cn(
          "relative rounded-full",
          TRACK,
          compact ? "h-1.5" : "h-2",
        )}
        role="img"
      >
        <span
          className="absolute inset-y-0 rounded-full bg-[var(--school-viz-accent)]"
          style={{ left: `${left}%`, width: `${Math.max(width, 1.5)}%` }}
        />
      </div>
      {compact ? null : (
        <div className="flex justify-between text-[11px] tabular-nums text-[var(--ink-muted)]">
          <span>{band.min}</span>
          <span>{band.max}</span>
        </div>
      )}
    </div>
  );
}

/** Where a year's money goes, one bar, each part labelled underneath. */
export function CostStack({
  parts,
}: {
  parts: { label: string; value: number }[];
}) {
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  const shades = [
    "bg-[var(--school-viz-mark)]",
    "bg-[var(--school-viz-mark-2)]",
    "bg-[var(--school-viz-mark-3)]",
    "bg-[var(--school-viz-mark-4)]",
  ];
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full"
        role="presentation"
      >
        {parts.map((part, i) => (
          <span
            className={shades[i % shades.length]}
            key={part.label}
            style={{ width: `${(part.value / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
        {parts.map((part, i) => (
          <li className="flex flex-col" key={part.label}>
            <span className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
              <span
                className={cn("size-2 rounded-full", shades[i % shades.length])}
              />
              {part.label}
            </span>
            <span className="text-sm font-medium tabular-nums text-[var(--ink)]">
              {usd(part.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Retention and graduation on one 0–100 scale, one row each. The 4-year
 * rate is the accent: it is the number most families plan around. */
export function Columns({
  items,
}: {
  items: { label: string; value: number | null; display: string }[];
  height?: string;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, i) => (
        <li
          className="grid grid-cols-[minmax(0,min(10.5rem,42%))_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm"
          key={item.label}
        >
          <span className="text-[var(--ink-secondary)]">{item.label}</span>
          <span className={cn("h-2 rounded-full", TRACK)}>
            {item.value !== null ? (
              <span
                className={cn(
                  "block h-full rounded-full",
                  i === 1 ? "bg-[var(--school-viz-accent)]" : MARK,
                )}
                style={{ width: `${item.value}%` }}
              />
            ) : null}
          </span>
          <span className="text-right font-medium tabular-nums text-[var(--ink)]">
            {item.display}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Two shares of one whole, side by side in one bar. */
export function SplitBar({
  a,
  b,
}: {
  a: { label: string; pct: number };
  b: { label: string; pct: number };
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        <span className={MARK} style={{ width: `${a.pct}%` }} />
        <span
          className="bg-[var(--school-viz-mark-3)]"
          style={{ width: `${b.pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs tabular-nums text-[var(--ink-muted)]">
        <span>
          {a.label} {a.pct}%
        </span>
        <span>
          {b.label} {b.pct}%
        </span>
      </div>
    </div>
  );
}

/** A published distribution as plain labelled bars. */
export function Bars({
  buckets,
  highlightTop = false,
  limit,
}: {
  buckets: Bucket[];
  highlightTop?: boolean;
  limit?: number;
}) {
  const shown = limit ? buckets.slice(0, limit) : buckets;
  const max = Math.max(...shown.map((b) => b.pct), 1);
  const top = Math.max(...shown.map((b) => b.pct));
  return (
    <ul className="flex flex-col gap-2.5">
      {shown.map((bucket) => (
        <li
          className="grid grid-cols-[minmax(0,min(13rem,45%))_minmax(0,1fr)_3rem] items-center gap-3 text-sm"
          key={bucket.label}
        >
          <span className="leading-5 text-pretty text-[var(--ink-secondary)]">
            {bucket.label}
          </span>
          <span className="h-2 rounded-full">
            <span
              className={cn(
                "block h-full min-w-0.5 rounded-full",
                highlightTop && bucket.pct === top
                  ? "bg-[var(--school-viz-accent)]"
                  : MARK,
              )}
              style={{ width: `${(bucket.pct / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-[var(--ink)]">
            {bucket.pct}%
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A share as a ring, the number inside it. */
export function Ring({
  pct,
  size = 72,
  label,
}: {
  pct: number;
  size?: number;
  label?: React.ReactNode;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ height: size, width: size }}
    >
      <svg aria-hidden className="-rotate-90" height={size} width={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r}
          stroke="var(--school-viz-track)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={r}
          stroke="var(--school-viz-accent)"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          strokeLinecap="round"
          strokeWidth={stroke}
        />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums text-[var(--ink)]">
        {label ?? `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

/** What the school weighs, grouped by how much it counts — four short
 * lists read faster than one long ranked one. Each group's mark fills to its
 * level on the school's own 4-step scale. */
export function FactorScale({ factors }: { factors: Factor[] }) {
  const levels = [3, 2, 1, 0]
    .map((level) => ({
      level,
      label: factors.find((f) => f.level === level)?.levelLabel,
      items: factors.filter((f) => f.level === level),
    }))
    .filter((g) => g.items.length > 0);
  return (
    <dl className="flex flex-col">
      {levels.map((group) => (
        <div
          className="grid gap-2 border-t border-[var(--school-fact-divider)] py-4 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-6"
          key={group.level}
        >
          <dt className="flex items-center gap-2.5 self-start sm:pt-1">
            <span aria-hidden className="flex gap-0.5">
              {[1, 2, 3].map((step) => (
                <span
                  className={cn(
                    "h-3 w-1 rounded-full",
                    group.level >= step ? "bg-[var(--school-viz-accent)]" : TRACK,
                  )}
                  key={step}
                />
              ))}
            </span>
            <span
              className={cn(
                "text-sm font-medium",
                group.level === 0
                  ? "text-[var(--ink-muted)]"
                  : "text-[var(--ink)]",
              )}
            >
              {group.label}
            </span>
          </dt>
          <dd>
            <ul className="flex flex-wrap gap-1.5">
              {group.items.map((factor) => (
                <li
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[13px] leading-4",
                    group.level === 0
                      ? "border border-[var(--school-fact-divider)] text-[var(--ink-muted)]"
                      : "bg-[var(--control-quiet-surface)] text-[var(--ink-secondary)]",
                  )}
                  key={factor.label}
                >
                  {factor.label}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The season as one dated list: each round's deadline, then the decision
 * and reply dates the school publishes. The next deadline carries the
 * accent and its countdown; a date that has gone by stays, marked passed. */
export function DeadlineList({
  rows,
  milestones,
}: {
  rows: (DeadlineRow & { date: string })[];
  milestones: { label: string; display: string }[];
}) {
  const next = rows.find((row) => daysUntil(row.date) >= 0);
  return (
    <ol className="flex flex-col">
      {rows.map((row) => {
        const days = daysUntil(row.date);
        const isNext = row === next;
        const date = new Date(`${row.date}T12:00:00`);
        return (
          <li
            className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--school-fact-divider)] py-3.5 first:pt-0"
            key={row.round}
          >
            <span
              className={cn(
                "flex flex-col items-center rounded-lg py-1.5 leading-none tabular-nums",
                isNext
                  ? "bg-[var(--school-viz-accent)] text-[var(--surface-raised)]"
                  : "bg-[var(--control-quiet-surface)] text-[var(--ink-secondary)]",
                days < 0 && "opacity-60",
              )}
            >
              <span className="text-[11px]">
                {date.toLocaleString("en-US", { month: "short" })}
              </span>
              <span className="mt-1 text-lg font-semibold">
                {date.getDate()}
              </span>
            </span>
            <span className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "text-[15px] font-medium",
                  days < 0 ? "text-[var(--ink-muted)]" : "text-[var(--ink)]",
                )}
              >
                {row.round}
              </span>
              <span className="text-xs tabular-nums text-[var(--ink-muted)]">
                {row.display}
              </span>
            </span>
            <span
              className={cn(
                "text-right text-sm tabular-nums",
                isNext
                  ? "font-medium text-[var(--ink)]"
                  : "text-[var(--ink-muted)]",
              )}
            >
              {days < 0
                ? "Passed"
                : days === 0
                  ? "Today"
                  : `${days} day${days === 1 ? "" : "s"} left`}
            </span>
          </li>
        );
      })}
      {milestones.map((m) => (
        <li
          className="grid grid-cols-[3.25rem_auto_minmax(0,1fr)] items-center gap-4 border-b border-[var(--school-fact-divider)] py-3 last:border-b-0 last:pb-0"
          key={m.label}
        >
          <span className="grid place-items-center">
            <span className="size-2 rounded-full border-2 border-[var(--ink-faint)]" />
          </span>
          <span className="text-sm whitespace-nowrap text-[var(--ink-secondary)]">{m.label}</span>
          <span className="justify-self-end text-right text-sm text-pretty text-[var(--ink)]">
            {m.display}
          </span>
        </li>
      ))}
    </ol>
  );
}
