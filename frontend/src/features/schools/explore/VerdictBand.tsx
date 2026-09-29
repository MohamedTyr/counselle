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
 * The verdict zone is a server-owned planning classification derived from
 * one number: the school's admit rate, printed right beside it. Nothing
 * about the student is an input, so there is no reasoning to disclose and
 * nothing here to explain -- the rate is the argument.
 */

function EvidenceLine({
  fields,
  assumptions,
}: {
  fields: ExploreFields;
  assumptions: ExploreAssumptions;
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
    <p className="mt-2 text-xs text-[var(--ink-secondary)] tabular-nums">
      {formatted}
    </p>
  );
}

export function VerdictBand({
  fields,
  assumptions,
  fit,
}: {
  fields: ExploreFields;
  assumptions: ExploreAssumptions;
  fit: FitEstimate;
}) {
  const rate = formatPercent(fit.admit_rate);
  // An unclassifiable school has no rate to show and no band to claim.
  const categoryLabel = fit.category === "Unknown" ? null : fit.category;

  return (
    <div
      aria-label={`Admit rate: ${rate ?? ABSENT_LABEL}.${categoryLabel ? ` ${categoryLabel}.` : ""}`}
      className="-mx-4 border-y px-4 py-3"
      role="group"
    >
      <div className="flex items-center justify-between gap-3">
        {rate === null ? (
          <span className="min-w-0 truncate text-sm text-[var(--school-value-absent)]">
            Admit rate not available
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
        {categoryLabel ? (
          <Badge className="shrink-0" variant="secondary">
            {categoryLabel}
          </Badge>
        ) : null}
      </div>

      <EvidenceLine fields={fields} assumptions={assumptions} />
    </div>
  );
}
