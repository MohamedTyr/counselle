import type { CharState } from "@/domain/activity";

export const UNDO_WINDOW_MS = 5000;
export const COPIED_FEEDBACK_MS = 1500;

export const drawerControlClassName =
  "border-[color:var(--activity-control-border)] bg-[color:var(--activity-control-surface)] shadow-none before:shadow-none hover:bg-[color:var(--activity-control-hover)]";

// ---------------------------------------------------------------------------
// Character budget - the hero interaction. Sheets and Docs can't do this, so
// it gets the visual energy: live count, amber near the limit, red over it.
// ---------------------------------------------------------------------------

export const charStateClass: Record<CharState, string> = {
  empty: "text-muted-foreground/60",
  ok: "text-muted-foreground",
  near: "text-[color:var(--activity-warning-fg)]",
  over: "text-[color:var(--activity-danger-fg)] font-medium",
};
