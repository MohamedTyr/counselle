import type { BadgeProps } from "@/components/ui/badge"
import type { EssayCardStatus, EssayLibraryCardData } from "@/domain/essay"

export const essayStatusVariant: Record<
  EssayCardStatus,
  NonNullable<BadgeProps["variant"]>
> = {
  "Not started": "secondary",
  Drafting: "info",
  "Needs review": "warning",
  Ready: "success",
  Submitted: "success",
}

export function getEssayActivityLabel(essay: EssayLibraryCardData) {
  if (essay.status === "Not started") {
    return "Not opened"
  }

  return `Modified ${essay.updatedAt}`
}
