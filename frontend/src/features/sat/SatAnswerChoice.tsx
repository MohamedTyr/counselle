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

type ChoiceResult = "correct" | "wrong" | "none";

/** The row's colour story. A result colour always outranks hover, press and
 * focus, so a revealed row never falls back to a neutral hover grey and a
 * wrong pick never wears the green focus ring. */
const ROW_STYLES = {
  none: {
    open: "border-[var(--edge)] bg-[var(--surface-raised)] hover:border-[var(--edge-strong)] hover:bg-[var(--canvas-hover)] focus-visible:ring-[var(--focus-ring)]",
    selected:
      "border-[var(--ink)] bg-[var(--canvas-active)] shadow-[inset_0_0_0_1px_var(--ink)] focus-visible:ring-[var(--focus-ring)]",
    locked:
      "border-[var(--edge)] bg-[var(--surface-raised)] focus-visible:ring-[var(--focus-ring)]",
  },
  correct:
    "border-[var(--success-border)] bg-[var(--success-surface)] shadow-[inset_0_0_0_1px_var(--success-border)] focus-visible:ring-[var(--success-fg)]",
  wrong:
    "border-[var(--danger-border)] bg-[var(--danger-surface)] shadow-[inset_0_0_0_1px_var(--danger-border)] focus-visible:ring-[var(--danger-fg)]",
} as const;

const DISC_STYLES = {
  idle: "border-[var(--edge-strong)] bg-transparent text-[var(--ink-secondary)]",
  selected: "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]",
  correct:
    "border-[var(--success-solid)] bg-[var(--success-solid)] text-[var(--on-brand)]",
  wrong:
    "border-[var(--danger-solid)] bg-[var(--danger-solid)] text-[var(--on-brand)]",
} as const;

function rowStyle(
  result: ChoiceResult,
  selected: boolean,
  revealed: boolean,
): string {
  if (result !== "none") return ROW_STYLES[result];
  if (revealed) return ROW_STYLES.none.locked;
  return selected ? ROW_STYLES.none.selected : ROW_STYLES.none.open;
}

function discStyle(result: ChoiceResult, selected: boolean): string {
  if (result !== "none") return DISC_STYLES[result];
  return selected ? DISC_STYLES.selected : DISC_STYLES.idle;
}

/** The tag that survives a reveal: what was right, and which row was yours —
 * with an icon, so colour never carries it alone. It sits inside the row:
 * under the text on a phone, in the row's right edge from `sm` up. */
function ResultMark({
  result,
  selected,
}: {
  result: ChoiceResult;
  selected: boolean;
}): React.ReactElement | null {
  if (result === "none") return null;
  const copy = SAT_PRACTICE_COPY.answerChoices;
  const text =
    result === "wrong"
      ? copy.yourAnswer
      : selected
        ? copy.yourAnswerCorrect
        : copy.correctAnswer;
  const Icon = result === "wrong" ? X : Check;
  return (
    <span
      className={cn(
        "col-start-2 mt-1.5 flex h-5 items-center gap-1 justify-self-start rounded-full border px-2 text-xs font-medium whitespace-nowrap sm:col-start-3 sm:row-start-1 sm:mt-0 sm:justify-self-end",
        result === "wrong"
          ? "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger-fg)]"
          : "border-[var(--success-border)] bg-[var(--success-surface)] text-[var(--success-fg)]",
      )}
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />
      {text}
    </span>
  );
}

/**
 * One MCQ answer row (ui-spec §4: "Answer choices"). A row `button` with
 * `aria-pressed`, not a `radiogroup` — upstream's semantics (Q17); no arrow
 * key selection. The strike column on the right is reserved whether or not
 * elimination is switched on, so toggling it never shifts the text.
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
  const result: ChoiceResult = !revealed
    ? "none"
    : isCorrectAnswer
      ? "correct"
      : selected
        ? "wrong"
        : "none";
  const disabled = revealed || (eliminated && !eliminateMode);

  return (
    <div className="relative">
      <button
        aria-disabled={disabled || undefined}
        aria-pressed={selected}
        data-sat-enter-submit=""
        className={cn(
          "relative grid min-h-12 w-full min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 rounded-xl border py-2.5 pr-11 pl-3.5 text-left",
          result !== "none" && "sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:pr-3.5",
          "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out motion-reduce:transition-none",
          "focus-visible:ring-[3px] focus-visible:outline-none",
          rowStyle(result, selected, revealed),
          !disabled && "active:scale-[0.97] motion-reduce:active:scale-100",
          eliminated && !revealed && "opacity-70",
        )}
        onClick={() => {
          if (disabled) return;
          onSelect();
        }}
        type="button"
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums transition-colors duration-150 ease-out motion-reduce:transition-none sm:self-center",
            discStyle(result, selected),
            eliminated && "border-dashed",
          )}
        >
          {label}
        </span>
        <SatContent
          className={cn(
            "sat-content--reading min-w-0",
            eliminated && "line-through opacity-50",
          )}
          contentSha={contentSha}
          field={`option-${label}`}
          html={content}
        />
        <ResultMark result={result} selected={selected} />
      </button>
      {eliminateMode && !revealed && (
        <Button
          aria-label={
            eliminated
              ? SAT_PRACTICE_COPY.restoreChoice(label)
              : SAT_PRACTICE_COPY.eliminateChoice(label)
          }
          aria-pressed={eliminated}
          className="absolute inset-y-0 right-2 my-auto aria-pressed:bg-[var(--control-quiet-surface)] aria-pressed:text-[var(--ink)]"
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
