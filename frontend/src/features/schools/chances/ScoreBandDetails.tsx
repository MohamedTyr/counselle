import { cn } from "@/lib/utils";

import {
  endpointLabelLayout,
  scorePosition,
} from "./academic-comparison-geometry";
import type { ScoreLaneModel } from "./school-chances-model";

export function BandUnavailable({
  lane,
}: {
  lane: ScoreLaneModel;
}): React.ReactElement {
  return (
    <span data-band-state={lane.bandState.state}>
      {lane.bandState.display ?? "Middle 50% unavailable"}
    </span>
  );
}

export function ScoreBandEndpoints({
  lane,
  plotWidth,
}: {
  lane: ScoreLaneModel;
  plotWidth: number;
}): React.ReactElement {
  const band = lane.band!;
  const p25Position = scorePosition(band.p25, band.min, band.max);
  const p75Position = scorePosition(band.p75, band.min, band.max);
  const layout = endpointLabelLayout(p25Position, p75Position, plotWidth);
  return (
    <span
      className={cn("relative h-4 min-w-full")}
      data-band-layout={layout}
      data-slot="academic-comparison-band-endpoints"
    >
      {layout === "middle" ? (
        <span className={cn("absolute left-1/2 -translate-x-1/2")}>
          Middle 50% {band.p25}–{band.p75}
        </span>
      ) : (
        <>
          <span
            className={cn("absolute w-6")}
            data-band-endpoint="p25"
            style={{ left: `${p25Position * 100}%` }}
          >
            {band.p25}
          </span>
          <span
            className={cn("absolute w-6 -translate-x-full text-right")}
            data-band-endpoint="p75"
            style={{ left: `${p75Position * 100}%` }}
          >
            {band.p75}
          </span>
        </>
      )}
    </span>
  );
}
