import { AcademicComparisonPlot } from "./AcademicComparisonPlot";
import { dominantReportedPeriod, satLaneTitle } from "./school-chances-copy";
import type {
  ChancesScenarioInput,
  ScalarModel,
  ScoreLaneModel,
  SchoolChancesModel,
} from "./school-chances-model";
import { cn } from "@/lib/utils";

/**
 * The lane's own 30px value line (plan §4) — the analogue of the GPA/ACT
 * number row's "You" cell, since SAT has no three-number row of its own
 * (its two lanes replace that with this inline value beside each lane's
 * label). Mirrors `actNumberCells`' identical guard in
 * SchoolChancesPanel.tsx: a scenario only counts as "active" once the
 * lane's own saved value is itself placeable, and a lane with no student
 * score renders the DESIGN.md §15.5 absence treatment rather than a blank
 * or a fabricated number.
 */
function laneValueDisplay(lane: ScoreLaneModel): {
  value: string;
  absent: boolean;
  scenario: boolean;
} {
  const activeScenario = lane.profile.state === "value" ? lane.scenario : null;
  if (activeScenario)
    return { absent: false, scenario: true, value: String(activeScenario.value) };
  if (lane.profile.display !== null)
    return { absent: false, scenario: false, value: String(lane.profile.display) };
  return { absent: true, scenario: false, value: "Not added" };
}

/**
 * Comprehension fix (school-chances-minimal-redesign audit, MEDIUM): a
 * bare 30px number here reads as a range of the student's own scores, not
 * a single value, and on `full-sat` it is digit-for-digit identical to
 * this lane's own band upper bound in `ScoreEndpointLabels` below (both
 * render "760") with nothing distinguishing which is whose. Prefixing the
 * value with the same "You" word `actNumberCells`/`gpaNumberCells` already
 * use for the student's own number (SchoolChancesPanel.tsx) reuses
 * existing product vocabulary rather than inventing new copy, and sits on
 * the value's own baseline so it costs no extra row height. `data-slot` and
 * `data-scenario` stay on the outer element so the DOM order fix's
 * defect-1 test (label → value → plot) and the scenario-styling assertion
 * both keep matching the same node.
 */
function SatLaneValue({ lane }: { lane: ScoreLaneModel }): React.ReactElement {
  const { value, absent, scenario } = laneValueDisplay(lane);
  if (absent)
    return (
      <p className={cn("flex items-baseline gap-2")} data-slot="sat-lane-value">
        <span className={cn("text-xs text-[var(--school-fact-caveat)]")}>You</span>
        <span className={cn("text-[15px] text-[var(--school-fact-absent)]")}>
          {value}
        </span>
      </p>
    );
  return (
    <p
      className={cn("flex items-baseline gap-2")}
      data-scenario={scenario ? "true" : undefined}
      data-slot="sat-lane-value"
    >
      <span className={cn("text-xs text-[var(--school-fact-caveat)]")}>You</span>
      <span
        className={cn(
          "font-medium text-[30px] leading-none tracking-[-0.01em] tabular-nums",
          scenario ? "text-[var(--school-chances-scenario)]" : "text-foreground",
        )}
      >
        {value}
      </span>
    </p>
  );
}

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
    <section
      className={cn("grid gap-x-6 gap-y-6 md:grid-cols-2")}
      data-slot="sat-comparison"
    >
      {[math!, ebrw!].map((lane) => (
        /* `[data-slot="sat-lane"]` scopes `AcademicComparisonPlot`'s shared
         * <h3> down to this screen's 13px inline label (schools.css) — that
         * component is shared with the ACT tab, so its restyling stays
         * confined to this ancestor selector rather than a global rule.
         * The label/value/plot sequence itself is real DOM order now
         * (`AcademicComparisonPlot`'s own `valueSlot` prop): defect 1 fix,
         * school-chances-minimal-redesign — the previous `display: contents`
         * + CSS `order` interleave only reordered paint, so a screen reader
         * read the bare value before anything said what it was. */
        <div data-slot="sat-lane" key={lane.key}>
          <AcademicComparisonPlot
            endpointsVariant="band"
            lane={lane}
            metric="sat"
            onScenarioChange={onScenarioChange}
            periodBaseline={periodBaseline}
            profile={profile}
            scenario={scenario}
            testPolicy={testPolicy}
            title={satLaneTitle(lane.key === "math" ? "math" : "ebrw")}
            valueSlot={<SatLaneValue lane={lane} />}
          />
        </div>
      ))}
    </section>
  );
}
