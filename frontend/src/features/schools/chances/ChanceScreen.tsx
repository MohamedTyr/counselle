import * as React from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

import { chanceLevel, formatChance } from "./chance-format";
import { ChanceGraph } from "./ChanceGraph";
import { chanceAt, type ChanceLane, type ChancePoint } from "./chance-lane";
import { classStanding } from "./school-chances-copy";
import type { SchoolChancesModel } from "./school-chances-model";

/*
 * One metric's chance screen: a sentence, three numbers, the curve, and the
 * slider that drives all of it. The slider is the only control — every value
 * above it re-renders in place from one number, so nothing remounts, fades
 * or reflows while it moves.
 */

const CURVE_SAMPLES = 72;

export function ChanceScreen({
  lane,
  model,
}: {
  lane: ChanceLane;
  model: Pick<SchoolChancesModel, "admitRate" | "control">;
}): React.ReactElement | null {
  const [simulated, setSimulated] = React.useState<number | null>(null);
  const value = clamp(simulated ?? lane.saved ?? lane.typical, lane);
  const curve = React.useMemo(() => sampleCurve(lane, model), [lane, model]);
  const current = chanceAt(lane, value, model);
  if (current === null || curve.length === 0) return null;

  const isScenario = simulated !== null && simulated !== lane.saved;
  const savedPoint =
    isScenario && lane.saved !== null ? chanceAt(lane, clamp(lane.saved, lane), model) : null;
  const level = chanceLevel(current.chance);

  return (
    <div className={cn("flex flex-col gap-5")} data-level={level} data-slot="chance-screen">
      <p
        className={cn("max-w-[48ch] text-[17px] text-foreground leading-[1.45] text-pretty")}
        data-slot="school-chances-interpretation"
      >
        {sentenceFor(lane, value, isScenario)}
      </p>
      <ChanceFigures current={current} isScenario={isScenario} lane={lane} value={value} />
      <div className={cn("flex flex-col gap-1")}>
        <ChanceGraph current={current} curve={curve} lane={lane} savedPoint={savedPoint} />
        <AxisLabels lane={lane} />
      </div>
      <ChanceExplorer
        current={current}
        hasSaved={lane.saved !== null}
        isScenario={isScenario}
        lane={lane}
        onChange={setSimulated}
        onReset={() => setSimulated(null)}
        value={value}
      />
    </div>
  );
}

function sentenceFor(lane: ChanceLane, value: number, isScenario: boolean): string {
  const standing = classStanding(lane.classPercentile(value));
  if (lane.saved === null && !isScenario) {
    return `Add your ${lane.noun} to your profile, or drag below to explore.`;
  }
  return isScenario
    ? `A ${lane.format(value)} ${lane.noun} would put you ${standing}.`
    : `Your ${lane.format(value)} ${lane.noun} puts you ${standing}.`;
}

function ChanceFigures({
  lane,
  value,
  current,
  isScenario,
}: {
  lane: ChanceLane;
  value: number;
  current: ChancePoint;
  isScenario: boolean;
}): React.ReactElement {
  return (
    <dl className={cn("grid grid-cols-3 gap-x-4")} data-slot="chance-numbers">
      <Figure
        absent={lane.saved === null}
        label={`Your ${lane.noun}`}
        value={lane.saved === null ? "Not added" : lane.format(lane.saved)}
      />
      <Figure label="Typical student" muted value={lane.format(lane.typical)} />
      <div className={cn("flex min-w-0 flex-col gap-1")}>
        <dt className={cn("text-xs font-medium text-[var(--chance-level-text)]")}>
          {/* "Your" only ever labels the chance at the student's own saved score. */}
          {isScenario || lane.saved === null
            ? `Chances at ${lane.format(value)}`
            : "Your chances"}
        </dt>
        <dd
          className={cn(
            "font-semibold text-[34px] leading-none tracking-[-0.02em] text-[var(--chance-level-text)] tabular-nums",
          )}
          data-slot="chance-hero"
        >
          {formatChance(current.chance)}
        </dd>
        <dd className={cn("text-xs text-[var(--school-fact-caveat)] tabular-nums")}>
          likely {formatChance(current.low)}–{formatChance(current.high)}
        </dd>
      </div>
    </dl>
  );
}

