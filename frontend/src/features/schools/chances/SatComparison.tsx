import { AcademicComparisonPlot } from "./AcademicComparisonPlot";
import type { ScalarModel, SchoolChancesModel } from "./school-chances-model";
import { cn } from "@/lib/utils";

export function SatComparison({
  model,
  testPolicy,
}: {
  model: NonNullable<SchoolChancesModel["sat"]>;
  testPolicy: ScalarModel;
}): React.ReactElement {
  return (
    <section className={cn("flex flex-col gap-5")} data-slot="sat-comparison">
      {testPolicy ? (
        <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
          Testing policy: {testPolicy.display}
          {testPolicy.reportedPeriod
            ? ` · Reported ${testPolicy.reportedPeriod}`
            : ""}
        </p>
      ) : null}
      <AcademicComparisonPlot
        lane={model.lanes[0]!}
        testPolicy={testPolicy}
        title="Math"
      />
      <AcademicComparisonPlot
        lane={model.lanes[1]!}
        testPolicy={testPolicy}
        title="Reading and Writing"
      />
    </section>
  );
}
