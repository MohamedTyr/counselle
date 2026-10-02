/**
 * The dashboard's controls (plan §5.2; ui-spec §3.3; parity F3, F6-F8):
 * the status tabs and Bluebook toggle that sit above the topics, the
 * session sheet (summary, difficulty, Start), and the phone's floating
 * start bar. Start has one definition, rendered in two places — in the
 * sheet from 880 cw up, as the floating bar below it.
 */
import type React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import {
  profileScorePickerClass,
  profileScoreOptionClass,
} from "@/features/profile/profile-control-styles";
import {
  SAT_DASHBOARD_COPY,
  pluralQuestions,
  pluralSkills,
} from "@/features/sat/sat-copy";
import { cn } from "@/lib/utils";
import type { SatBandTier, SatSolvedStatus } from "@/api/sat/types";

const STATUS_ORDER: readonly SatSolvedStatus[] = [
  "all",
  "unsolved",
  "incorrect",
  "bookmarked",
];

const TIER_LABELS: Record<string, string> = {
  Easy: SAT_DASHBOARD_COPY.difficultyTiers.easy,
  Medium: SAT_DASHBOARD_COPY.difficultyTiers.medium,
  Hard: SAT_DASHBOARD_COPY.difficultyTiers.hard,
};

/** Dims a figure while a refetch is in flight instead of blanking it. */
const DIM_CLASS =
  "opacity-64 transition-opacity duration-150 motion-reduce:transition-none";

/** The pressed state shared by the Start controls (0.97, ui-spec motion). */
const START_PRESS =
  "transition-[background-color,border-color,box-shadow,color,scale] active:scale-[0.97] motion-reduce:transition-none";

// --- toolbar --------------------------------------------------------------

export interface SatStatusToolbarProps {
  status: SatSolvedStatus;
  onStatusChange: (status: SatSolvedStatus) => void;
  /** Total questions per status for the current bands / Bluebook setting;
   * `undefined` until that status's counts have loaded. */
  statusTotals: Readonly<Record<SatSolvedStatus, number | undefined>>;
  excludeBluebook: boolean;
  onExcludeBluebookChange: (value: boolean) => void;
}

export function SatStatusToolbar({
  status,
  onStatusChange,
  statusTotals,
  excludeBluebook,
  onExcludeBluebookChange,
}: SatStatusToolbarProps): React.ReactElement {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
      data-slot="sat-status-toolbar"
    >
      <Tabs
        onValueChange={(next) => onStatusChange(next as SatSolvedStatus)}
        value={status}
      >
        <TabsList aria-label={SAT_DASHBOARD_COPY.statusLabel} variant="pill">
          {STATUS_ORDER.map((value) => (
            <TabsTab
              className="group/status @max-[34rem]/sat-dash:px-2.5!"
              key={value}
              value={value}
            >
              {SAT_DASHBOARD_COPY.statusOptions[value]}
              <span
                className={cn(
                  "min-w-[1ch] text-xs tabular-nums text-[var(--ink-faint)] @max-[34rem]/sat-dash:group-not-data-active/status:hidden",
                  statusTotals[value] === undefined && "invisible",
                )}
              >
                {(statusTotals[value] ?? 0).toLocaleString("en-US")}
              </span>
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ink-secondary)]">
        <Checkbox
          checked={excludeBluebook}
          className="rounded-full"
          onCheckedChange={(checked) =>
            onExcludeBluebookChange(checked === true)
          }
        />
        {SAT_DASHBOARD_COPY.excludeBluebookLabel}
      </label>
    </div>
  );
}

// --- Start ---------------------------------------------------------------

export interface SatStartButtonProps {
  startDisabledReason: string | null;
  isStarting: boolean;
  onStart: () => void;
  className?: string;
}

function SatStartButton({
  startDisabledReason,
  isStarting,
  onStart,
  className,
}: SatStartButtonProps): React.ReactElement {
  return (
    <Button
      className={cn(START_PRESS, className)}
      disabled={startDisabledReason !== null}
      loading={isStarting}
      onClick={onStart}
      size="lg"
    >
      {SAT_DASHBOARD_COPY.startSession}
    </Button>
  );
}

// --- session sheet --------------------------------------------------------

export interface SatSessionSheetProps {
  /** Questions the current filters would draw from; `null` before counts load. */
  questionCount: number | null;
  isRefetching: boolean;
  selectedSkillCount: number;
  bandTiers: readonly SatBandTier[];
  selectedBands: ReadonlySet<number>;
  onToggleBand: (band: number) => void;
  onToggleTier: (bands: readonly number[], nextChecked: boolean) => void;
  startDisabledReason: string | null;
  isStarting: boolean;
  onStart: () => void;
}

