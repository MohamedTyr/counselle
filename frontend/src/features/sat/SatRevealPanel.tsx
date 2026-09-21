import { ChevronDown } from "lucide-react";
import type React from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { SatAttemptOut } from "@/api/sat/types";
import { formatAttemptDate, formatAttemptSeconds } from "@/features/sat/sat-format";
import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";
import { SatContent } from "@/features/sat/SatContent";

export interface SatRevealPanelProps {
  /** Keyed by `question_id` with `defaultOpen` — uncontrolled, so it resets
   * on every revisit (Q27, ui-spec §4). */
  questionId: string;
  contentSha: string;
  rationale: string;
  attempts: readonly SatAttemptOut[];
}

/** After-submit panel: "Explanation" (open by default, rendered only when
 * the rationale is non-empty) and "Previous attempts (N)" (closed) —
 * ui-spec §4, parity Q27/Q28. */
export function SatRevealPanel({
  questionId,
  contentSha,
  rationale,
  attempts,
}: SatRevealPanelProps): React.ReactElement {
  const solved = attempts.some((attempt) => attempt.is_correct);

  return (
    <div
      className="flex flex-col gap-2 rounded-lg bg-[var(--surface-inset)] p-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
      key={questionId}
    >
      {rationale.trim() !== "" && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex w-full select-none items-center justify-between gap-2 py-1 text-sm font-medium">
            {SAT_PRACTICE_COPY.explanation}
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 data-[state=open]:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <div className="sat-content pt-1 text-sm">
              <SatContent
                contentSha={contentSha}
                field="rationale"
                html={rationale}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible key={`attempts-${questionId}`}>
        <CollapsibleTrigger className="flex w-full select-none items-center justify-between gap-2 py-1 text-sm font-medium">
          <span>{SAT_PRACTICE_COPY.previousAttempts(attempts.length)}</span>
          <span
            className={cn(
              "text-xs",
              solved ? "text-[var(--success-fg)]" : "text-[var(--danger-fg)]",
            )}
          >
            {solved ? SAT_PRACTICE_COPY.solved : SAT_PRACTICE_COPY.notSolvedYet}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden">
          <ul className="flex flex-col gap-1.5 pt-1">
            {attempts.map((attempt) => (
              <li
                className="flex items-center gap-2 text-xs text-[var(--ink-secondary)]"
                key={attempt.id}
              >
                <Badge variant={attempt.is_correct ? "success" : "error"}>
                  {attempt.is_correct ? "Correct" : "Incorrect"}
                </Badge>
                <span className="font-medium">Answer: {attempt.user_answer}</span>
                <span className="ml-auto tabular-nums">
                  {formatAttemptSeconds(attempt.time_spent_seconds)}
                </span>
                <span>{formatAttemptDate(attempt.solved_at)}</span>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
