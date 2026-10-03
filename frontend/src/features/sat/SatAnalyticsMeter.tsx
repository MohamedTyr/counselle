/** A thin first-try meter. Fill is the progress green; a section with no
 * data draws only an empty, non-semantic track, never a "0%" verdict. */
import type React from "react";

import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { cn } from "@/lib/utils";

export function AnalyticsMeter({
  className,
  label,
  value,
}: {
  label: string;
  value: number | null;
  className?: string;
}): React.ReactElement {
  // No reading, no meter: the adjacent text says "no data", and an empty
  // track must not be announced as 0.
  if (value === null) {
    return (
      <div
        aria-hidden="true"
        className={cn("h-1.5 w-full rounded-full bg-[var(--control-track)]", className)}
      />
    );
  }
  return (
    <Meter aria-label={label} className={className} max={100} min={0} value={value}>
      <MeterTrack className="h-1.5 rounded-full">
        <MeterIndicator className="rounded-full" />
      </MeterTrack>
    </Meter>
  );
}
