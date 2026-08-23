import type React from "react";

import { cn } from "@/lib/utils";

import { toolBeatEnter } from "./tool-beat-style";

/**
 * Shared layout primitives for a single tool-call beat.
 *
 * Every tool widget renders back-to-back in the run stream with no wrapper
 * spacing, so each beat's own rail width, gap, vertical padding and label
 * scale ARE the timeline's alignment and rhythm. These primitives pin all of
 * that to one system — a 16px icon rail, `gap-3`, `py-2`, a 14px label — so an
 * interleaved run of school-data, search, workspace and write beats shares one
 * baseline grid instead of drifting a few pixels per family.
 *
 * The status glyph is passed in, not owned here: reads keep their bare icon
 * language, writes keep their filled badge. Only the frame is shared.
 */

type BeatTone = "muted" | "error";
type LabelState = "running" | "settled" | "error";

export function ToolBeatRow({
  children,
  className,
  ...aria
}: {
  children: React.ReactNode;
  className?: string;
} & React.AriaAttributes) {
  return (
    <div
      className={cn(
        "not-prose grid grid-cols-[16px_minmax(0,1fr)] gap-3 py-2",
        toolBeatEnter,
        className,
      )}
      {...aria}
    >
      {children}
    </div>
  );
}

/** The 16px status-icon cell. Caller supplies the glyph. */
export function ToolBeatIcon({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: BeatTone;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // Center the glyph on the first text line (leading-5 = 20px), not with
        // a margin nudge — keeps the icon optically level with the label.
        "flex h-5 items-center justify-center",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function ToolBeatLabel({
  children,
  state = "settled",
}: {
  children: React.ReactNode;
  state?: LabelState;
}) {
  return (
    <p
      className={cn(
        "text-sm leading-5",
        state === "running" && "font-medium text-foreground",
        state === "settled" && "text-[var(--ink-secondary)]",
        state === "error" && "text-destructive",
      )}
    >
      {children}
    </p>
  );
}

export function ToolBeatSubtitle({
  children,
  tone = "muted",
  role,
}: {
  children: React.ReactNode;
  tone?: BeatTone;
  role?: string;
}) {
  return (
    <p
      className={cn(
        "mt-0.5 text-xs leading-5",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      role={role}
    >
      {children}
    </p>
  );
}
