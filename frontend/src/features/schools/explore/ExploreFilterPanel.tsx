import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  calendarOptions,
  dataWindowOptions,
  genderOptions,
  greekOptions,
  panelGroups,
  rangeDescriptorByKey,
  testPolicyOptions,
} from "@/features/schools/explore/explore-config";
import {
  CheckboxRow,
  FilterGroupHeading,
  RangeFields,
} from "@/features/schools/explore/explore-controls";
import type {
  CalendarFilter,
  DataWindow,
  ExploreFilters,
  GenderFilter,
  GreekFilter,
  NumericRange,
  RangeKey,
  TestPolicyFilter,
} from "@/features/schools/explore/explore-types";

/*
 * Tier 2. Disclosed inline below the bar rather than in a modal: the user
 * needs to watch the result count move as they set filters, and a modal is
 * the lazy first thought that hides exactly the feedback that makes the
 * panel worth opening.
 *
 * Six groups, a clean 3x2. The seventh candidate — data quality — docks
 * into the footer instead, because it is a lens over the whole result set
 * rather than a property of a school.
 */

type PanelProps = {
  filters: ExploreFilters;
  activeCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (update: (current: ExploreFilters) => ExploreFilters) => void;
  onRangeChange: (key: RangeKey, range: NumericRange) => void;
  onClearAll: () => void;
};

type GroupProps = Pick<PanelProps, "filters" | "onChange" | "onRangeChange">;

function BoolRow({
  id,
  label,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <CheckboxRow htmlFor={id}>
      <Checkbox checked={checked} id={id} onCheckedChange={onToggle} />
      {label}
    </CheckboxRow>
  );
}

function MoneyGroup({ filters, onChange, onRangeChange }: GroupProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Money</FilterGroupHeading>
      <RangeFields
        descriptor={rangeDescriptorByKey.needMet}
        onChange={(range) => onRangeChange("needMet", range)}
        range={filters.ranges.needMet}
      />
      <RangeFields
        descriptor={rangeDescriptorByKey.meritAid}
        onChange={(range) => onRangeChange("meritAid", range)}
        range={filters.ranges.meritAid}
      />
      <BoolRow
        checked={filters.noApplicationFee}
        id="filter-no-fee"
        label="No application fee"
        onToggle={(next) =>
          onChange((current) => ({ ...current, noApplicationFee: next }))
        }
      />
    </section>
  );
}

function RoundsGroup({ filters, onChange }: GroupProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Rounds &amp; deadlines</FilterGroupHeading>
      <BoolRow
        checked={filters.offersEarlyDecision}
        id="filter-ed"
        label="Offers Early Decision"
        onToggle={(next) =>
          onChange((current) => ({ ...current, offersEarlyDecision: next }))
        }
      />
      <BoolRow
        checked={filters.offersEarlyAction}
        id="filter-ea"
        label="Offers Early Action"
        onToggle={(next) =>
          onChange((current) => ({ ...current, offersEarlyAction: next }))
        }
      />
      {/* Restrictive EA constrains the entire round plan, so it gets its
       * own exclusion rather than hiding inside "offers EA". */}
      <BoolRow
        checked={filters.excludeRestrictiveEarlyAction}
        id="filter-no-rea"
        label="Exclude restrictive EA (REA/SCEA)"
        onToggle={(next) =>
          onChange((current) => ({
            ...current,
            excludeRestrictiveEarlyAction: next,
          }))
        }
      />
      <BoolRow
        checked={filters.rollingAdmission}
        id="filter-rolling"
        label="Rolling admission"
        onToggle={(next) =>
          onChange((current) => ({ ...current, rollingAdmission: next }))
        }
      />
    </section>
  );
}

function TestingGroup({ filters, onChange }: GroupProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Testing</FilterGroupHeading>
      <SegmentedControl
        className="w-full"
        label="Test policy"
        onValueChange={(value: TestPolicyFilter) =>
          onChange((current) => ({ ...current, testPolicy: value }))
        }
        options={testPolicyOptions}
        value={filters.testPolicy}
      />
      <p className="text-xs text-[var(--ink-muted)]">
        As reported on the school&rsquo;s Common Data Set. Policies change and
        can be program-specific — always re-check the school&rsquo;s own site.
      </p>
    </section>
  );
}

function OutcomesGroup({ filters, onRangeChange }: GroupProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Outcomes</FilterGroupHeading>
      <RangeFields
        descriptor={rangeDescriptorByKey.gradRate}
        onChange={(range) => onRangeChange("gradRate", range)}
        range={filters.ranges.gradRate}
      />
      <RangeFields
        descriptor={rangeDescriptorByKey.retention}
        onChange={(range) => onRangeChange("retention", range)}
        range={filters.ranges.retention}
      />
    </section>
  );
}

