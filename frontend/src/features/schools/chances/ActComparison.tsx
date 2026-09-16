import { AcademicComparisonPlot } from "./AcademicComparisonPlot";
import type {
  ChancesScenarioInput,
  ScalarModel,
  ScoreLaneModel,
} from "./school-chances-model";
import { cn } from "@/lib/utils";

export function ActComparison({
  model,
  testPolicy,
  profile,
  scenario,
  onScenarioChange,
}: {
  model: ScoreLaneModel;
  testPolicy: ScalarModel;
  profile: ChancesScenarioInput;
  scenario: ChancesScenarioInput;
  onScenarioChange: (next: ChancesScenarioInput) => void;
}): React.ReactElement {
  return (
    <section className={cn("flex flex-col gap-4")} data-slot="act-comparison">
      <AcademicComparisonPlot
        lane={model}
        metric="act"
        onScenarioChange={onScenarioChange}
        profile={profile}
        scenario={scenario}
        testPolicy={testPolicy}
        title="Composite"
      />
    </section>
  );
}
