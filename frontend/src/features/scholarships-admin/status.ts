import type { ScholarshipStatus } from "@/api/scholarships/types";

export const STATUS_BADGE: Record<
  ScholarshipStatus,
  { label: string; variant: "success" | "secondary" | "outline" }
> = {
  published: { label: "Published", variant: "success" },
  draft: { label: "Draft", variant: "secondary" },
  archived: { label: "Archived", variant: "outline" },
};
