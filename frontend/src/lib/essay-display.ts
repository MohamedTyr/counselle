import type { BadgeProps } from "@/components/ui/badge";
import type { Essay, EssayStatus } from "@/domain/essay";
import { formatRelativeTime } from "@/lib/time";

/* Drafting is the ordinary state of an essay — it was the blue `info` badge
 * until the palette pass, which put the most common row on the page in the
 * loudest colour on it. "Needs review" keeps amber (it is waiting on a
 * person), Ready and Submitted keep leaf (done). */
export const essayStatusVariant: Record<
  EssayStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  Drafting: "secondary",
  "Needs review": "warning",
  "Not started": "secondary",
  Ready: "success",
  Submitted: "success",
};

export function getEssayActivityLabel(essay: Essay) {
  if (essay.status === "Not started") {
    return "Not opened";
  }

  return `Modified ${formatRelativeTime(essay.updatedAt)}`;
}

/* Card-sized variant of the label above: no "Modified" prefix (a library grid
 * only ever shows one kind of timestamp) and nothing at all for an essay that
 * was never opened, where the status badge already says so. */
export function getEssayActivityShortLabel(essay: Essay) {
  if (essay.status === "Not started") {
    return null;
  }

  return formatRelativeTime(essay.updatedAt);
}

/* Deadlines are stored as plain date strings and parsed at midnight UTC, so
 * they have to be formatted in UTC too — formatting in the local zone renders
 * the previous day for anyone west of Greenwich. */
export function formatEssayDeadlineOrNull(deadline: string | null) {
  if (!deadline) {
    return null;
  }

  const time = Date.parse(`${deadline}T00:00:00Z`);
  if (!Number.isFinite(time)) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(time));
}

export function formatEssayDeadline(deadline: string | null) {
  return formatEssayDeadlineOrNull(deadline) ?? "No deadline";
}

export function formatEssayCycle(cycleYear: number | null) {
  if (!cycleYear) {
    return null;
  }

  return `${cycleYear - 1}–${String(cycleYear).slice(-2)}`;
}
