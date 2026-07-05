import type { BadgeProps } from "@/components/ui/badge";
import type { Essay, EssayStatus } from "@/domain/essay";

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

  return `Modified ${essay.updatedAt}`;
}
