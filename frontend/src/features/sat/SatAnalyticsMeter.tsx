/** A thin first-try meter. Fill is the progress green; a section with no
 * data draws only the empty track, never a zero-width "0%" verdict. */
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
  return (
    <Meter aria-label={label} className={className} max={100} min={0} value={value ?? 0}>
      <MeterTrack className="h-1.5 rounded-full">
        <MeterIndicator className={cn("rounded-full", value === null && "opacity-0")} />
      </MeterTrack>
    </Meter>
  );
}
