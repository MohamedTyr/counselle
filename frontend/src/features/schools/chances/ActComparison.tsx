import { AcademicComparisonPlot } from "./AcademicComparisonPlot";
import type { ScalarModel, ScoreLaneModel } from "./school-chances-model";
import { cn } from "@/lib/utils";

export function ActComparison({
  model,
  testPolicy,
}: {
  model: ScoreLaneModel;
  testPolicy: ScalarModel;
}): React.ReactElement {
  return (
    <section className={cn("flex flex-col gap-4")} data-slot="act-comparison">
      <AcademicComparisonPlot
        lane={model}
        testPolicy={testPolicy}
        title="Composite"
      />
    </section>
  );
}
