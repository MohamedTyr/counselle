import { ReferenceArea, ReferenceDot, ReferenceLine } from "recharts";

import { scoreDomain, scorePosition } from "./academic-comparison-geometry";
import type { ScoreLaneModel } from "./school-chances-model";

export type ScorePlotMarker = {
  label: string;
  value: number;
  variant: "profile" | "scenario" | "you";
};

export function ScorePlotMarks({
  lane,
  markers,
}: {
  lane: ScoreLaneModel;
  markers: ScorePlotMarker[];
}): React.ReactElement {
  const domain = scoreDomain(lane);
  return (
    <g data-slot="academic-comparison-svg-marks">
      <ReferenceLine
        stroke="var(--school-chances-track)"
        strokeWidth={2}
        y={0}
      />
      {lane.distributionState.usable && lane.distribution
        ? lane.distribution.buckets.map((bucket) => {
            if (bucket.pct === null || bucket.range === null) return null;
            return (
              <ReferenceArea
                fill="var(--school-chances-mark)"
                fillOpacity={0.34}
                ifOverflow="extendDomain"
                key={bucket.label}
                x1={scorePosition(bucket.range.lo, domain.min, domain.max)}
                x2={scorePosition(bucket.range.hi, domain.min, domain.max)}
                y1={0}
                y2={bucket.pct === 0 ? 0.5 : bucket.pct}
              />
            );
          })
        : null}
      {lane.band ? <BandMark band={lane.band} /> : null}
      {lane.average ? (
        <ReferenceDot
          fill="var(--school-chances-mark)"
          r={5}
          shape={<DiamondMark />}
          stroke="var(--school-chances-mark)"
          x={scorePosition(Number(lane.average.value), domain.min, domain.max)}
          y={12}
        />
      ) : null}
      {markers.map((marker) => (
        <ReferenceDot
          fill={
            marker.variant === "profile"
              ? "var(--school-chances-panel-surface)"
              : "var(--school-chances-scenario)"
          }
          key={`${marker.variant}-${marker.value}`}
          r={marker.variant === "profile" ? 5 : 5.5}
          shape={marker.variant === "profile" ? <HollowTick /> : <SolidTick />}
          stroke="var(--school-chances-profile-outline)"
          strokeWidth={2}
          x={scorePosition(marker.value, domain.min, domain.max)}
          y={6}
        />
      ))}
    </g>
  );
}

function BandMark({
  band,
}: {
  band: NonNullable<ScoreLaneModel["band"]>;
}): React.ReactElement {
  return (
    <>
      <ReferenceArea
        fill="var(--school-chances-band)"
        fillOpacity={0.22}
        ifOverflow="extendDomain"
        x1={scorePosition(band.p25, band.min, band.max)}
        x2={scorePosition(band.p75, band.min, band.max)}
        y1={0}
        y2={5}
      />
      <ReferenceLine
        ifOverflow="extendDomain"
        stroke="var(--school-chances-band)"
        strokeWidth={2}
        x={scorePosition(band.p25, band.min, band.max)}
      />
      <ReferenceLine
        ifOverflow="extendDomain"
        stroke="var(--school-chances-band)"
        strokeWidth={2}
        x={scorePosition(band.p75, band.min, band.max)}
      />
    </>
  );
}

function DiamondMark({
  cx = 0,
  cy = 0,
}: {
  cx?: number;
  cy?: number;
}): React.ReactElement {
  return (
    <path
      data-slot="academic-comparison-average-mark"
      d={`M ${cx} ${cy - 5} L ${cx + 5} ${cy} L ${cx} ${cy + 5} L ${cx - 5} ${cy} Z`}
    />
  );
}

function HollowTick({
  cx = 0,
  cy = 0,
}: {
  cx?: number;
  cy?: number;
}): React.ReactElement {
  return (
    <circle
      data-slot="academic-comparison-profile-mark"
      cx={cx}
      cy={cy}
      fill="var(--school-chances-panel-surface)"
      r="5"
      stroke="var(--school-chances-profile-outline)"
      strokeWidth="2"
    />
  );
}

function SolidTick({
  cx = 0,
  cy = 0,
}: {
  cx?: number;
  cy?: number;
}): React.ReactElement {
  return (
    <circle
      data-slot="academic-comparison-scenario-mark"
      cx={cx}
      cy={cy}
      fill="var(--school-chances-scenario)"
      r="5"
      stroke="var(--school-chances-profile-outline)"
      strokeWidth="2"
    />
  );
}