function SatBandPicker({
  tier,
  selectedBands,
  onToggleBand,
  onToggleTier,
}: {
  tier: SatBandTier;
  selectedBands: ReadonlySet<number>;
  onToggleBand: (band: number) => void;
  onToggleTier: (bands: readonly number[], nextChecked: boolean) => void;
}): React.ReactElement {
  const tierLabel = TIER_LABELS[tier.name] ?? tier.name;
  const tierAllSelected = tier.bands.every((band) => selectedBands.has(band));
  const tierAnySelected = tier.bands.some((band) => selectedBands.has(band));
  const range = `${tier.bands[0]}–${tier.bands[tier.bands.length - 1]}`;
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        aria-label={`${tierAllSelected ? "Deselect" : "Select"} all ${tierLabel} (${range})`}
        className={cn(
          "-mx-2 flex h-8 cursor-pointer items-baseline gap-1.5 rounded-lg px-2 text-sm outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-[var(--canvas-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.97] motion-reduce:transition-none",
          tierAnySelected
            ? "font-medium text-[var(--ink)]"
            : "text-[var(--ink-faint)]",
        )}
        onClick={() => onToggleTier(tier.bands, !tierAllSelected)}
        type="button"
      >
        {tierLabel}
        <span className="text-xs tabular-nums text-[var(--ink-faint)]">
          {range}
        </span>
      </button>
      <div
        className={profileScorePickerClass}
        role="group"
        aria-label={`${tierLabel} difficulty`}
      >
        {tier.bands.map((band) => {
          const selected = selectedBands.has(band);
          return (
            <button
              aria-pressed={selected}
              className={cn(
                profileScoreOptionClass(selected),
                "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              )}
              key={band}
              onClick={() => onToggleBand(band)}
              type="button"
            >
              {band}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SatSessionSheet({
  questionCount,
  isRefetching,
  selectedSkillCount,
  bandTiers,
  selectedBands,
  onToggleBand,
  onToggleTier,
  startDisabledReason,
  isStarting,
  onStart,
}: SatSessionSheetProps): React.ReactElement {
  return (
    <section data-slot="sat-session-sheet">
      <h2 className="mb-2 flex h-7 items-center text-chrome font-semibold">
        {SAT_DASHBOARD_COPY.sessionHeading}
      </h2>
      <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-raised)] shadow-[var(--elevation-1)]">
        <div className="flex flex-col gap-0.5 px-4 py-4">
          <p
            aria-live="polite"
            className={cn(
              "text-[1.625rem] leading-8 font-semibold tracking-[-0.03em] tabular-nums",
              isRefetching && DIM_CLASS,
            )}
          >
            {questionCount === null ? "–" : pluralQuestions(questionCount)}
          </p>
          <p className="text-xs text-[var(--ink-faint)]">
            {pluralSkills(selectedSkillCount)} selected
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--hairline)] px-4 py-4">
          <h3 className="text-xs font-medium text-[var(--ink-secondary)]">
            {SAT_DASHBOARD_COPY.difficultyHeading}
          </h3>
          {bandTiers.map((tier) => (
            <SatBandPicker
              key={tier.name}
              onToggleBand={onToggleBand}
              onToggleTier={onToggleTier}
              selectedBands={selectedBands}
              tier={tier}
            />
          ))}
        </div>

        {/* Below 880 cw this lives in the floating bar instead
         * (`SatStartBar`) — the two never show at once. */}
        <div className="hidden flex-col gap-2 border-t border-[var(--hairline)] px-4 py-4 @[880px]/sat-dash:flex">
          <SatStartButton
            className="w-full"
            isStarting={isStarting}
            onStart={onStart}
            startDisabledReason={startDisabledReason}
          />
          {startDisabledReason !== null && (
            <p className="text-center text-xs text-[var(--ink-secondary)]">
              {startDisabledReason}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// --- floating start bar (phone / narrow) -----------------------------------

export interface SatStartBarProps extends SatStartButtonProps {
  questionCount: number | null;
  selectedSkillCount: number;
  /** Shown only while the session sheet's own Start is out of view. */
  visible: boolean;
}

/** ui-spec §3.1's F18 addition: a trailing sibling of the grid, so its
 * containing block spans the whole dashboard and `sticky` keeps it floating
 * above the topic list for the rest of the scroll. */
export function SatStartBar({
  questionCount,
  selectedSkillCount,
  startDisabledReason,
  isStarting,
  onStart,
  visible,
}: SatStartBarProps): React.ReactElement {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "sticky bottom-3 z-[var(--z-sticky)] flex items-center gap-3 rounded-2xl border border-[var(--hairline)] bg-[var(--surface-raised)] py-2 pr-2 pl-4 shadow-[var(--elevation-2)] transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none @[880px]/sat-dash:hidden",
        !visible && "pointer-events-none translate-y-2 opacity-0",
      )}
      data-slot="sat-start-bar"
      inert={!visible}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold tabular-nums">
          {startDisabledReason ??
            (questionCount === null ? "–" : pluralQuestions(questionCount))}
        </span>
        {startDisabledReason === null && (
          <span className="truncate text-xs text-[var(--ink-faint)]">
            {pluralSkills(selectedSkillCount)} selected
          </span>
        )}
      </div>
      <SatStartButton
        className="shrink-0"
        isStarting={isStarting}
        onStart={onStart}
        startDisabledReason={startDisabledReason}
      />
    </div>
  );
}
