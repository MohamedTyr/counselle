import { Check, Minus } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import type { Bucket } from "./reader";

/*
 * The second set of shared visuals — the ones that let the long tail of a
 * school's data (lists, yes/no services, per-group comparisons, score
 * spreads) sit on the page in full instead of behind a fold.
 */

const TRACK = "bg-[var(--school-viz-track)]";

/** A published list as chips; past `limit`, one inline "+N more" opens the rest. */
export function Chips({
  items,
  limit = 14,
  tone = "quiet",
}: {
  items: string[];
  limit?: number;
  tone?: "quiet" | "outline";
}) {
  const [open, setOpen] = React.useState(false);
  if (items.length === 0) return null;
  const shown = open ? items : items.slice(0, limit);
  const rest = items.length - shown.length;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((item) => (
        <li
          className={cn(
            "rounded-full px-2.5 py-1 text-[13px] leading-4 text-[var(--ink-secondary)]",
            tone === "quiet"
              ? "bg-[var(--control-quiet-surface)]"
              : "border border-[var(--school-fact-divider)]",
          )}
          key={item}
        >
          {item}
        </li>
      ))}
      {rest > 0 ? (
        <li>
          <button
            className="rounded-full px-2.5 py-1 text-[13px] leading-4 font-medium text-[var(--ink)] outline-none hover:bg-[var(--control-quiet-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            onClick={() => setOpen(true)}
            type="button"
          >
            +{rest} more
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** Services and policies as a two-column yes/no list. */
export function CheckList({
  items,
  columns = 2,
}: {
  items: { label: string; yes: boolean; detail?: string | null }[];
  columns?: 1 | 2;
}) {
  if (items.length === 0) return null;
  return (
    <ul
      className={cn(
        "grid gap-x-6 gap-y-2.5",
        columns === 2 && "sm:grid-cols-2",
      )}
    >
      {items.map((item) => (
        <li className="flex items-start gap-2.5" key={item.label}>
          <span
            className={cn(
              "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full",
              item.yes
                ? "bg-[var(--school-viz-accent)] text-[var(--surface-raised)]"
                : "bg-[var(--school-viz-track)] text-[var(--ink-muted)]",
            )}
          >
            {item.yes ? (
              <Check className="size-2.5" strokeWidth={3.5} />
            ) : (
              <Minus className="size-2.5" strokeWidth={3.5} />
            )}
          </span>
          <span className="flex flex-col">
            <span
              className={cn(
                "text-sm",
                item.yes ? "text-[var(--ink)]" : "text-[var(--ink-muted)]",
              )}
            >
              {item.label}
            </span>
            {item.detail ? (
              <span className="text-xs text-[var(--ink-muted)]">
                {item.detail}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A chain of shares, each of the step before it: applied for aid → had need → got aid → fully met. */
type ShareStep = {
  label: string;
  pct: number | null;
  of: string;
  count?: string | null;
  alt?: number | null;
};

export function ShareSteps({ steps }: { steps: ShareStep[] }) {
  const shown = steps.filter(
    (s): s is ShareStep & { pct: number } => s.pct !== null,
  );
  if (shown.length === 0) return null;
  return (
    <div className="@container">
      <ol className="grid grid-cols-2 gap-y-6 @xl:grid-cols-4">
        {shown.map((step) => (
          <li
            className="flex flex-col gap-2 border-l border-[var(--school-fact-divider)] px-4 first:border-l-0 first:pl-0 @max-xl:[&:nth-child(3)]:border-l-0 @max-xl:[&:nth-child(3)]:pl-0"
            key={step.label}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-2xl leading-none font-semibold tracking-[-0.02em] tabular-nums text-[var(--ink)]">
                {Math.round(step.pct)}%
              </span>
              {step.count ? (
                <span className="text-xs tabular-nums text-[var(--ink-muted)]">
                  {step.count}
                </span>
              ) : null}
            </span>
            <span className={cn("h-1 rounded-full", TRACK)}>
              <span
                className="block h-full rounded-full bg-[var(--school-viz-accent)]"
                style={{ width: `${step.pct}%` }}
              />
            </span>
            <span className="text-xs leading-4 text-[var(--ink-secondary)]">
              {step.label}
              <span className="block text-[var(--ink-muted)]">{step.of}</span>
            </span>
            {step.alt !== null && step.alt !== undefined ? (
              <span className="mt-auto text-[11px] tabular-nums text-[var(--ink-muted)]">
                All undergrads {Math.round(step.alt)}%
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One test's published score spread as a single 100% bar, high scores darkest. */
export function SpreadBar({
  label,
  buckets,
}: {
  label: string;
  buckets: Bucket[];
}) {
  const shown = buckets.filter((b) => b.pct > 0);
  if (shown.length === 0) return null;
  const top = shown[0]!;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-[var(--ink-secondary)]">{label}</span>
        <span className="tabular-nums text-[var(--ink-muted)]">
          <span className="font-medium text-[var(--ink)]">
            {Math.round(top.pct)}%
          </span>{" "}
          scored {top.label}
        </span>
      </div>
      <div
        aria-label={shown.map((b) => `${b.label}: ${b.pct}%`).join(", ")}
        className="flex h-2 gap-px overflow-hidden rounded-full"
        role="img"
      >
        {shown.map((b, i) => (
          <span
            key={b.label}
            style={{
              width: `${b.pct}%`,
              background: `color-mix(in oklch, var(--school-viz-accent) ${Math.max(100 - i * 22, 18)}%, var(--school-viz-track))`,
            }}
            title={`${b.label}: ${b.pct}%`}
          />
        ))}
      </div>
    </div>
  );
}

/** Freshmen beside all undergraduates, one row per measure. */
export function CompareTable({
  columns,
  rows,
}: {
  columns: [string, string];
  rows: { label: string; a: string | null; b: string | null }[];
}) {
  const shown = rows.filter((r) => r.a !== null || r.b !== null);
  if (shown.length === 0) return null;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-[var(--ink-muted)]">
          <th className="pb-2 text-left font-normal" />
          <th className="pb-2 text-right font-normal">{columns[0]}</th>
          <th className="pb-2 pl-4 text-right font-normal">{columns[1]}</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((row) => (
          <tr
            className="border-t border-[var(--school-fact-divider)]"
            key={row.label}
          >
            <td className="py-2 pr-3 text-[var(--ink-secondary)]">
              {row.label}
            </td>
            <td className="py-2 text-right font-medium tabular-nums text-[var(--ink)]">
              {row.a ?? "—"}
            </td>
            <td className="py-2 pl-4 text-right tabular-nums text-[var(--ink-secondary)]">
              {row.b ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A row of small figures — a number over its label. */
export function FigureRow({
  items,
}: {
  items: { label: string; value: string | null }[];
}) {
  const shown = items.filter(
    (i): i is { label: string; value: string } => i.value !== null,
  );
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
      {shown.map((item) => (
        <div className="flex flex-col gap-1" key={item.label}>
          <dd className="order-1 text-xl leading-none font-semibold tracking-[-0.015em] tabular-nums text-[var(--ink)]">
            {item.value}
          </dd>
          <dt className="order-2 text-xs leading-4 text-[var(--ink-muted)]">
            {item.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}

/** A captioned sub-part of a block. */
export function Part({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {title ? (
        <h4 className="text-xs font-medium text-[var(--ink-muted)]">{title}</h4>
      ) : null}
      {children}
    </div>
  );
}
