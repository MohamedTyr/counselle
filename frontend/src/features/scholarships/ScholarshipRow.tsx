import { Star } from "lucide-react";
import type { CSSProperties } from "react";

import type { Scholarship } from "@/api/scholarships/types";
import type { Fit } from "@/features/scholarships/eligibility";
import { FitMark } from "@/features/scholarships/FitMark";
import {
  awardCadence,
  awardHeadline,
  daysUntil,
  deadlineTone,
  formatShortDate,
  hasEssay,
  isNotYetOpen,
  relativeDays,
} from "@/features/scholarships/scholarship-format";
import { SponsorLogo } from "@/features/scholarships/SponsorLogo";
import { cn } from "@/lib/utils";

function DeadlineCell({ scholarship }: { scholarship: Scholarship }) {
  const { deadline } = scholarship;
  const tone = deadlineTone(deadline);
  if (tone === "rolling" || !deadline.date) {
    return (
      <div className="text-right">
        <div className="text-sm text-[var(--ink)]">Rolling</div>
        <div className="text-xs text-[var(--ink-muted)]">apply anytime</div>
      </div>
    );
  }
  const days = daysUntil(deadline.date);
  const opens = isNotYetOpen(deadline) && deadline.opensOn;
  return (
    <div className="text-right">
      <div className="text-sm tabular-nums text-[var(--ink)]">
        {formatShortDate(deadline.date)}
      </div>
      <div
        className={cn(
          "text-xs tabular-nums",
          tone === "soon"
            ? "font-medium text-[var(--scholarship-soon-ink)]"
            : "text-[var(--ink-muted)]",
        )}
      >
        {tone === "closed"
          ? "closed"
          : opens
            ? `opens ${formatShortDate(opens)}`
            : relativeDays(days)}
      </div>
    </div>
  );
}

export function ScholarshipRow({
  scholarship,
  fit,
  isSelected,
  isSaved,
  onSelect,
  enterDelayMs,
}: {
  scholarship: Scholarship;
  fit: Fit;
  isSelected: boolean;
  isSaved: boolean;
  onSelect: () => void;
  enterDelayMs: number | null;
}) {
  const muted = fit.kind === "ineligible";
  const style: CSSProperties | undefined =
    enterDelayMs === null ? undefined : { animationDelay: `${enterDelayMs}ms` };

  return (
    <li
      className={cn(enterDelayMs !== null && "scholarship-row-enter")}
      style={style}
    >
      <button
        aria-current={isSelected ? "true" : undefined}
        className={cn(
          "group relative grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-[10px] px-3 py-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:grid-cols-[6.75rem_minmax(0,1fr)_5.5rem_9rem] xl:gap-x-3",
          isSelected
            ? "bg-[var(--scholarship-row-selected)] shadow-[inset_0_0_0_1px_var(--scholarship-row-selected-edge)]"
            : "hover:bg-[var(--scholarship-row-hover)]",
        )}
        data-scholarship-id={scholarship.id}
        onClick={onSelect}
        type="button"
      >
        <div className="col-start-1 row-start-2 flex min-w-0 items-baseline gap-1.5 sm:row-start-1 sm:block">
          <div className="truncate text-[1.0625rem] leading-6 font-semibold tracking-[-0.01em] tabular-nums text-[var(--scholarship-amount-ink)]">
            {awardHeadline(scholarship.award)}
          </div>
          <div className="truncate text-xs text-[var(--ink-muted)]">
            {awardCadence(scholarship.award)}
          </div>
        </div>

        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 sm:col-start-2">
          <SponsorLogo scholarship={scholarship} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "truncate text-sm font-medium",
                  muted ? "text-[var(--ink-secondary)]" : "text-[var(--ink)]",
                )}
              >
                {scholarship.name}
              </span>
              {isSaved ? (
                <Star
                  aria-label="Saved"
                  className="size-3.5 shrink-0 fill-[var(--ink)] text-[var(--ink)]"
                />
              ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--ink-muted)]">
              <span className="truncate">{scholarship.sponsor}</span>
              {hasEssay(scholarship.requirements) ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">No essay</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="col-start-2 row-span-2 row-start-1 self-start sm:col-start-3 sm:row-span-1 sm:self-center">
          <DeadlineCell scholarship={scholarship} />
        </div>

        <div className="col-span-2 col-start-1 row-start-3 min-w-0 sm:col-span-1 sm:col-start-4 sm:row-start-1">
          <FitMark fit={fit} />
        </div>
      </button>
    </li>
  );
}
