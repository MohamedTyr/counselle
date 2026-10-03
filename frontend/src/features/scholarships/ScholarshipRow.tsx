import { Star } from "lucide-react";
import type { CSSProperties } from "react";

import type { ScholarshipPublic } from "@/api/scholarships/types";
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

/** One line for narrow rows: the date, or how soon when it's close. */
function CompactDeadline({ scholarship }: { scholarship: ScholarshipPublic }) {
  const { deadline } = scholarship;
  const tone = deadlineTone(deadline);
  let text = "Rolling";
  if (tone === "closed") text = "Closed";
  else if (tone === "soon" && deadline.date) text = `Due ${relativeDays(daysUntil(deadline.date))}`;
  else if (deadline.date && tone !== "rolling") text = formatShortDate(deadline.date);
  return (
    <div
      className={cn(
        "text-xs tabular-nums",
        tone === "soon" ? "font-medium text-[var(--scholarship-soon-ink)]" : "text-[var(--ink-muted)]",
      )}
    >
      {text}
    </div>
  );
}

function DeadlineCell({ scholarship }: { scholarship: ScholarshipPublic }) {
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
  const opens = isNotYetOpen(deadline) && deadline.opens_on;
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
  scholarship: ScholarshipPublic;
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
          "group relative grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[10px] px-3 py-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:grid-cols-[auto_minmax(0,1fr)_7rem_5.5rem] sm:gap-x-4",
          isSelected ? "bg-[var(--scholarship-row-selected)]" : "hover:bg-[var(--scholarship-row-hover)]",
        )}
        data-scholarship-id={scholarship.id}
        onClick={onSelect}
        type="button"
      >
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
              <Star aria-label="Saved" className="size-3.5 shrink-0 fill-[var(--ink)] text-[var(--ink)]" />
            ) : null}
            {hasEssay(scholarship.requirements) ? null : (
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-[var(--surface-inset)] px-2 text-[0.6875rem] font-medium whitespace-nowrap text-[var(--ink-secondary)]">
                No essay
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--ink-muted)]">
            <span className="truncate">{scholarship.sponsor}</span>
            {fit.kind === "check" ? null : (
              <>
                <span aria-hidden="true">·</span>
                <FitMark fit={fit} />
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 sm:contents">
          <div className="min-w-0 text-right">
            <div className="truncate text-[0.9375rem] leading-6 font-semibold tracking-[-0.01em] tabular-nums text-[var(--scholarship-amount-ink)]">
              {awardHeadline(scholarship.award)}
            </div>
            <div className="hidden truncate text-xs text-[var(--ink-muted)] sm:block">
              {awardCadence(scholarship.award)}
            </div>
          </div>
          <div className="hidden sm:block">
            <DeadlineCell scholarship={scholarship} />
          </div>
          <div className="sm:hidden">
            <CompactDeadline scholarship={scholarship} />
          </div>
        </div>
      </button>
    </li>
  );
}