function CampusGroup({ filters, onChange, onRangeChange }: GroupProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Campus</FilterGroupHeading>
      <RangeFields
        descriptor={rangeDescriptorByKey.ratio}
        onChange={(range) => onRangeChange("ratio", range)}
        range={filters.ranges.ratio}
      />
      <RangeFields
        descriptor={rangeDescriptorByKey.housing}
        onChange={(range) => onRangeChange("housing", range)}
        range={filters.ranges.housing}
      />
      <SegmentedControl
        className="w-full"
        label="Greek life"
        onValueChange={(value: GreekFilter) =>
          onChange((current) => ({ ...current, greek: value }))
        }
        options={greekOptions}
        value={filters.greek}
      />
    </section>
  );
}

function BodyGroup({ filters, onChange, onRangeChange }: GroupProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Student body</FilterGroupHeading>
      <RangeFields
        descriptor={rangeDescriptorByKey.outOfState}
        onChange={(range) => onRangeChange("outOfState", range)}
        range={filters.ranges.outOfState}
      />
      <RangeFields
        descriptor={rangeDescriptorByKey.international}
        onChange={(range) => onRangeChange("international", range)}
        range={filters.ranges.international}
      />
      <SegmentedControl
        className="w-full"
        label="Coed or single-sex"
        onValueChange={(value: GenderFilter) =>
          onChange((current) => ({ ...current, gender: value }))
        }
        options={genderOptions}
        value={filters.gender}
      />
      <SegmentedControl
        className="w-full"
        label="Academic calendar"
        onValueChange={(value: CalendarFilter) =>
          onChange((current) => ({ ...current, calendar: value }))
        }
        options={calendarOptions}
        value={filters.calendar}
      />
    </section>
  );
}

const GROUP_COMPONENTS: Record<
  (typeof panelGroups)[number]["id"],
  (props: GroupProps) => ReactElement
> = {
  body: BodyGroup,
  campus: CampusGroup,
  money: MoneyGroup,
  outcomes: OutcomesGroup,
  rounds: RoundsGroup,
  testing: TestingGroup,
};

function PanelGrid(props: GroupProps) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
      {panelGroups.map((group) => {
        const Group = GROUP_COMPONENTS[group.id];
        return <Group key={group.id} {...props} />;
      })}
    </div>
  );
}

function DataQualityFooter({
  filters,
  activeCount,
  onChange,
  onClearAll,
  onDone,
}: Pick<PanelProps, "filters" | "activeCount" | "onChange" | "onClearAll"> & {
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--ink-secondary)]">
            Data
          </span>
          <SegmentedControl
            label="Data recency"
            onValueChange={(value: DataWindow) =>
              onChange((current) => ({ ...current, dataWindow: value }))
            }
            options={dataWindowOptions}
            value={filters.dataWindow}
          />
        </div>
        <p className="max-w-md text-xs text-[var(--ink-muted)]">
          Admit rates from different reporting years aren&rsquo;t comparable.
          Schools outside your window stay visible but are marked.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <span
          aria-live="polite"
          className="text-xs text-[var(--ink-muted)] tabular-nums"
        >
          {activeCount} active
        </span>
        <Button
          disabled={activeCount === 0}
          onClick={onClearAll}
          size="sm"
          variant="ghost"
        >
          Clear all
        </Button>
        <Button onClick={onDone} size="sm" variant="outline">
          Done
        </Button>
      </div>
    </div>
  );
}

export function ExploreFilterPanel({
  filters,
  activeCount,
  open,
  onOpenChange,
  onChange,
  onRangeChange,
  onClearAll,
}: PanelProps) {
  const isMobile = useIsMobile();
  const groupProps: GroupProps = { filters, onChange, onRangeChange };
  const footer = (
    <DataQualityFooter
      activeCount={activeCount}
      filters={filters}
      onChange={onChange}
      onClearAll={onClearAll}
      onDone={() => onOpenChange(false)}
    />
  );

  if (isMobile) {
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetPopup className="max-h-[86svh]" side="bottom">
          <SheetHeader>
            <SheetTitle>More filters</SheetTitle>
            <SheetDescription>
              Narrow the catalog. The result count updates as you go.
            </SheetDescription>
          </SheetHeader>
          <SheetPanel>
            <PanelGrid {...groupProps} />
          </SheetPanel>
          <SheetFooter className="border-t">{footer}</SheetFooter>
        </SheetPopup>
      </Sheet>
    );
  }

  return (
    // grid-template-rows 0fr -> 1fr, never height:auto — the only way to
    // animate a disclosure to its natural height without measuring it.
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">
        {/* `inert`, not `hidden`: the panel has to stay in the box while
         * the rows animate closed, but nothing inside it may keep taking
         * tab focus once it's collapsed. */}
        <div
          className="flex flex-col gap-5 rounded-xl border border-[var(--school-filter-panel-border)] bg-[var(--school-filter-panel-surface)] p-5 opacity-100 transition-opacity duration-200 ease-out inert:opacity-0 motion-reduce:transition-none"
          id="explore-filter-panel"
          inert={!open}
        >
          <PanelGrid {...groupProps} />
          <div className="border-t pt-4">{footer}</div>
        </div>
      </div>
    </div>
  );
}
