import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ClarifyQuestionV2 } from "@/api/chat/types";
import { cn } from "@/lib/utils";

import type { ClarifyQuestionDraft } from "../../useClarifyDraft";

export function ClarifyQuestion({
  draft,
  isFinal,
  onCustomTextChange,
  onNext,
  onOptionChange,
  onSubmit,
  question,
  questionHeadingRef,
  questionNumber,
  totalQuestions,
}: {
  question: ClarifyQuestionV2;
  questionNumber: number;
  totalQuestions: number;
  draft: ClarifyQuestionDraft;
  isFinal: boolean;
  onCustomTextChange: (value: string) => void;
  onOptionChange: (optionId: string, checked: boolean) => void;
  onNext: () => void;
  onSubmit: () => void;
  questionHeadingRef?: (node: HTMLLegendElement | null) => void;
}) {
  const headingId = useId();
  const helperId = useId();
  const errorId = useId();
  const inputType = question.selection === "single" ? "radio" : "checkbox";
  const describedBy =
    draft.validationError === null ? helperId : `${helperId} ${errorId}`;

  return (
    <fieldset
      aria-describedby={describedBy}
      aria-invalid={draft.validationError !== null}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        {totalQuestions > 1 && (
          <p className="text-xs text-muted-foreground">
            {questionNumber} of {totalQuestions}
          </p>
        )}
        <legend
          className="text-sm font-medium text-foreground outline-none"
          id={headingId}
          ref={questionHeadingRef}
          tabIndex={-1}
        >
          {question.question}
        </legend>
        <p className="text-xs text-muted-foreground" id={helperId}>
          {question.selection === "multiple"
            ? "Choose all that apply."
            : "Choose one, or type your own answer."}
        </p>
      </div>
      <div className="flex flex-col gap-2" role="group" aria-labelledby={headingId}>
        {question.options.map((option) => {
          const selected = draft.selectedOptionIds.includes(option.id);
          return (
            <label
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                selected && "border-primary bg-accent",
              )}
              key={option.id}
            >
              <input
                checked={selected}
                className="mt-1"
                name={question.id}
                onChange={(event) =>
                  onOptionChange(option.id, event.currentTarget.checked)
                }
                type={inputType}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-foreground">
                  {option.label}
                </span>
                {option.hint !== undefined &&
                  option.hint !== null &&
                  option.hint.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
              </span>
            </label>
          );
        })}
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
        Something else
        <Textarea
          aria-describedby={describedBy}
          aria-invalid={draft.validationError !== null}
          className="min-h-24 text-base"
          onChange={(event) => onCustomTextChange(event.target.value)}
          placeholder="Type your own answer"
          value={draft.customText}
        />
      </label>
      {draft.validationError !== null && (
        <p className="text-xs text-destructive" id={errorId} role="alert">
          {draft.validationError}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={isFinal ? onSubmit : onNext} type="button">
          {isFinal ? "Send answers" : "Next"}
        </Button>
      </div>
    </fieldset>
  );
}
