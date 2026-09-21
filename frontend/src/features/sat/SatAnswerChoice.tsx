import { Check, Strikethrough, X } from "lucide-react";
import type React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";
import { SatContent } from "@/features/sat/SatContent";

export interface SatAnswerChoiceProps {
  label: string;
  content: string;
  contentSha: string;
  selected: boolean;
  eliminated: boolean;
  eliminateMode: boolean;
  /** Set once the question has been submitted (Q20). */
  revealed: boolean;
  isCorrectAnswer: boolean;
  onSelect: () => void;
  onToggleEliminate: () => void;
}

/**
 * One MCQ answer row (ui-spec §4: "Answer choices"). A row `button` with
 * `aria-pressed`, not a `radiogroup` — upstream's semantics (Q17); no arrow
 * key selection.
 */
export function SatAnswerChoice({
  label,
  content,
  contentSha,
  selected,
  eliminated,
  eliminateMode,
  revealed,
  isCorrectAnswer,
  onSelect,
  onToggleEliminate,
}: SatAnswerChoiceProps): React.ReactElement {
  const isUserWrongAnswer = revealed && selected && !isCorrectAnswer;
  const revealedCorrect = revealed && isCorrectAnswer;
  const disabled = revealed || (eliminated && !eliminateMode);

  return (
    <div className="flex items-center gap-2">
      <button
        aria-disabled={disabled || undefined}
        aria-pressed={selected}
        className={cn(
          "flex min-h-12 flex-1 items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
          "border-[var(--edge)] bg-[var(--canvas)] hover:bg-[var(--canvas-hover)] active:bg-[var(--canvas-active)]",
          "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:outline-none",
          selected && !revealed && "border-[var(--edge-strong)]",
          eliminated && "opacity-70",
          revealedCorrect &&
            "border-[var(--success-border)] bg-[var(--success-surface)]",
          isUserWrongAnswer &&
            "border-[var(--danger-border)] bg-[var(--danger-surface)]",
        )}
        onClick={() => {
          if (disabled) return;
          onSelect();
        }}
        type="button"
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium",
            selected && !revealed
              ? "border-primary bg-primary text-primary-foreground"
              : "border-[var(--edge-strong)] text-[var(--ink)]",
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            "sat-content min-w-0 flex-1 text-base",
            eliminated && "text-[var(--ink-disabled)] line-through",
          )}
        >
          <SatContent
            contentSha={contentSha}
            field={`option-${label}`}
            html={content}
          />
        </span>
        {revealedCorrect && (
          <span className="flex shrink-0 items-center gap-1 text-sm text-[var(--success-fg)]">
            <Check className="size-4" aria-hidden="true" />
            {SAT_PRACTICE_COPY.answerChoices.correctAnswer}
          </span>
        )}
        {isUserWrongAnswer && (
          <span className="flex shrink-0 items-center gap-1 text-sm text-[var(--danger-fg)]">
            <X className="size-4" aria-hidden="true" />
            {SAT_PRACTICE_COPY.answerChoices.yourAnswer}
          </span>
        )}
      </button>
      {eliminateMode && !revealed && (
        <Button
          aria-label={
            eliminated
              ? SAT_PRACTICE_COPY.restoreChoice(label)
              : SAT_PRACTICE_COPY.eliminateChoice(label)
          }
          aria-pressed={eliminated}
          onClick={onToggleEliminate}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Strikethrough className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
