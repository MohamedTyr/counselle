import {
  ArrowLeft,
  ChevronLeft,
  Calculator,
  Highlighter,
  Info,
  Pause,
  Play,
  Timer as TimerIcon,
  Triangle,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SatModule } from "@/api/sat/types";
import { formatTimer } from "@/features/sat/sat-format";
import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";
import {
  satIconItemClass,
  satKbdOnButtonClass,
  satReadoutTrackClass,
  satToolItemClass,
  satToolTrackClass,
} from "@/features/sat/sat-chrome-styles";

export interface SatPracticeTopBarProps {
  module: SatModule;
  seconds: number;
  isRunning: boolean;
  onToggleRunning: () => void;
  highlightActive: boolean;
  highlightSupported: boolean;
  onToggleHighlight: () => void;
  calculatorActive: boolean;
  onToggleCalculator: () => void;
  referenceOpen: boolean;
  onToggleReference: () => void;
  onOpenInfo: () => void;
  onExit: () => void;
}

/** A tool pill: icon always, label from 861px up. The label is hidden with
 * `display: none` on a phone, so the accessible name is set explicitly. */
function ToolPill({
  icon,
  label,
  pressed,
  disabled,
  tooltip,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  tooltip?: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-disabled={disabled || undefined}
          aria-label={label}
          aria-pressed={pressed}
          className={cn(satToolItemClass(pressed), disabled && "opacity-50")}
          onClick={() => !disabled && onClick()}
          size="sm"
          variant="ghost"
        >
          {icon}
          <span className="max-[860px]:hidden">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}

/** The top bar (ui-spec §4): exit and section on the left, the timer, the
 * tools. Transparent over the beams; the pills carry the weight. */
export function SatPracticeTopBar({
  module,
  seconds,
  isRunning,
  onToggleRunning,
  highlightActive,
  highlightSupported,
  onToggleHighlight,
  calculatorActive,
  onToggleCalculator,
  referenceOpen,
  onToggleReference,
  onOpenInfo,
  onExit,
}: SatPracticeTopBarProps): React.ReactElement {
  const [timerHidden, setTimerHidden] = useState(false);
  const { tools } = SAT_PRACTICE_COPY;

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-2 px-4 min-[861px]:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={tools.exit}
              className={cn(satToolItemClass(), "shrink-0 px-2.5 max-[860px]:px-0 max-[860px]:size-8")}
              onClick={onExit}
              size="sm"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              <span className="max-[860px]:hidden">{tools.exit}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tools.exitTooltip}</TooltipContent>
        </Tooltip>
        <span className="truncate text-[13px] font-semibold text-[var(--ink)] max-[520px]:hidden">
          {SAT_PRACTICE_COPY.sectionLabel[module]}
        </span>
      </div>

      <div className={satReadoutTrackClass} role="group" aria-label="Timer">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={SAT_PRACTICE_COPY.timerToggleTooltip}
              aria-pressed={timerHidden}
              className={cn(
                satToolItemClass(),
                "min-w-[4.75rem] tabular-nums",
                !isRunning && "text-[var(--ink-faint)]",
              )}
              onClick={() => setTimerHidden((hidden) => !hidden)}
              size="sm"
              variant="ghost"
            >
              <TimerIcon aria-hidden="true" className="size-4" />
              <span>
                {timerHidden ? SAT_PRACTICE_COPY.timerHiddenLabel : formatTimer(seconds)}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{SAT_PRACTICE_COPY.timerToggleTooltip}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={
                isRunning ? SAT_PRACTICE_COPY.pauseTimer : SAT_PRACTICE_COPY.resumeTimer
              }
              className={satIconItemClass}
              onClick={onToggleRunning}
              size="icon-sm"
              variant="ghost"
            >
              {isRunning ? (
                <Pause aria-hidden="true" className="size-4" />
              ) : (
                <Play aria-hidden="true" className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isRunning ? SAT_PRACTICE_COPY.pauseTimer : SAT_PRACTICE_COPY.resumeTimer}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end">
        <div className={satToolTrackClass} role="group" aria-label="Tools">
          {module === "reading" && (
            <ToolPill
              disabled={!highlightSupported}
              icon={<Highlighter aria-hidden="true" className="size-4" />}
              label={tools.highlight}
              onClick={onToggleHighlight}
              pressed={highlightActive}
              tooltip={
                highlightSupported
                  ? tools.highlight
                  : SAT_PRACTICE_COPY.highlightUnsupportedTooltip
              }
            />
          )}
          {module === "math" && (
            <>
              <ToolPill
                icon={<Calculator aria-hidden="true" className="size-4" />}
                label={tools.calculator}
                onClick={onToggleCalculator}
                pressed={calculatorActive}
              />
              <ToolPill
                icon={<Triangle aria-hidden="true" className="size-4" />}
                label={tools.reference}
                onClick={onToggleReference}
                pressed={referenceOpen}
              />
            </>
          )}
          <ToolPill
            icon={<Info aria-hidden="true" className="size-4" />}
            label={tools.info}
            onClick={onOpenInfo}
          />
        </div>
      </div>
    </header>
  );
}

export interface SatPracticeBottomBarProps {
  index: number;
  total: number;
  navigatorTrigger: React.ReactNode;
  primaryLabel: string;
  primaryLoading: boolean;
  primaryDisabled: boolean;
  onPrimaryAction: () => void;
  onPrevious: () => void;
  isLastQuestionAfterSubmit: boolean;
}

/** The bottom bar (ui-spec §4): the navigator pill on the left; Previous and
 * the primary action (Check answer → Next → Finish session) on the right. */
export function SatPracticeBottomBar({
  index,
  total,
  navigatorTrigger,
  primaryLabel,
  primaryLoading,
  primaryDisabled,
  onPrimaryAction,
  onPrevious,
  isLastQuestionAfterSubmit,
}: SatPracticeBottomBarProps): React.ReactElement {
  return (
    <footer className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 min-[861px]:px-6">
      {navigatorTrigger ?? (
        <Button variant="outline">
          {SAT_PRACTICE_COPY.questionCounter(index + 1, total)}
        </Button>
      )}
      <div className="flex items-center gap-2">
        <Button
          aria-label={SAT_PRACTICE_COPY.previous}
          className="active:scale-[0.97]"
          disabled={index === 0}
          onClick={onPrevious}
          size="lg"
          variant="outline"
        >
          <ChevronLeft aria-hidden="true" className="min-[521px]:hidden" />
          <span className="max-[520px]:hidden">{SAT_PRACTICE_COPY.previous}</span>
        </Button>
        {isLastQuestionAfterSubmit ? (
          <Button render={<Link to="/app/sat" />} size="lg">
            {SAT_PRACTICE_COPY.finishSession}
          </Button>
        ) : (
          <Button
            className="active:scale-[0.97]"
            disabled={primaryDisabled}
            loading={primaryLoading}
            onClick={onPrimaryAction}
            size="lg"
          >
            {primaryLabel}
            <Kbd aria-hidden="true" className={satKbdOnButtonClass}>
              {"↵"}
            </Kbd>
          </Button>
        )}
      </div>
    </footer>
  );
}
