import type React from "react";

/* Small presentational pieces the block files share. Kept apart so each
 * block file exports only data, which fast refresh needs. */

export function PriceFigure({
  value,
  caption,
}: {
  value: string;
  caption: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-3xl leading-none font-semibold tracking-[-0.02em] tabular-nums text-[var(--ink)]">
        {value}
      </span>
      <span className="text-sm text-[var(--ink-muted)]">{caption}</span>
    </div>
  );
}

export function Line({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 text-[var(--ink-secondary)]">
      <span className="mt-0.5 text-[var(--ink-muted)]">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

export function Who({
  on,
  scholarship,
  children,
}: {
  on: boolean;
  scholarship: boolean;
  children: string;
}) {
  if (!on)
    return (
      <span className="grid size-5 place-items-center rounded-full text-[var(--ink-faint)]">
        ·
      </span>
    );
  return (
    <span
      className={
        scholarship
          ? "grid size-5 place-items-center rounded-full bg-[var(--school-viz-accent)] text-[var(--surface-raised)]"
          : "grid size-5 place-items-center rounded-full border border-[var(--edge-control-strong)] text-[var(--ink-secondary)]"
      }
    >
      {children}
    </span>
  );
}

export function Soft({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--ink-muted)]">{children}</span>;
}
