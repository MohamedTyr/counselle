import { cn } from "@/lib/utils";

import { partialDistributionCaveat } from "./score-plot-copy";
import type { ScoreLaneModel } from "./school-chances-model";

export function ScoreBreakdown({
  lane,
}: {
  lane: ScoreLaneModel;
}): React.ReactElement | null {
  const entries = [
    ...(lane.distribution?.buckets ?? []),
    ...(lane.distribution?.omittedBuckets.map((bucket) => ({
      ...bucket,
      pct: null,
      absenceDisplay: bucket.display,
    })) ?? []),
  ];
  if (!entries.length) return null;
  const partialCaveat = partialDistributionCaveat(lane);
  return (
    <div
      className={cn("flex flex-col gap-1")}
      data-slot="academic-comparison-breakdown"
    >
      <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
        Reported breakdown
        {lane.distributionState.state === "distribution_unscaled"
          ? " — not plotted to scale"
          : ""}
      </p>
      <ul className={cn("flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums")}>
        {entries.map((bucket) => (
          <li key={bucket.label}>
            {bucket.label}:{" "}
            {bucket.pct === null
              ? (bucket.absenceDisplay ?? "Not reported")
              : `${bucket.pct}%`}
          </li>
        ))}
      </ul>
      {lane.distribution?.reportedPeriod ? (
        <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
          Reported {lane.distribution.reportedPeriod}
        </p>
      ) : null}
      {partialCaveat ? (
        <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
          {partialCaveat}
        </p>
      ) : null}
    </div>
  );
}
