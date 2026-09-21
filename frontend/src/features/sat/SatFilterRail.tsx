/**
 * The dashboard's filter rail (plan §5.2; ui-spec §3.3; parity F3, F6-F8):
 * status, exclude-Bluebook, difficulty bands, and the Start button — one
 * rail, not three pass-throughs.
 */
import type React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { ToggleBand, type ToggleBandOption } from "@/components/ui/toggle-band";
import { SAT_DASHBOARD_COPY } from "@/features/sat/sat-copy";
import { cn } from "@/lib/utils";
import type { SatBandTier, SatSolvedStatus } from "@/api/sat/types";

const STATUS_OPTIONS: readonly SegmentedControlOption<SatSolvedStatus>[] = [
  { value: "all", label: SAT_DASHBOARD_COPY.statusOptions.all },
  { value: "unsolved", label: SAT_DASHBOARD_COPY.statusOptions.unsolved },
  { value: "incorrect", label: SAT_DASHBOARD_COPY.statusOptions.incorrect },
  { value: "bookmarked", label: SAT_DASHBOARD_COPY.statusOptions.bookmarked },
];

const TIER_LABELS: Record<string, string> = {
  Easy: SAT_DASHBOARD_COPY.difficultyTiers.easy,
  Medium: SAT_DASHBOARD_COPY.difficultyTiers.medium,
  Hard: SAT_DASHBOARD_COPY.difficultyTiers.hard,
};

export interface SatFilterRailProps {
  status: SatSolvedStatus;
  onStatusChange: (status: SatSolvedStatus) => void;
  excludeBluebook: boolean;
  onExcludeBluebookChange: (value: boolean) => void;
  bandTiers: readonly SatBandTier[];
  selectedBands: ReadonlySet<number>;
  onToggleBand: (band: number) => void;
  onToggleTier: (bands: readonly number[], nextChecked: boolean) => void;
  startDisabledReason: string | null;
  isStarting: boolean;
  onStart: () => void;
}

export interface SatStartSessionButtonProps {
  startDisabledReason: string | null;
  isStarting: boolean;
  onStart: () => void;
  className?: string;
}

/** The Start session control itself (ui-spec §3.3), shared by two DOM
 * positions: in flow inside `SatFilterRail` at 640 cw and up, and as
 * `SatDashboard`'s mobile-only sticky footer below it (F18's "ADD" —
 * upstream leaves it mid-page in the filter card, ours pins it to the
 * bottom of the scroll container on a phone instead). One control, one
 * definition; which copy is in the DOM at a given width is CSS-only. */
export function SatStartSessionButton({
  startDisabledReason,
  isStarting,
  onStart,
  className,
}: SatStartSessionButtonProps): React.ReactElement {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Button
        className="w-full"
        disabled={startDisabledReason !== null}
        loading={isStarting}
        onClick={onStart}
        size="lg"
      >
        {SAT_DASHBOARD_COPY.startSession}
      </Button>
      {startDisabledReason !== null && (
        <span className="text-xs text-[var(--ink-secondary)]">{startDisabledReason}</span>
      )}
    </div>
  );
}

export function SatFilterRail({
  status,
  onStatusChange,
  excludeBluebook,
  onExcludeBluebookChange,
  bandTiers,
  selectedBands,
  onToggleBand,
  onToggleTier,
  startDisabledReason,
  isStarting,
  onStart,
}: SatFilterRailProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4" data-slot="sat-filter-rail">
      <h2 className="text-sm font-semibold">{SAT_DASHBOARD_COPY.filterHeading}</h2>

      <SegmentedControl
        columns={2}
        label={SAT_DASHBOARD_COPY.filterHeading}
        onValueChange={onStatusChange}
        options={STATUS_OPTIONS}
        value={status}
      />

      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox
          checked={excludeBluebook}
          onCheckedChange={(checked) => onExcludeBluebookChange(checked === true)}
        />
        <span className="text-sm">{SAT_DASHBOARD_COPY.excludeBluebookLabel}</span>
      </label>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{SAT_DASHBOARD_COPY.difficultyHeading}</h3>
        {bandTiers.map((tier) => {
          const tierAllSelected = tier.bands.every((band) => selectedBands.has(band));
          const options: readonly ToggleBandOption<string>[] = tier.bands.map((band) => ({
            value: String(band),
            label: band,
          }));
          const value = tier.bands.filter((band) => selectedBands.has(band)).map(String);
          return (
            <div className="flex items-center justify-between gap-3" key={tier.name}>
              <Button
                onClick={() => onToggleTier(tier.bands, !tierAllSelected)}
                size="sm"
                variant="ghost"
              >
                {TIER_LABELS[tier.name] ?? tier.name}
              </Button>
              <ToggleBand
                label={TIER_LABELS[tier.name] ?? tier.name}
                onValueChange={(next) => {
                  const nextBands = new Set(next.map(Number));
                  for (const band of tier.bands) {
                    const wasSelected = selectedBands.has(band);
                    const isSelected = nextBands.has(band);
                    if (wasSelected !== isSelected) {
                      onToggleBand(band);
                    }
                  }
                }}
                options={options}
                value={value}
              />
            </div>
          );
        })}
      </div>

      {/* Below 640 cw, `SatDashboard` renders this same control as a sticky
       * page footer instead (F18's "ADD") — this in-flow copy is hidden
       * there so the two never show at once. */}
      <SatStartSessionButton
        className="hidden @[640px]/sat-dash:flex"
        isStarting={isStarting}
        onStart={onStart}
        startDisabledReason={startDisabledReason}
      />
    </div>
  );
}
