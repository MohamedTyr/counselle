import { Check, CircleHelp, X } from "lucide-react";

import type { CriterionStatus } from "@/features/scholarships/eligibility";
import { cn } from "@/lib/utils";

/*
 * Fit is never colour alone: every mark pairs an icon with words. "Fits"
 * means fits what's in the profile, and the detail panel says so in full.
 */

const STATUS_ICON = {
  met: Check,
  unmet: X,
  unknown: CircleHelp,
} as const;

const STATUS_CLASS: Record<CriterionStatus, string> = {
  met: "bg-[var(--scholarship-fit-met-surface)] text-[var(--scholarship-fit-met)]",
  unmet: "bg-[var(--scholarship-fit-unmet-surface)] text-[var(--scholarship-fit-unmet)]",
  unknown: "bg-[var(--scholarship-fit-unknown-surface)] text-[var(--scholarship-fit-unknown)]",
};

export function StatusDot({ status, className }: { status: CriterionStatus; className?: string }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
        STATUS_CLASS[status],
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2.5} />
    </span>
  );
}
