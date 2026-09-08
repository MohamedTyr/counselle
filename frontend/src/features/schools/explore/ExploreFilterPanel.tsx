import type { ReactElement } from "react";

import type { FilterOption } from "@/api/schools/explore";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  calendarOptions,
  entranceDifficultyOptions,
  genderOptions,
  panelGroups,
  rangeDescriptorByKey,
  testPolicyOptions,
} from "@/features/schools/explore/explore-config";
import { CheckboxRow, FilterGroupHeading, RangeFields } from "@/features/schools/explore/explore-controls";
import { formatDeadlineDate } from "@/features/schools/explore/explore-format";
import type {
  ExploreFilters,
  Gender,
  NumericRange,
  RangeKey,
  TestPolicy,
} from "@/features/schools/explore/explore-types";
import { useIsMobile } from "@/hooks/use-mobile";

/*
 * Tier 2. Disclosed inline below the bar rather than in a modal: the
 * student needs to watch the result count move as they set filters, and a
 * modal is the lazy first thought that hides exactly the feedback that
 * makes the panel worth opening.
 */

type PanelProps = {
  filters: ExploreFilters;
  activeCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (update: (current: ExploreFilters) => ExploreFilters) => void;
  onRangeChange: (key: RangeKey, range: NumericRange) => void;
  onClearAll: () => void;
  campusSettingOptions: readonly FilterOption[];
  religiousAffiliationOptions: readonly FilterOption[];
  religiousAffiliationNote: string | null;
  entranceDifficultyNote: string | null;
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
      <div className="flex flex-col gap-1">
        <RangeFields
          descriptor={rangeDescriptorByKey.needFullyMet}
          onChange={(range) => onRangeChange("needFullyMet", range)}
          range={filters.ranges.needFullyMet}
        />
        <p className="text-xs text-[var(--ink-muted)]">
          {rangeDescriptorByKey.needFullyMet.description}
        </p>
      </div>
      <RangeFields
        descriptor={rangeDescriptorByKey.meritAid}
        onChange={(range) => onRangeChange("meritAid", range)}
        range={filters.ranges.meritAid}
      />
      <BoolRow
        checked={filters.noApplicationFee}
        id="filter-no-fee"
        label="No application fee"
        onToggle={(next) => onChange((current) => ({ ...current, noApplicationFee: next }))}
      />
    </section>
  );
}

function DeadlineBeforeControl({ filters, onChange }: Pick<GroupProps, "filters" | "onChange">) {
  const selected = filters.deadlineBefore ? new Date(`${filters.deadlineBefore}T00:00:00`) : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-[var(--ink-secondary)]">Deadline before</span>
      <Popover>
        <PopoverTrigger className="inline-flex h-8 w-fit items-center rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]">
          {formatDeadlineDate(filters.deadlineBefore) ?? "Any date"}
        </PopoverTrigger>
        <PopoverPopup align="start" className="w-auto">
          <Calendar
            mode="single"
            onSelect={(date) =>
              onChange((current) => ({
                ...current,
                deadlineBefore: date ? date.toISOString().slice(0, 10) : null,
              }))
            }
            selected={selected}
          />
          {filters.deadlineBefore ? (
            <div className="border-t px-2 py-2">
              <Button
                className="w-full justify-center"
                onClick={() => onChange((current) => ({ ...current, deadlineBefore: null }))}
                size="sm"
                type="button"
                variant="ghost"
              >
                Clear
              </Button>
            </div>
          ) : null}
        </PopoverPopup>
      </Popover>
    </div>
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
        onToggle={(next) => onChange((current) => ({ ...current, offersEarlyDecision: next }))}
      />
      <BoolRow
        checked={filters.offersEarlyAction}
        id="filter-ea"
        label="Offers Early Action"
        onToggle={(next) => onChange((current) => ({ ...current, offersEarlyAction: next }))}
      />
      <BoolRow
        checked={filters.rollingAdmission}
        id="filter-rolling"
        label="Rolling admission"
        onToggle={(next) => onChange((current) => ({ ...current, rollingAdmission: next }))}
      />
      <DeadlineBeforeControl filters={filters} onChange={onChange} />
      <BoolRow
        checked={filters.includeRolling}
        id="filter-include-rolling"
        label="Also include rolling-admission schools"
        onToggle={(next) => onChange((current) => ({ ...current, includeRolling: next }))}
      />
    </section>
  );
}

function TestingGroup({
  filters,
  onChange,
  entranceDifficultyNote,
}: GroupProps & { entranceDifficultyNote: string | null }) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Testing</FilterGroupHeading>
      <SegmentedControl
        className="w-full"
        label="Test policy"
        onValueChange={(value: TestPolicy | "any") =>
          onChange((current) => ({ ...current, testPolicy: value }))
        }
        options={testPolicyOptions}
        value={filters.testPolicy}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-[var(--ink-secondary)]">Entrance difficulty</span>
        <Select
          onValueChange={(value) =>
            onChange((current) => ({
              ...current,
              entranceDifficulty: value === "any" ? null : String(value),
            }))
          }
          value={filters.entranceDifficulty ?? "any"}
        >
          <SelectTrigger className="w-full" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            {entranceDifficultyOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {entranceDifficultyNote ? (
          <p className="text-xs text-[var(--ink-muted)]">{entranceDifficultyNote}</p>
        ) : null}
      </div>
    </section>
  );
}

