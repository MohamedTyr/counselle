import * as React from "react";

import {
  NumberField,
  NumberFieldGroup,
  NumberFieldInput,
} from "@/components/ui/number-field";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

import {
  errorCopy,
  formatValue,
  offGridCopy,
  onGrid,
  scenarioPosition,
  type LaneConfig,
} from "./scenario-explorer-model";
import { scenarioLabel, scenarioSetCopy } from "./school-chances-copy";
import type { ChancesMetric, SchoolChancesModel } from "./school-chances-model";

/** One metric lane's native input, slider, feedback, and announcement contract. */
export function ScenarioLaneControl({
  lane,
  metric,
  model,
  onChange,
  savedValue,
}: {
  lane: LaneConfig;
  metric: ChancesMetric;
  model: SchoolChancesModel;
  onChange: (value: number) => void;
  savedValue: number | null;
}): React.ReactElement {
  const [error, setError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const value = lane.seed;
  const laneName =
    lane.key === "math" || lane.key === "ebrw" ? lane.key : undefined;
  const errorId = `${lane.key}-scenario-error`;
  const sliderHostRef = React.useRef<HTMLDivElement>(null);
  const inputOrigin = React.useRef<"pointer" | "keyboard" | null>(null);
  const focusSliderAfterCommit = React.useRef(false);
  const formatted = value === null ? null : formatValue(value, lane.step);

  const commit = React.useCallback(
    (next: number | null) => {
      if (next === null || !onGrid(next, lane)) {
        setError(errorCopy(lane));
        return;
      }
      setError(null);
      focusSliderAfterCommit.current =
        value === null && inputOrigin.current === "pointer";
      onChange(next);
      setAnnouncement(
        next !== savedValue ? scenarioSetCopy(metric, next, laneName) : "",
      );
    },
    [lane, laneName, metric, onChange, savedValue, value],
  );

  React.useEffect(() => {
    if (!focusSliderAfterCommit.current || value === null) return;
    focusSliderAfterCommit.current = false;
    sliderHostRef.current
      ?.querySelector<HTMLElement>("[data-testid=slider-thumb] input")
      ?.focus();
  }, [value]);

  return (
    <div
      className={cn("grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]")}
      data-slot="school-chances-scenario-lane"
    >
      <div className={cn("flex flex-col gap-1.5")}>
        <div className={cn("flex items-baseline justify-between gap-2")}>
          <p className={cn("text-sm font-medium text-foreground")}>
            {lane.label}
          </p>
          <p
            className={cn(
              "text-xs text-[var(--school-fact-caveat)] tabular-nums",
            )}
          >
            {lane.min}
            {metric === "gpa" ? ".00" : ""}–{lane.max}
            {metric === "gpa" ? ".00" : ""}
          </p>
        </div>
        {value !== null ? (
          <div ref={sliderHostRef}>
            <Slider
              aria-label={`Explore ${scenarioLabel(metric, laneName)}`}
              aria-valuetext={`${formatted} ${scenarioLabel(metric, laneName)}`}
              max={lane.max}
              min={lane.min}
              onValueChange={(next) => {
                setError(null);
                onChange(next);
              }}
              onValueCommitted={(next) => {
                setError(null);
                setAnnouncement(
                  next !== savedValue
                    ? scenarioSetCopy(metric, next, laneName)
                    : "",
                );
              }}
              step={lane.step}
              value={value}
            />
          </div>
        ) : null}
      </div>
      <div className={cn("flex flex-col gap-1")}>
        <NumberField
          allowOutOfRange
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          max={lane.max}
          min={lane.min}
          onValueChange={(next) => {
            if (next === null || !onGrid(next, lane)) setError(errorCopy(lane));
          }}
          onValueCommitted={commit}
          step={lane.step}
          value={value}
        >
          <span className="sr-only">{lane.label} scenario</span>
          <NumberFieldGroup>
            <NumberFieldInput
              aria-describedby={error ? errorId : undefined}
              aria-invalid={Boolean(error)}
              aria-label={`${lane.label} scenario`}
              onInputCapture={(event) => {
                const raw = event.currentTarget.value.trim();
                const next = raw === "" ? null : Number(raw);
                if (next === null || !onGrid(next, lane))
                  setError(errorCopy(lane));
              }}
              onKeyDownCapture={() => {
                inputOrigin.current = "keyboard";
              }}
              onPointerDownCapture={() => {
                inputOrigin.current = "pointer";
              }}
              placeholder="Enter value"
            />
          </NumberFieldGroup>
        </NumberField>
        {error ? (
          <p
            className={cn("text-xs text-destructive")}
            id={errorId}
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {scenarioPosition(metric, lane.key, model) ? (
          <p
            className={cn("text-xs text-[var(--school-fact-caveat)]")}
            data-slot="school-chances-scenario-position"
          >
            {scenarioPosition(metric, lane.key, model)}
          </p>
        ) : null}
        {value === null && savedValue !== null ? (
          <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            {offGridCopy(metric, lane.step)}
          </p>
        ) : value === null ? (
          <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
            Enter a value to start exploring
          </p>
        ) : null}
      </div>
      <p
        aria-live="polite"
        className="sr-only"
        data-slot="school-chances-scenario-live"
      >
        {announcement}
      </p>
    </div>
  );
}
