import { Check, ChevronDown, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { SatAttemptOut } from "@/api/sat/types";
import {
  formatAttemptDate,
  formatAttemptSeconds,
} from "@/features/sat/sat-format";
import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";
import { SatContent } from "@/features/sat/SatContent";

/** "0:20" — the verdict's elapsed time, unpadded minutes. */
function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.trunc(totalSeconds));
  return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, "0")}`;
}

export interface SatVerdictStripProps {
  isCorrect: boolean;
  correctAnswers: readonly string[];
  /** The just-submitted attempt's time, once the attempts list has it. */
  seconds: number | undefined;
}

/** The result of checking: one line, announced politely and scrolled into
 * view so a long passage never hides it below the fold. */
export function SatVerdictStrip({
  isCorrect,
  correctAnswers,
  seconds,
}: SatVerdictStripProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    ref.current?.scrollIntoView?.({
      block: "nearest",
      behavior: reduced ? "auto" : "smooth",
    });
  }, []);

  const Icon = isCorrect ? Check : X;
  return (
    <div
      className={cn(
        "flex min-h-12 scroll-mb-[4.5rem] items-center gap-3 rounded-xl border px-3.5 py-2.5 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
        isCorrect
          ? "border-[var(--success-border)] bg-[var(--success-surface)] text-[var(--success-fg)]"
          : "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger-fg)]",
      )}
      ref={ref}
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--on-brand)]",
          isCorrect ? "bg-[var(--success-solid)]" : "bg-[var(--danger-solid)]",
        )}
      >
        <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
      </span>
      <p className="min-w-0 flex-1 text-[15px] font-semibold">
        {isCorrect
          ? SAT_PRACTICE_COPY.verdict.correct
          : SAT_PRACTICE_COPY.verdict.incorrect(correctAnswers)}
      </p>
      {seconds !== undefined && (
        <span className="shrink-0 text-[13px] font-medium tabular-nums">
          {formatClock(seconds)}
        </span>
      )}
    </div>
  );
}

export interface SatRevealPanelProps {
  /** Keyed by `question_id` with `defaultOpen` — uncontrolled, so it resets
   * on every revisit (Q27, ui-spec §4). */
  questionId: string;
  contentSha: string;
  rationale: string;
  attempts: readonly SatAttemptOut[];
}

const TRIGGER_CLASS =
  "group flex w-full select-none items-center justify-between gap-2 rounded-lg py-2 text-sm font-semibold text-[var(--ink)] focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)] focus-visible:outline-none";

/** After-submit panel: "Explanation" (open by default, rendered only when
 * the rationale is non-empty) and "Previous attempts (N)" (closed) —
 * ui-spec §4, parity Q27/Q28. Lives on the question sheet itself, split by
 * hairlines rather than a second filled box. */
export function SatRevealPanel({
  questionId,
  contentSha,
  rationale,
  attempts,
}: SatRevealPanelProps): React.ReactElement {
  const solved = attempts.some((attempt) => attempt.is_correct);

  return (
    <div
      className="flex flex-col divide-y divide-[var(--hairline)] border-t border-[var(--hairline)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
      key={questionId}
    >
      {rationale.trim() !== "" && (
        <Collapsible className="py-1" defaultOpen>
          <CollapsibleTrigger className={TRIGGER_CLASS}>
            {SAT_PRACTICE_COPY.explanation}
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-[var(--ink-faint)] transition-transform duration-200 ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden motion-reduce:animate-none data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <div className="pt-1 pb-3">
              <SatContent
                className="sat-content--explanation"
                contentSha={contentSha}
                field="rationale"
                html={rationale}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible className="py-1" key={`attempts-${questionId}`}>
        <CollapsibleTrigger className={TRIGGER_CLASS}>
          <span>{SAT_PRACTICE_COPY.previousAttempts(attempts.length)}</span>
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "text-xs font-medium",
                solved ? "text-[var(--success-fg)]" : "text-[var(--ink-faint)]",
              )}
            >
              {solved
                ? SAT_PRACTICE_COPY.solved
                : SAT_PRACTICE_COPY.notSolvedYet}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-[var(--ink-faint)] transition-transform duration-200 ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden">
          <ul className="flex flex-col gap-1.5 pt-1 pb-3">
            {attempts.map((attempt) => (
              <li
                className="flex items-center gap-2 text-xs text-[var(--ink-secondary)]"
                key={attempt.id}
              >
                <Badge variant={attempt.is_correct ? "success" : "error"}>
                  {attempt.is_correct ? "Correct" : "Incorrect"}
                </Badge>
                <span className="font-medium">
                  Answer: {attempt.user_answer}
                </span>
                <span className="ml-auto tabular-nums">
                  {formatAttemptSeconds(attempt.time_spent_seconds)}
                </span>
                <span className="tabular-nums">
                  {formatAttemptDate(attempt.solved_at)}
                </span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