function ChanceExplorer({
  lane,
  value,
  current,
  isScenario,
  hasSaved,
  onChange,
  onReset,
}: {
  lane: ChanceLane;
  value: number;
  current: ChancePoint;
  isScenario: boolean;
  hasSaved: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
}): React.ReactElement {
  const explorerRef = React.useRef<HTMLDivElement>(null);

  function handleReset(): void {
    const input = explorerRef.current?.querySelector<HTMLInputElement>('input[type="range"]');
    onReset();
    input?.focus({ preventScroll: true });
  }

  return (
    <div data-slot="chance-explorer" ref={explorerRef}>
      <div className={cn("flex min-h-7 items-center justify-between gap-3 text-sm")}>
        <span className={cn("text-[var(--school-fact-caveat)]")}>Drag to explore</span>
        <span className={cn("flex items-center gap-2")}>
          {isScenario && hasSaved ? (
            <Button onClick={handleReset} size="xs" variant="ghost">
              Reset
            </Button>
          ) : null}
          <span className={cn("font-medium text-foreground tabular-nums")}>
            {lane.noun} {lane.format(value)}
          </span>
        </span>
      </div>
      {/* The plot's y-axis gutter (w-8 + gap-2) is mirrored here so the
       * thumb stays directly under the dot. */}
      <div className={cn("pl-10")}>
        <Slider
          aria-label={`Explore ${lane.noun}`}
          aria-valuetext={`${lane.noun} ${lane.format(value)}, estimated chance ${formatChance(current.chance)}`}
          max={lane.max}
          min={lane.min}
          onValueChange={(next) => onChange(Array.isArray(next) ? next[0]! : next)}
          step={lane.step}
          value={value}
        />
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  muted,
  absent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  absent?: boolean;
}): React.ReactElement {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1")}>
      <dt className={cn("text-xs text-[var(--school-fact-caveat)]")}>{label}</dt>
      <dd
        className={cn(
          absent
            ? "text-[15px] leading-[34px] text-[var(--school-fact-absent)]"
            : "font-medium text-[34px] leading-none tracking-[-0.02em] tabular-nums",
          muted && "text-[var(--school-fact-caveat)]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Both ends of the scale plus the typical student's score under its rule. */
function AxisLabels({ lane }: { lane: ChanceLane }): React.ReactElement {
  const typicalPct = ((lane.typical - lane.min) / (lane.max - lane.min)) * 100;
  return (
    <div className={cn("pl-10")}>
      <div
        aria-hidden
        className={cn("relative mx-2 h-5 text-xs text-[var(--school-fact-caveat)] tabular-nums")}
      >
        {typicalPct > 14 ? <span className={cn("absolute left-0")}>{lane.format(lane.min)}</span> : null}
        {typicalPct < 86 ? <span className={cn("absolute right-0")}>{lane.format(lane.max)}</span> : null}
        <span
          className={cn("absolute -translate-x-1/2 whitespace-nowrap font-medium text-foreground")}
          style={{ left: `${Math.min(94, Math.max(6, typicalPct))}%` }}
        >
          Typical {lane.format(lane.typical)}
        </span>
      </div>
    </div>
  );
}

function sampleCurve(
  lane: ChanceLane,
  model: Pick<SchoolChancesModel, "admitRate" | "control">,
): ChancePoint[] {
  const points: ChancePoint[] = [];
  for (let index = 0; index <= CURVE_SAMPLES; index += 1) {
    const point = chanceAt(lane, lane.min + ((lane.max - lane.min) * index) / CURVE_SAMPLES, model);
    if (point) points.push(point);
  }
  return points;
}

function clamp(value: number, lane: ChanceLane): number {
  return Math.min(lane.max, Math.max(lane.min, value));
}
