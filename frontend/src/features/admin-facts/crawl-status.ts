import type { BadgeProps } from "@/components/ui/badge";
import type { CrawlRunSummary, FactsStatus, TabName } from "@/api/admin/facts-status";

const WORKER_DISABLED_REASON =
  "Set COUNSELLE_FACTS_WORKER_ENABLED=true, or run python -m app.facts --once, to start a pass";
const QUEUED_REASON = "A pass is already queued or running";

/** The reason "Run a pass now" is unavailable, shared by the button itself
 * (`RunPassButton`) and the two places that need to explain the "why"
 * beside it: the header meta line and the empty-state body copy (plan
 * §5.5). `null` means the button is actionable. */
export function factsDisabledReason(status: FactsStatus | undefined): string | null {
  if (!status) return null;
  if (!status.worker_enabled) return WORKER_DISABLED_REASON;
  if (status.queued_or_running) return QUEUED_REASON;
  return null;
}

export type CrawlBadge = {
  label: string;
  severe: boolean;
  variant: BadgeProps["variant"];
};

/** The six raw tabs the crawler visits per school (mirrors
 * `domain/facts/models.py::TAB_NAMES` — kept as a local literal since the
 * frontend has no reason to import backend code, and this list is pinned by
 * `tests/domain/facts/test_tab_names.py` on the Python side). */
export const ADMIN_FACTS_TAB_NAMES: readonly TabName[] = [
  "overview",
  "admission",
  "money-matters",
  "academics",
  "campus-life",
  "students",
];

/**
 * The crawl-outcome badge mapping (DESIGN.md §14.1's closed badge set;
 * §14.3 "the word always, the glyph when severe"; plan §5.5's exact table).
 * `queuedOrRunning` covers the one case `CrawlStatus` itself can't: a job
 * queued with no `crawl_runs` row yet (`lastRun === null`).
 *
 * Exit-test-pinned wording: `aborted` -> "Stopped", `partial` -> "Completed
 * with errors", never "Completed" for either.
 */
export function crawlRunBadge(
  lastRun: CrawlRunSummary | null,
  queuedOrRunning: boolean,
): CrawlBadge {
  if (lastRun === null) {
    return queuedOrRunning
      ? { label: "Queued", severe: false, variant: "secondary" }
      : { label: "No passes yet", severe: false, variant: "secondary" };
  }
  switch (lastRun.status) {
    case "succeeded":
      return { label: "Completed", severe: false, variant: "success" };
    case "partial":
      return { label: "Completed with errors", severe: false, variant: "warning" };
    case "running":
      return { label: "Running", severe: false, variant: "secondary" };
    case "failed":
      return { label: "Failed", severe: true, variant: "error" };
    case "aborted":
      return { label: "Stopped", severe: true, variant: "error" };
  }
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "1h 58m" / "42m" / "<1m" — the short duration format the header meta
 * line and the recent-passes table both use. */
export function formatDurationShort(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0 && minutes === 0) return "<1m";
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/** "next pass in 6h 48m" — the countdown to `next_run_at`, floored at zero
 * (a pass that's overdue reads as "any moment now", not a negative time). */
export function formatCountdown(nextRunAtIso: string, nowMs: number = Date.now()): string {
  const remainingMs = Math.max(0, new Date(nextRunAtIso).getTime() - nowMs);
  return formatDurationShort(remainingMs / 1000);
}
