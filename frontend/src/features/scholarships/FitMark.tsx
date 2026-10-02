import { Check, CircleHelp, X } from "lucide-react";

import type { CriterionStatus, Fit } from "@/features/scholarships/eligibility";
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

function fitStatus(fit: Fit): CriterionStatus {
  if (fit.kind === "fits") return "met";
  return fit.kind === "ineligible" ? "unmet" : "unknown";
}

function fitText(fit: Fit): string {
  if (fit.kind === "fits") return "Fits your profile";
  if (fit.kind === "ineligible") return fit.reason;
  return fit.count === 1 ? "1 thing to check" : `${fit.count} things to check`;
}

/** The compact mark at the end of a list row. */
export function FitMark({ fit }: { fit: Fit }) {
  const text = fitText(fit);
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs",
        fit.kind === "fits" && "font-medium text-[var(--scholarship-fit-met)]",
        fit.kind === "check" && "text-[var(--ink-secondary)]",
        fit.kind === "ineligible" && "text-[var(--ink-muted)]",
      )}
      title={text}
    >
      <StatusDot className="size-4 [&_svg]:size-2.5" status={fitStatus(fit)} />
      <span className="line-clamp-2">{text}</span>
    </span>
  );
}
