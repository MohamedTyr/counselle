import { Bookmark, Strikethrough } from "lucide-react";
import type React from "react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

import type { SatAttemptOut, SatQuestionPublic } from "@/api/sat/types";
import type { SatReveal } from "@/features/sat/sat-session-reducer";
import { SAT_PRACTICE_COPY } from "@/features/sat/sat-copy";
import { SatAnswerChoice } from "@/features/sat/SatAnswerChoice";
import { SatContent } from "@/features/sat/SatContent";
import { SatRevealPanel } from "@/features/sat/SatRevealPanel";

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
  const acceptedList =
    reveal && !reveal.isCorrect ? reveal.correctAnswers.join(", ") : "";

  return (
    <div className="h-full overflow-y-auto px-10 py-6">
        <div className="mx-auto flex max-w-[860px] flex-col gap-4">
          <div className="flex h-10 items-center gap-2 rounded-lg bg-[var(--surface-inset)] px-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--ink)] text-sm font-medium tabular-nums text-[var(--on-ink)]">
              {questionNumber}
            </span>
            <Button
              aria-pressed={bookmarked}
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
                className="ml-auto"
                onClick={onToggleEliminateMode}
                size="icon-sm"
                variant="ghost"
              >
                <Strikethrough aria-hidden="true" className="size-4" />
              </Button>
            )}
          </div>

          <h2
            className="sat-content text-base leading-[1.72] text-wrap-pretty"
            id="sat-question-heading"
            tabIndex={-1}
          >
            <SatContent
              contentSha={question.content_sha256}
              field="stem"
              html={question.stem}
              ref={stemRef}
            />
          </h2>

          {question.item_type === "mcq" ? (
            <div aria-label="Answer choices" className="flex flex-col gap-2" role="group">
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
                className="text-sm font-medium"
                htmlFor="sat-spr-input"
              >
                {SAT_PRACTICE_COPY.studentProducedResponseLabel}
              </label>
              <InputGroup
                className={cn(
                  "max-w-80",
                  revealed &&
                    (reveal?.isCorrect
                      ? "border-[var(--success-border)]"
                      : "border-[var(--danger-border)]"),
                )}
              >
                <InputGroupInput
                  aria-describedby={revealed ? "sat-spr-verdict" : undefined}
                  className="tabular-nums"
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
              </InputGroup>
              {revealed && (
                <p
                  aria-live="polite"
                  className={cn(
                    "text-sm",
                    reveal?.isCorrect
                      ? "text-[var(--success-fg)]"
                      : "text-[var(--danger-fg)]",
                  )}
                  id="sat-spr-verdict"
                >
                  {reveal?.isCorrect
                    ? SAT_PRACTICE_COPY.sprCorrect
                    : SAT_PRACTICE_COPY.sprIncorrect(reveal?.correctAnswers ?? [])}
                </p>
              )}
            </div>
          )}

          {question.item_type === "mcq" && revealed && (
            <p aria-live="polite" className="sr-only">
              {reveal?.isCorrect ? SAT_PRACTICE_COPY.sprCorrect : `Incorrect. ${acceptedList}`}
            </p>
          )}

          {revealed && (
            <SatRevealPanel
              attempts={attempts}
              contentSha={question.content_sha256}
              questionId={question.question_id}
              rationale={reveal?.rationale ?? ""}
            />
          )}
        </div>
    </div>
  );
}
