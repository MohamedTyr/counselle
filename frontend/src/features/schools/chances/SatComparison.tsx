import { AcademicComparisonPlot } from "./AcademicComparisonPlot";
import { dominantReportedPeriod } from "./school-chances-copy";
import type {
  ChancesScenarioInput,
  ScalarModel,
  SchoolChancesModel,
} from "./school-chances-model";
import { cn } from "@/lib/utils";

export function SatComparison({
  model,
  testPolicy,
  profile,
  scenario,
  onScenarioChange,
}: {
  model: NonNullable<SchoolChancesModel["sat"]>;
  testPolicy: ScalarModel;
  profile: ChancesScenarioInput;
  scenario: ChancesScenarioInput;
  onScenarioChange: (next: ChancesScenarioInput) => void;
}): React.ReactElement {
  const [math, ebrw] = model.lanes;
  /* Both lanes share one reporting-period baseline (plan §6) so a period
   * that's identical across the screen collapses into the header freshness
   * line, and only a field that genuinely diverges — the "Different
   * reported periods" dev fixture — still prints beside its own number. */
  const periodBaseline = dominantReportedPeriod(
    model.lanes.flatMap((lane) => [
      lane.band?.reportedPeriod,
      lane.distribution?.reportedPeriod,
      lane.average?.reportedPeriod,
    ]),
  );
  return (
    <section className={cn("flex flex-col gap-5")} data-slot="sat-comparison">
      {/* SAT's own two-lane layout is P4 scope (plan §4); this preserves the
       * one piece of information the deleted ledger carried that has no
       * other home yet, rather than dropping it silently. */}
      {model.totalContext ? (
        <p className={cn("text-xs text-[var(--school-fact-caveat)]")}>
          Your SAT {model.totalContext.display} shown for context
        </p>
      ) : null}
      <AcademicComparisonPlot
        lane={math!}
        metric="sat"
        onScenarioChange={onScenarioChange}
        periodBaseline={periodBaseline}
        profile={profile}
        scenario={scenario}
        testPolicy={testPolicy}
        title="Math"
      />
      <AcademicComparisonPlot
        lane={ebrw!}
        metric="sat"
        onScenarioChange={onScenarioChange}
        periodBaseline={periodBaseline}
        profile={profile}
        scenario={scenario}
        testPolicy={testPolicy}
        title="Reading and Writing"
      />
    </section>
  );
}
