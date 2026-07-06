import type { BadgeProps } from "@/components/ui/badge";
import type { Essay, EssayStatus } from "@/domain/essay";
import { formatRelativeTime } from "@/domain/time";

export const essayStatusVariant: Record<
  EssayStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  "Not started": "secondary",
  Drafting: "info",
  "Needs review": "warning",
  Ready: "success",
  Submitted: "success",
};

export function getEssayActivityLabel(essay: Essay) {
  if (essay.status === "Not started") {
    return "Not opened";
  }

  return `Modified ${formatRelativeTime(essay.updatedAt)}`;
}

export function formatEssayDeadline(deadline: string | null) {
  if (!deadline) {
    return "No deadline";
  }

  const time = Date.parse(`${deadline}T00:00:00Z`);
  if (!Number.isFinite(time)) {
    return "No deadline";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(time));
}
