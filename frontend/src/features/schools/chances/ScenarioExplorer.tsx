import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ScenarioLaneControl } from "./ScenarioLaneControl";
import {
  hasChangedMetricScenario,
  laneConfigs,
  laneIsComparable,
  profileValue,
  withChangedLane,
  withoutMetric,
} from "./scenario-explorer-model";
import type {
  ChancesMetric,
  ChancesScenarioInput,
  SchoolChancesModel,
} from "./school-chances-model";

/** The panel-level shell owns scenario lifetime; each lane owns its input UX. */
export function ScenarioExplorer({
  metric,
  model,
  profile,
  scenario,
  onScenarioChange,
}: {
  metric: ChancesMetric;
  model: SchoolChancesModel;
  profile: ChancesScenarioInput;
  scenario: ChancesScenarioInput;
  onScenarioChange: (scenario: ChancesScenarioInput) => void;
}): React.ReactElement | null {
  const lanes = laneConfigs(metric, profile, scenario).filter((lane) =>
    laneIsComparable(metric, lane.key, model),
  );
  if (!lanes.length) return null;

  return (
    <section
      className={cn(
        "flex flex-col gap-4 border-t border-[var(--school-chances-divider)] p-4",
      )}
      data-slot="school-chances-explorer"
    >
      <div
        className={cn(
          "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1",
        )}
      >
        <h3 className={cn("font-medium text-foreground")}>Explore</h3>
        <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
          Local scenario only
        </p>
      </div>
      {lanes.map((lane) => (
        <ScenarioLaneControl
          key={lane.key}
          lane={lane}
          metric={metric}
          model={model}
          onChange={(value) =>
            onScenarioChange(
              withChangedLane(scenario, profile, metric, lane.key, value),
            )
          }
          savedValue={profileValue(metric, lane.key, profile)}
        />
      ))}
      {hasChangedMetricScenario(metric, profile, scenario) ? (
        <Button
          className={cn("self-start")}
          onClick={() => onScenarioChange(withoutMetric(metric, scenario))}
          size="sm"
          variant="outline"
        >
          {metric === "gpa"
            ? "Reset to your GPA"
            : metric === "sat"
              ? "Reset SAT"
              : "Reset to your ACT"}
        </Button>
      ) : null}
    </section>
  );
}