function OutcomesGroup({ filters, onRangeChange }: GroupProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Outcomes</FilterGroupHeading>
      <RangeFields
        descriptor={rangeDescriptorByKey.gradFour}
        onChange={(range) => onRangeChange("gradFour", range)}
        range={filters.ranges.gradFour}
      />
      <RangeFields
        descriptor={rangeDescriptorByKey.gradSix}
        onChange={(range) => onRangeChange("gradSix", range)}
        range={filters.ranges.gradSix}
      />
      <RangeFields
        descriptor={rangeDescriptorByKey.retention}
        onChange={(range) => onRangeChange("retention", range)}
        range={filters.ranges.retention}
      />
    </section>
  );
}

function CampusGroup({
  filters,
  onChange,
  onRangeChange,
  campusSettingOptions,
}: GroupProps & { campusSettingOptions: readonly FilterOption[] }) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Campus</FilterGroupHeading>
      <div className="flex flex-col gap-1">
        <RangeFields
          descriptor={rangeDescriptorByKey.ratio}
          onChange={(range) => onRangeChange("ratio", range)}
          range={filters.ranges.ratio}
        />
        <p className="text-xs text-[var(--ink-muted)]">{rangeDescriptorByKey.ratio.description}</p>
      </div>
      <RangeFields
        descriptor={rangeDescriptorByKey.housing}
        onChange={(range) => onRangeChange("housing", range)}
        range={filters.ranges.housing}
      />
      {campusSettingOptions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-[var(--ink-secondary)]">Campus setting</span>
          <div className="flex flex-col gap-2.5">
            {campusSettingOptions.map((option) => (
              <CheckboxRow htmlFor={`campus-${option.value}`} key={option.value}>
                <Checkbox
                  checked={filters.campusSetting.includes(
                    option.value as ExploreFilters["campusSetting"][number],
                  )}
                  id={`campus-${option.value}`}
                  onCheckedChange={() =>
                    onChange((current) => ({
                      ...current,
                      campusSetting: current.campusSetting.includes(
                        option.value as ExploreFilters["campusSetting"][number],
                      )
                        ? current.campusSetting.filter((entry) => entry !== option.value)
                        : [
                            ...current.campusSetting,
                            option.value as ExploreFilters["campusSetting"][number],
                          ],
                    }))
                  }
                />
                {option.label}
              </CheckboxRow>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-[var(--ink-secondary)]">Academic calendar</span>
        <Select
          onValueChange={(value) =>
            onChange((current) => ({ ...current, calendar: value === "any" ? null : String(value) }))
          }
          value={filters.calendar ?? "any"}
        >
          <SelectTrigger className="w-full" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            {calendarOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}

function ReligiousAffiliationControl({
  filters,
  onChange,
  options,
  note,
}: GroupProps & { options: readonly FilterOption[]; note: string | null }) {
  const selectedLabel =
    filters.religiousAffiliation === "any_affiliated"
      ? "Religiously affiliated (any)"
      : filters.religiousAffiliation === "none_on_file"
        ? "No affiliation on file"
        : filters.religiousAffiliation;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-[var(--ink-secondary)]">Religious affiliation</span>
      <Popover>
        <PopoverTrigger className="inline-flex h-8 w-full items-center justify-between rounded-lg border border-input bg-background px-2.5 text-start text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)]">
          <span className="truncate">{selectedLabel ?? "Any"}</span>
        </PopoverTrigger>
        <PopoverPopup align="start" className="w-72">
          <Command>
            <CommandList>
              <CommandGroup>
                <CommandItem
                  onSelect={() => onChange((current) => ({ ...current, religiousAffiliation: null }))}
                  value="any"
                >
                  <Checkbox checked={filters.religiousAffiliation === null} tabIndex={-1} />
                  Any
                </CommandItem>
                <CommandItem
                  onSelect={() =>
                    onChange((current) => ({ ...current, religiousAffiliation: "any_affiliated" }))
                  }
                  value="any_affiliated"
                >
                  <Checkbox
                    checked={filters.religiousAffiliation === "any_affiliated"}
                    tabIndex={-1}
                  />
                  Religiously affiliated (any)
                </CommandItem>
                <CommandItem
                  onSelect={() =>
                    onChange((current) => ({ ...current, religiousAffiliation: "none_on_file" }))
                  }
                  value="none_on_file"
                >
                  <Checkbox checked={filters.religiousAffiliation === "none_on_file"} tabIndex={-1} />
                  No affiliation on file
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Named affiliations">
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    onSelect={() =>
                      onChange((current) => ({ ...current, religiousAffiliation: option.value }))
                    }
                    value={option.value}
                  >
                    <Checkbox
                      checked={filters.religiousAffiliation === option.value}
                      tabIndex={-1}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverPopup>
      </Popover>
      {note ? <p className="text-xs text-[var(--ink-muted)]">{note}</p> : null}
    </div>
  );
}

function BodyGroup({
  filters,
  onChange,
  onRangeChange,
  religiousAffiliationOptions,
  religiousAffiliationNote,
}: GroupProps & {
  religiousAffiliationOptions: readonly FilterOption[];
  religiousAffiliationNote: string | null;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <FilterGroupHeading>Student body</FilterGroupHeading>
      <RangeFields
        descriptor={rangeDescriptorByKey.international}
        onChange={(range) => onRangeChange("international", range)}
        range={filters.ranges.international}
      />
      <SegmentedControl
        className="w-full"
        label="Coed or single-sex"
        onValueChange={(value: Gender | "any") => onChange((current) => ({ ...current, gender: value }))}
        options={genderOptions}
        value={filters.gender}
      />
      <ReligiousAffiliationControl
        filters={filters}
        note={religiousAffiliationNote}
        onChange={onChange}
        onRangeChange={onRangeChange}
        options={religiousAffiliationOptions}
      />
      <div className="flex flex-col gap-2.5">
        <BoolRow
          checked={filters.hbcu}
          id="filter-hbcu"
          label="Historically Black college or university"
          onToggle={(next) => onChange((current) => ({ ...current, hbcu: next }))}
        />
        <BoolRow
          checked={filters.hsi}
          id="filter-hsi"
          label="Hispanic-serving institution"
          onToggle={(next) => onChange((current) => ({ ...current, hsi: next }))}
        />
        <BoolRow
          checked={filters.tribal}
          id="filter-tribal"
          label="Tribal college"
          onToggle={(next) => onChange((current) => ({ ...current, tribal: next }))}
        />
        <BoolRow
          checked={filters.landGrant}
          id="filter-land-grant"
          label="Land-grant institution"
          onToggle={(next) => onChange((current) => ({ ...current, landGrant: next }))}
        />
      </div>
    </section>
  );
}

function PanelGrid(
  props: GroupProps & {
    campusSettingOptions: readonly FilterOption[];
    religiousAffiliationOptions: readonly FilterOption[];
    religiousAffiliationNote: string | null;
    entranceDifficultyNote: string | null;
  },
) {
  const groups: Record<(typeof panelGroups)[number]["id"], () => ReactElement> = {
    body: () => (
      <BodyGroup
        {...props}
        religiousAffiliationNote={props.religiousAffiliationNote}
        religiousAffiliationOptions={props.religiousAffiliationOptions}
      />
    ),
    campus: () => <CampusGroup {...props} campusSettingOptions={props.campusSettingOptions} />,
    money: () => <MoneyGroup {...props} />,
    outcomes: () => <OutcomesGroup {...props} />,
    rounds: () => <RoundsGroup {...props} />,
    testing: () => (
      <TestingGroup {...props} entranceDifficultyNote={props.entranceDifficultyNote} />
    ),
  };

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
      {panelGroups.map((group) => (
        <div key={group.id}>{groups[group.id]()}</div>
      ))}
    </div>
  );
}

function PanelFooter({
  activeCount,
  onClearAll,
  onDone,
}: Pick<PanelProps, "activeCount" | "onClearAll"> & { onDone: () => void }) {
  return (
    <div className="flex items-center justify-end gap-3">
      <span aria-live="polite" className="text-xs text-[var(--ink-muted)] tabular-nums">
        {activeCount} active
      </span>
      <Button disabled={activeCount === 0} onClick={onClearAll} size="sm" variant="ghost">
        Clear all
      </Button>
      <Button onClick={onDone} size="sm" variant="outline">
        Done
      </Button>
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
  campusSettingOptions,
  religiousAffiliationOptions,
  religiousAffiliationNote,
  entranceDifficultyNote,
}: PanelProps) {
  const isMobile = useIsMobile();
  const gridProps = {
    campusSettingOptions,
    entranceDifficultyNote,
    filters,
    onChange,
    onRangeChange,
    religiousAffiliationNote,
    religiousAffiliationOptions,
  };
  const footer = (
    <PanelFooter
      activeCount={activeCount}
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
            <SheetDescription>Narrow the catalog. The result count updates as you go.</SheetDescription>
          </SheetHeader>
          <SheetPanel>
            <PanelGrid {...gridProps} />
          </SheetPanel>
          <SheetFooter className="border-t">{footer}</SheetFooter>
        </SheetPopup>
      </Sheet>
    );
  }

  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">
        <div
          className="flex flex-col gap-5 rounded-xl border border-[var(--school-filter-panel-border)] bg-[var(--school-filter-panel-surface)] p-5 opacity-100 transition-opacity duration-200 ease-out inert:opacity-0 motion-reduce:transition-none"
          id="explore-filter-panel"
          inert={!open}
        >
          <PanelGrid {...gridProps} />
          <div className="border-t pt-4">{footer}</div>
        </div>
      </div>
    </div>
  );
}
