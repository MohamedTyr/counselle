import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Highlighter,
  Info,
  Pause,
  Play,
  Timer as TimerIcon,
  Triangle,
  X,
} from "lucide-react";
import type React from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { SatModule } from "@/api/sat/types";
import { formatTimer } from "@/features/sat/sat-format";
import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";

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

/** The top bar (ui-spec §4): section label, timer, tools. */
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

  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--hairline)] bg-[var(--chrome)] px-4 max-[860px]:h-[52px]">
      <span className="truncate text-sm font-medium">
        {SAT_PRACTICE_COPY.sectionLabel[module]}
      </span>

      <ButtonGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => setTimerHidden((hidden) => !hidden)}
              size="sm"
              variant="outline"
            >
              <TimerIcon aria-hidden="true" className="size-4" />
              <span className="tabular-nums">
                {timerHidden ? SAT_PRACTICE_COPY.timerHiddenLabel : formatTimer(seconds)}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{SAT_PRACTICE_COPY.timerToggleTooltip}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-pressed={isRunning}
              onClick={onToggleRunning}
              size="sm"
              variant="outline"
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
      </ButtonGroup>

      <div className="flex items-center gap-1">
        {module === "reading" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-disabled={!highlightSupported}
                aria-pressed={highlightActive}
                onClick={() => highlightSupported && onToggleHighlight()}
                size="sm"
                variant="ghost"
              >
                <Highlighter aria-hidden="true" className="size-4" />
                <span className="max-[860px]:hidden">
                  {SAT_PRACTICE_COPY.tools.highlight}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {highlightSupported
                ? SAT_PRACTICE_COPY.tools.highlight
                : SAT_PRACTICE_COPY.highlightUnsupportedTooltip}
            </TooltipContent>
          </Tooltip>
        )}
        {module === "math" && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-pressed={calculatorActive}
                  onClick={onToggleCalculator}
                  size="sm"
                  variant="ghost"
                >
                  <Calculator aria-hidden="true" className="size-4" />
                  <span className="max-[860px]:hidden">
                    {SAT_PRACTICE_COPY.tools.calculator}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{SAT_PRACTICE_COPY.tools.calculator}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-pressed={referenceOpen}
                  onClick={onToggleReference}
                  size="sm"
                  variant="ghost"
                >
                  <Triangle aria-hidden="true" className="size-4" />
                  <span className="max-[860px]:hidden">
                    {SAT_PRACTICE_COPY.tools.reference}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{SAT_PRACTICE_COPY.tools.reference}</TooltipContent>
            </Tooltip>
          </>
        )}
        <Button onClick={onOpenInfo} size="sm" variant="ghost">
          <Info aria-hidden="true" className="size-4" />
          <span className="max-[860px]:hidden">{SAT_PRACTICE_COPY.tools.info}</span>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={onExit} size="sm" variant="ghost">
              <X aria-hidden="true" className="size-4" />
              <span className="max-[860px]:hidden">{SAT_PRACTICE_COPY.tools.exit}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{SAT_PRACTICE_COPY.tools.exitTooltip}</TooltipContent>
        </Tooltip>
      </div>
    </div>
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
  isLastQuestionAfterSubmit: boolean;
}

/** The bottom bar (ui-spec §4): counter + navigator trigger, primary
 * action button (Check answer → Next → Finish session). */
export function SatPracticeBottomBar({
  index,
  total,
  navigatorTrigger,
  primaryLabel,
  primaryLoading,
  primaryDisabled,
  onPrimaryAction,
  isLastQuestionAfterSubmit,
}: SatPracticeBottomBarProps): React.ReactElement {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-t border-[var(--hairline)] bg-[var(--chrome)] px-4 max-[860px]:h-[60px]">
      {navigatorTrigger ?? (
        <Button variant="outline">
          {SAT_PRACTICE_COPY.questionCounter(index + 1, total)}
          <ChevronUp aria-hidden="true" className="size-4" />
          <ChevronDown aria-hidden="true" className="size-4" />
        </Button>
      )}
      {isLastQuestionAfterSubmit ? (
        <Button render={<a href="/app/sat" />} size="lg">
          {SAT_PRACTICE_COPY.finishSession}
        </Button>
      ) : (
        <Button
          className={cn("gap-2")}
          disabled={primaryDisabled}
          loading={primaryLoading}
          onClick={onPrimaryAction}
          size="lg"
        >
          {primaryLabel}
          <span aria-hidden="true" className="text-[var(--on-brand)]">
            {"↵"}
          </span>
        </Button>
      )}
    </div>
  );
}
