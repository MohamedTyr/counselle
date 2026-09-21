import { Bookmark } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import type { SatSessionRow } from "@/api/sat/types";
import { TOOL_WINDOW_FULLSCREEN_BREAKPOINT } from "@/features/sat/use-tool-window";
import type { SatHistoryEntry, SatReveal } from "@/features/sat/sat-session-reducer";
import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";

export interface SatNavigatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly SatSessionRow[];
  currentIndex: number;
  getReveal: (questionId: string) => SatReveal | undefined;
  getHistory: (questionId: string) => SatHistoryEntry;
  onSelect: (index: number) => void;
  anchor: React.ReactNode;
}

function difficultyTier(scoreBand: number): "easy" | "medium" | "hard" {
  if (scoreBand <= 3) return "easy";
  if (scoreBand <= 5) return "medium";
  return "hard";
}

function useIsSheetBreakpoint(): boolean {
  const [isSheet, setIsSheet] = useState(
    () => window.innerWidth <= TOOL_WINDOW_FULLSCREEN_BREAKPOINT,
  );
  useEffect(() => {
    function onResize() {
      setIsSheet(window.innerWidth <= TOOL_WINDOW_FULLSCREEN_BREAKPOINT);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isSheet;
}

function NavigatorGrid({
  rows,
  currentIndex,
  getReveal,
  getHistory,
  onSelect,
}: Pick<
  SatNavigatorProps,
  "rows" | "currentIndex" | "getReveal" | "getHistory" | "onSelect"
>): React.ReactElement {
  return (
    <div
      className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6"
      style={{ contentVisibility: "auto" }}
    >
      {rows.map((row, index) => {
        const reveal = getReveal(row.id);
        const history = getHistory(row.id);
        const upsolved = history.everCorrect && history.everIncorrect;
        const current = index === currentIndex;
        const correctThisSession = reveal?.isCorrect === true;
        const incorrectThisSession = reveal?.isCorrect === false;
        const tier = difficultyTier(row.score_band);
        return (
          <button
            aria-current={current || undefined}
            aria-label={`Question ${index + 1}, ${tier}${
              incorrectThisSession ? ", incorrect" : correctThisSession ? ", correct" : ""
            }${upsolved ? ", upsolved" : ""}${row.bookmarked ? ", marked for review" : ""}`}
            className={cn(
              "relative flex aspect-square items-center justify-center rounded-md border text-sm tabular-nums hover:bg-[var(--surface-hover)]",
              current
                ? "border-2 border-[var(--edge-strong)] font-medium"
                : "border-[var(--edge)]",
            )}
            key={row.id}
            onClick={() => onSelect(index)}
            type="button"
          >
            {row.bookmarked && (
              <Bookmark
                aria-hidden="true"
                className="absolute top-0.5 left-0.5 size-3 fill-current"
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "absolute bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full",
                tier === "easy" && "bg-[var(--ink-tertiary)]",
                tier === "medium" && "bg-[var(--ink-secondary)]",
                tier === "hard" && "bg-[var(--ink)]",
              )}
            />
            {index + 1}
            {(correctThisSession || incorrectThisSession || upsolved) && (
              <span className="absolute top-0.5 right-0.5 flex gap-0.5 text-[10px] leading-none">
                {(correctThisSession || upsolved) && (
                  <span aria-hidden="true" className="text-[var(--success-fg)]">
                    ●
                  </span>
                )}
                {incorrectThisSession && (
                  <span aria-hidden="true" className="text-[var(--danger-fg)]">
                    ✕
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function NavigatorLegend(): React.ReactElement {
  const legend = SAT_PRACTICE_COPY.navigator.legend;
  return (
    <div className="flex flex-col gap-1 text-xs text-[var(--ink-secondary)]">
      <div className="flex flex-wrap gap-3">
        <span>{legend.correct}</span>
        <span>{legend.incorrect}</span>
        <span>{legend.forReview}</span>
        <span>{legend.upsolved}</span>
      </div>
      <p>{SAT_PRACTICE_COPY.navigator.caption}</p>
    </div>
  );
}

/** The question bank navigator (ui-spec §4, Q29–Q31): desktop popover /
 * ≤860px bottom sheet. */
export function SatNavigator({
  open,
  onOpenChange,
  rows,
  currentIndex,
  getReveal,
  getHistory,
  onSelect,
  anchor,
}: SatNavigatorProps): React.ReactElement {
  const isSheet = useIsSheetBreakpoint();

  if (isSheet) {
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetTrigger render={anchor as React.ReactElement} />
        <SheetContent className="max-h-[80dvh]" side="bottom">
          <SheetHeader>
            <SheetTitle>{SAT_PRACTICE_COPY.navigator.title}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-3 overflow-y-auto p-4">
            <NavigatorLegend />
            <NavigatorGrid
              currentIndex={currentIndex}
              getHistory={getHistory}
              getReveal={getReveal}
              onSelect={(index) => {
                onSelect(index);
                onOpenChange(false);
              }}
              rows={rows}
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger render={anchor as React.ReactElement} />
      <PopoverContent className="max-h-[520px] w-[400px] overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          <h3 className="text-sm font-medium">{SAT_PRACTICE_COPY.navigator.title}</h3>
          <NavigatorLegend />
          <NavigatorGrid
            currentIndex={currentIndex}
            getHistory={getHistory}
            getReveal={getReveal}
            onSelect={(index) => {
              onSelect(index);
              onOpenChange(false);
            }}
            rows={rows}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
