import { Bookmark, Check, Strikethrough, X } from "lucide-react";
import type React from "react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { satScrollFadeClass } from "@/features/sat/sat-chrome-styles";

import type { SatAttemptOut, SatQuestionPublic } from "@/api/sat/types";
import type { SatReveal } from "@/features/sat/sat-session-reducer";
import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";
import { SatAnswerChoice } from "@/features/sat/SatAnswerChoice";
import { SatContent } from "@/features/sat/SatContent";
import { SatRevealPanel, SatVerdictStrip } from "@/features/sat/SatRevealPanel";

export interface SatQuestionPaneProps {
  questionNumber: number;
  question: SatQuestionPublic;
  answer: string | undefined;
  eliminations: ReadonlySet<string>;
  eliminateMode: boolean;
  reveal: SatReveal | undefined;
  attempts: readonly SatAttemptOut[];
  bookmarked: boolean;
  onAnswer: (value: string) => void;
  onToggleEliminate: (label: string) => void;
  onToggleEliminateMode: () => void;
  onToggleBookmark: () => void;
  /** The stem's own content ref (not the whole pane) — `useSatHighlighter`
   * walks exactly this element's text nodes, so it must never include the
   * strap, answer choices, or reveal panel (plan §6.3, Q33). */
  stemRef: RefObject<HTMLDivElement | null>;
}

const SPR_MASK = /^[0-9./-]{0,7}$/;

/** The newest attempt's time — the one the verdict strip is about. */
function latestAttemptSeconds(
  attempts: readonly SatAttemptOut[],
): number | undefined {
  let latest: SatAttemptOut | undefined;
  for (const attempt of attempts) {
    if (!latest || attempt.id > latest.id) latest = attempt;
  }
  return latest?.time_spent_seconds;
}

/** The right column (or the only column, Q12/Q13): strap · stem · choices
 * or SPR · reveal panels (ui-spec §4). */
export function SatQuestionPane({
  questionNumber,
  question,
  answer,
  eliminations,
  eliminateMode,
  reveal,
  attempts,
  bookmarked,
  onAnswer,
  onToggleEliminate,
  onToggleEliminateMode,
  onToggleBookmark,
  stemRef,
}: SatQuestionPaneProps): React.ReactElement {
  const revealed = reveal !== undefined;

  return (
    <div className={cn("h-full overflow-y-auto px-4 py-5 [scrollbar-gutter:stable] min-[861px]:px-10 min-[861px]:py-8 max-[860px]:h-auto max-[860px]:overflow-visible", satScrollFadeClass)}>
      <div className="mx-auto flex min-w-0 max-w-[760px] flex-col gap-5">
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] pb-3">
          <span
            aria-label={SAT_PRACTICE_COPY.questionNumber(questionNumber)}
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--control-quiet-surface)] px-2 text-[13px] font-semibold tabular-nums text-[var(--ink)]"
            role="img"
          >
            {questionNumber}
          </span>
          <Button
            aria-pressed={bookmarked}
            className={cn(
              "text-[var(--ink-secondary)]",
              bookmarked &&
                "bg-[var(--control-quiet-surface)] text-[var(--ink)]",
            )}
            onClick={onToggleBookmark}
            size="sm"
            variant="ghost"
          >
            <Bookmark
              aria-hidden="true"
              className={cn("size-4", bookmarked && "fill-current")}
            />
            {SAT_PRACTICE_COPY.markForReview}
          </Button>
          {question.item_type === "mcq" && !revealed && (
            <Button
              aria-label={SAT_PRACTICE_COPY.eliminateModeTooltip}
              aria-pressed={eliminateMode}
              className="ml-auto text-[var(--ink-secondary)] aria-pressed:bg-[var(--control-quiet-surface)] aria-pressed:text-[var(--ink)]"
              onClick={onToggleEliminateMode}
              size="icon-sm"
              variant="ghost"
            >
              <Strikethrough aria-hidden="true" className="size-4" />
            </Button>
          )}
        </div>

        <h2
          className="text-base font-normal text-wrap-pretty"
          id="sat-question-heading"
          tabIndex={-1}
        >
          <SatContent
            className="sat-content--reading"
            contentSha={question.content_sha256}
            field="stem"
            html={question.stem}
            ref={stemRef}
          />
        </h2>

        {question.item_type === "mcq" ? (
          <div
            aria-label={SAT_PRACTICE_COPY.answerChoices.groupLabel}
            className="flex flex-col gap-3"
            role="group"
          >
            {question.answer_options.map((option) => (
              <SatAnswerChoice
                content={option.content}
                contentSha={question.content_sha256}
                eliminateMode={eliminateMode}
                eliminated={eliminations.has(option.label)}
                isCorrectAnswer={
                  reveal?.correctAnswers.includes(option.label) ?? false
                }
                key={option.label}
                label={option.label}
                onSelect={() => onAnswer(option.label)}
                onToggleEliminate={() => onToggleEliminate(option.label)}
                revealed={revealed}
                selected={answer === option.label}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium text-[var(--ink)]"
              htmlFor="sat-spr-input"
            >
              {SAT_PRACTICE_COPY.studentProducedResponseLabel}
            </label>
            <InputGroup
              className={cn(
                "h-11 max-w-80 rounded-xl",
                revealed &&
                  (reveal?.isCorrect
                    ? "border-[var(--success-border)] bg-[var(--success-surface)] has-[[data-slot=input-group-control]:focus-visible]:border-[var(--success-border)] has-[[data-slot=input-group-control]:focus-visible]:ring-0"
                    : "border-[var(--danger-border)] bg-[var(--danger-surface)] has-[[data-slot=input-group-control]:focus-visible]:border-[var(--danger-border)] has-[[data-slot=input-group-control]:focus-visible]:ring-0"),
              )}
            >
              <InputGroupInput
                aria-describedby={revealed ? "sat-verdict" : undefined}
                className="text-lg tabular-nums"
                id="sat-spr-input"
                maxLength={7}
                onChange={(event) => {
                  const value = event.target.value;
                  if (SPR_MASK.test(value)) {
                    onAnswer(value);
                  }
                }}
                placeholder={SAT_PRACTICE_COPY.sprPlaceholder}
                readOnly={revealed}
                type="text"
                value={answer ?? ""}
              />
              {revealed && (
                <InputGroupAddon
                  align="inline-end"
                  className={
                    reveal?.isCorrect
                      ? "text-[var(--success-fg)]"
                      : "text-[var(--danger-fg)]"
                  }
                >
                  {reveal?.isCorrect ? (
                    <Check aria-hidden="true" className="size-5" />
                  ) : (
                    <X aria-hidden="true" className="size-5" />
                  )}
                </InputGroupAddon>
              )}
            </InputGroup>
          </div>
        )}

        {reveal && (
          <div className="flex flex-col gap-4" id="sat-verdict">
            <SatVerdictStrip
              correctAnswers={reveal.correctAnswers}
              isCorrect={reveal.isCorrect}
              seconds={latestAttemptSeconds(attempts)}
            />
            <SatRevealPanel
              attempts={attempts}
              contentSha={question.content_sha256}
              questionId={question.question_id}
              rationale={reveal.rationale}
            />
          </div>
        )}
      </div>
    </div>
  );
}
