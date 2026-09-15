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
      {testPolicy ? (
        <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
          Testing policy: {testPolicy.display}
          {testPolicy.reportedPeriod
            ? ` · Reported ${testPolicy.reportedPeriod}`
            : ""}
        </p>
      ) : null}
      <AcademicComparisonPlot
        lane={model}
        testPolicy={testPolicy}
        title="Composite"
      />
    </section>
  );
}
