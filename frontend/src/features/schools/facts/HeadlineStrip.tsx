import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * The six-question spine compressed to what a student checks first.
 *
 * Borderless: it sits directly on canvas, separated by the header rule
 * above. It is not a card and it does not contain cards — a page has exactly
 * one raised level, and spending it here would leave the panel below with
 * nowhere to go.
 *
 * There is no hero type. The largest text on this page is the 20px school
 * name; these values are 18px. Presence comes from surface, rhythm and
 * restraint, not from scale — a 48px admit rate would be the loudest thing
 * on a page whose entire argument is that the number needs its qualifier.
 */

export type HeadlineTile = {
  key: string;
  label: string;
  /** Already formatted, or the absence copy. */
  value: string;
  /** True when `value` is an absence, so it renders as one. */
  absent: boolean;
  /** The caveat or the vintage — whichever makes the value readable. */
  foot: string | null;
  /** Sub-50% submitters, a suppressed value: the foot escalates. */
  severe?: boolean;
  /** Hidden below lg, where the strip drops from five tiles to three. */
  secondary?: boolean;
};

export function HeadlineStrip({ tiles }: { tiles: readonly HeadlineTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
      {tiles.map((tile, index) => (
        <Tile index={index} key={tile.key} tile={tile} />
      ))}
    </div>
  );
}

function Tile({ index, tile }: { index: number; tile: HeadlineTile }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        /* Staggered entrance, 22ms a tile, capped at 8 — the sidebar's
         * chat-in convention. Opacity and transform only; under
         * prefers-reduced-motion the animation utility drops to a fade. */
        "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
        tile.secondary && "hidden lg:flex",
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 22}ms` }}
    >
      <p className="text-xs text-[var(--ink-muted)]">{tile.label}</p>
      <p
        className={cn(
          "text-lg leading-7 tabular-nums",
          tile.absent
            ? /* A tile whose value is absent STILL RENDERS. Dropping it
               * would silently change the strip's shape from school to
               * school, so a reader could never tell whether a school is
               * missing a figure or the strip just has fewer tiles. */
              "italic text-[var(--school-fact-absent)]"
            : "font-medium text-[var(--school-fact-value)]",
        )}
      >
        {tile.value}
      </p>
      {tile.foot ? (
        <p
          className={cn(
            "flex items-start gap-1 text-xs leading-5",
            tile.severe
              ? "font-medium text-[var(--school-fact-caveat-severe-fg)]"
              : "text-[var(--ink-muted)]",
          )}
          title={tile.severe ? tile.foot : undefined}
        >
          {tile.severe ? (
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
          ) : null}
          <span>{tile.foot}</span>
        </p>
      ) : null}
    </div>
  );
}
