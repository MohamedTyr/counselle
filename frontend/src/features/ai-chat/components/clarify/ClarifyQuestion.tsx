import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";

import type { ClarifyQuestionV2 } from "@/api/chat/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { ClarifyQuestionDraft } from "../../useClarifyDraft";

type ClarifyQuestionProps = {
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
};

type OptionGroupProps = Pick<
  ClarifyQuestionProps,
  "draft" | "onOptionChange" | "question"
> & {
  describedBy: string;
  headingId: string;
};

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
}: ClarifyQuestionProps) {
  const headingId = useId();
  const helperId = useId();
  const errorId = useId();
  const [customAnswerOpen, setCustomAnswerOpen] = useState(
    draft.customText.trim().length > 0,
  );
  const describedBy =
    draft.validationError === null ? helperId : `${helperId} ${errorId}`;

  return (
    <fieldset
      aria-describedby={describedBy}
      aria-invalid={draft.validationError !== null}
      className="flex flex-col gap-3"
    >
      <QuestionHeading
        headingId={headingId}
        helperId={helperId}
        question={question}
        questionHeadingRef={questionHeadingRef}
        questionNumber={questionNumber}
        totalQuestions={totalQuestions}
      />
      <ClarifyOptionGroup
        describedBy={describedBy}
        draft={draft}
        headingId={headingId}
        onOptionChange={(optionId, checked) => {
          if (question.selection === "single" && checked) {
            setCustomAnswerOpen(false);
          }
          onOptionChange(optionId, checked);
        }}
        question={question}
      />
      {draft.validationError !== null && (
        <p className="text-xs text-destructive" id={errorId} role="alert">
          {draft.validationError}
        </p>
      )}
      <div className="flex items-end justify-between gap-3">
        <CustomAnswerField
          describedBy={describedBy}
          draft={draft}
          onCustomTextChange={onCustomTextChange}
          onOpenChange={setCustomAnswerOpen}
          open={customAnswerOpen}
        />
        <Button
          className="shrink-0"
          onClick={isFinal ? onSubmit : onNext}
          size="sm"
          type="button"
        >
          {isFinal ? "Send answers" : "Next"}
        </Button>
      </div>
    </fieldset>
  );
}

function QuestionHeading({
  headingId,
  helperId,
  question,
  questionHeadingRef,
  questionNumber,
  totalQuestions,
}: {
  headingId: string;
  helperId: string;
  question: ClarifyQuestionV2;
  questionHeadingRef?: (node: HTMLLegendElement | null) => void;
  questionNumber: number;
  totalQuestions: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      {totalQuestions > 1 && (
        <p className="text-xs text-muted-foreground">
          {questionNumber} of {totalQuestions}
        </p>
      )}
      <legend
        aria-label={
          totalQuestions > 1
            ? `Question ${questionNumber} of ${totalQuestions}. ${question.question}`
            : undefined
        }
        className="max-w-[65ch] text-sm leading-snug font-medium text-foreground outline-none"
        id={headingId}
        ref={questionHeadingRef}
        tabIndex={-1}
      >
        {question.question}
      </legend>
      <p
        className="max-w-[65ch] text-xs leading-relaxed text-muted-foreground"
        id={helperId}
      >
        {question.selection === "multiple"
          ? "Choose all that apply."
          : "Choose one, or type your own answer."}
      </p>
    </div>
  );
}

function ClarifyOptionGroup({
  describedBy,
  draft,
  headingId,
  onOptionChange,
  question,
}: OptionGroupProps) {
  if (question.selection === "single") {
    return (
      <RadioGroup
        aria-describedby={describedBy}
        aria-labelledby={headingId}
        onValueChange={(optionId) => onOptionChange(optionId, true)}
        value={draft.selectedOptionIds[0] ?? ""}
      >
        {question.options.map((option) => (
          <ClarifyOptionRow
            control={
              <RadioGroupItem
                aria-invalid={draft.validationError !== null}
                id={`${headingId}-${option.id}`}
                value={option.id}
              />
            }
            hint={option.hint}
            htmlFor={`${headingId}-${option.id}`}
            key={option.id}
            label={option.label}
            selected={draft.selectedOptionIds.includes(option.id)}
          />
        ))}
      </RadioGroup>
    );
  }

  return (
    <div
      aria-describedby={describedBy}
      aria-labelledby={headingId}
      className="flex flex-col gap-2"
      role="group"
    >
      {question.options.map((option) => {
        const selected = draft.selectedOptionIds.includes(option.id);
        return (
          <ClarifyOptionRow
            control={
              <Checkbox
                aria-invalid={draft.validationError !== null}
                checked={selected}
                id={`${headingId}-${option.id}`}
                onCheckedChange={(checked) =>
                  onOptionChange(option.id, checked === true)
                }
              />
            }
            hint={option.hint}
            htmlFor={`${headingId}-${option.id}`}
            key={option.id}
            label={option.label}
            selected={selected}
          />
        );
      })}
    </div>
  );
}

function ClarifyOptionRow({
  control,
  hint,
  htmlFor,
  label,
  selected,
}: {
  control: ReactNode;
  hint?: string | null;
  htmlFor: string;
  label: string;
  selected: boolean;
}) {
  return (
    <label
      className={cn(
        "group flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-background px-3 py-2.5 text-left transition-colors duration-150 hover:bg-accent",
        selected &&
          "border-[var(--workspace-border)] bg-[var(--workspace-surface-active)]",
      )}
      htmlFor={htmlFor}
    >
      <span className="mt-0.5">{control}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "text-sm leading-snug font-medium text-foreground",
            selected && "font-semibold",
          )}
        >
          {label}
        </span>
        {hint !== undefined && hint !== null && hint.length > 0 && (
          <span className="text-xs leading-relaxed text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

function CustomAnswerField({
  describedBy,
  draft,
  onCustomTextChange,
  onOpenChange,
  open,
}: {
  describedBy: string;
  draft: ClarifyQuestionDraft;
  onCustomTextChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const inputId = useId();
  const focusOnOpenRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open && focusOnOpenRef.current) {
      textareaRef.current?.focus();
      focusOnOpenRef.current = false;
    }
  }, [open]);

  return (
    <Collapsible
      className="min-w-0 flex-1"
      onOpenChange={(nextOpen) => {
        focusOnOpenRef.current = nextOpen;
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <CollapsibleTrigger asChild>
        <Button
          className="group -ml-2 text-muted-foreground"
          size="sm"
          type="button"
          variant="ghost"
        >
          Something else
          <ChevronDownIcon
            className="transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            data-icon="inline-end"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1">
        <label className="sr-only" htmlFor={inputId}>
          Something else
        </label>
        <Textarea
          aria-describedby={describedBy}
          aria-invalid={draft.validationError !== null}
          id={inputId}
          onChange={(event) => onCustomTextChange(event.target.value)}
          placeholder="Type your own answer"
          ref={textareaRef}
          value={draft.customText}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
