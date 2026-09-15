import type { ExploreFields, FitEstimate } from "@/api/schools/explore";
import { Badge } from "@/components/ui/badge";
import { pickBand } from "@/features/schools/explore/band-preview";
import {
  ABSENT_LABEL,
  formatBand,
  formatPercent,
} from "@/features/schools/explore/explore-format";
import type { ExploreAssumptions } from "@/features/schools/explore/explore-types";

/*
 * The verdict zone is a server-owned planning classification. Its rate is
 * the server's canonical baseline rate, and the category is deliberately
 * never recomputed from fields or URL-local assumptions in the browser.
 */

function EvidenceLine({
  fields,
  assumptions,
  bandCaptionId,
}: {
  fields: ExploreFields;
  assumptions: ExploreAssumptions;
  bandCaptionId: string | null;
}) {
  const formatted = formatBand(pickBand(fields, assumptions));

  if (formatted === null) {
    return (
      <p className="mt-2 text-xs text-[var(--school-value-absent)]">
        test range {ABSENT_LABEL}
      </p>
    );
  }

  return (
    <p
      aria-describedby={bandCaptionId ?? undefined}
      className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums"
    >
      <span className="text-[var(--ink-secondary)]">{formatted}</span>
      <span aria-hidden="true" className="text-[var(--ink-disabled)]">
        ·
      </span>
      <span className="text-[var(--ink-muted)]">
        Explore preview — does not affect estimate
      </span>
    </p>
  );
}

export function VerdictBand({
  fields,
  assumptions,
  fit,
  bandCaptionId,
  isRefreshingEstimate,
}: {
  fields: ExploreFields;
  assumptions: ExploreAssumptions;
  fit: FitEstimate;
  /** The id of the once-per-screen band caption node (`ExploreResultsHeader`),
   * or null when no card on screen shows a band at all. */
  bandCaptionId: string | null;
  /** `ExplorePanel` replaces cached personalized details until a matching
   * response arrives after a Profile mutation or change event. */
  isRefreshingEstimate: boolean;
}) {
  const rate = formatPercent(fit.baseline_admit_rate);
  const category = fit.category === "Unknown" ? "Not classified" : fit.category;

  if (isRefreshingEstimate) {
    return (
      <div
        aria-label="Refreshing estimate"
        className="-mx-4 border-y px-4 py-3"
        data-slot="explore-fit-refresh"
        role="group"
      >
        <p className="text-sm text-[var(--ink-muted)]">Refreshing estimate…</p>
      </div>
    );
  }

  return (
    <div
      aria-label={`Fit: ${category}.`}
      className="-mx-4 border-y px-4 py-3"
      role="group"
    >
      <div className="flex items-center justify-between gap-3">
        {rate === null ? (
          <span className="min-w-0 truncate text-sm text-[var(--school-value-absent)]">
            admit rate {ABSENT_LABEL}
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-[1.625rem] leading-none font-medium tracking-[-0.02em] tabular-nums">
              {rate}
            </span>
            <span className="truncate text-xs text-[var(--ink-muted)]">
              admit rate
            </span>
          </span>
        )}
        <Badge className="shrink-0" variant="secondary">
          {category}
        </Badge>
      </div>

      <EvidenceLine
        bandCaptionId={bandCaptionId}
        fields={fields}
        assumptions={assumptions}
      />
    </div>
  );
}
