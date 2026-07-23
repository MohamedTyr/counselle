import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import type {
  ClarifyAnswerV2,
  ClarifyResponseV2,
  ClarifySpec,
  ClarifySpecV2,
  WidgetClarifyResponseV2,
} from "@/api/chat/types";

import type { ClarifyDraftController } from "../../useClarifyDraft";
import { ClarifyQuestion } from "./ClarifyQuestion";
import { ClarifySummary } from "./ClarifySummary";
import {
  answerTextForQuestion,
  isCurrentClarifySpec,
  isLegacyClarifySpec,
} from "./clarify-format";
import type { ClarifyWidgetAnswer } from "./types";

export function ClarifyBundle({
  draft,
  frozen,
  onAnswer,
  response,
  spec,
}: {
  spec: ClarifySpec;
  response: ClarifyResponseV2 | null;
  frozen: boolean;
  draft?: ClarifyDraftController;
  onAnswer?: (answer: ClarifyWidgetAnswer) => void;
}) {
  if (isLegacyClarifySpec(spec)) {
    return null;
  }

  if (!isCurrentClarifySpec(spec)) {
    return (
      <div className="not-prose rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Clarifying question from a newer client version.
      </div>
    );
  }

  if (
    frozen ||
    response !== null ||
    draft === undefined ||
    onAnswer === undefined
  ) {
    return (
      <section
        aria-label="Clarifying questions"
        className="not-prose my-3 flex flex-col gap-2 rounded-xl border bg-card p-3 text-sm"
      >
        <ClarifySummary response={response} spec={spec} />
      </section>
    );
  }

  return <ActiveClarifyBundle draft={draft} onAnswer={onAnswer} spec={spec} />;
}

function ActiveClarifyBundle({
  draft,
  onAnswer,
  spec,
}: {
  spec: ClarifySpecV2;
  draft: ClarifyDraftController;
  onAnswer: (answer: ClarifyWidgetAnswer) => void;
}) {
  const activeIndex = Math.min(
    draft.draft.currentQuestionIndex,
    Math.max(0, spec.questions.length - 1),
  );
  const activeQuestion = spec.questions[activeIndex];
  const headingRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const activeId = spec.questions[activeIndex]?.id;
    if (activeId !== undefined) {
      headingRefs.current[activeId]?.focus();
    }
  }, [activeIndex, spec.questions]);

  if (activeQuestion === undefined) {
    return null;
  }

  const currentDraft = draft.answerForQuestion(activeQuestion.id);
  const answerIsPresent = (questionId: string) => {
    const answer = draft.answerForQuestion(questionId);
    return (
      answer.selectedOptionIds.length > 0 || answer.customText.trim().length > 0
    );
  };
  const validateQuestion = (questionId: string) => {
    if (answerIsPresent(questionId)) {
      draft.setQuestionValidationError(questionId, null);
      return true;
    }
    draft.setQuestionValidationError(
      questionId,
      "Choose an option or type an answer.",
    );
    return false;
  };
  const focusQuestion = (questionIndex: number) => {
    const nextQuestion = spec.questions[questionIndex];
    if (nextQuestion === undefined) {
      return;
    }
    draft.setCurrentQuestionIndex(questionIndex);
  };
  const optionLabels = (questionId: string, optionIds: readonly string[]) => {
    const question = spec.questions.find((entry) => entry.id === questionId);
    if (question === undefined) {
      return [];
    }
    return optionIds.map(
      (id) => question.options.find((option) => option.id === id)?.label ?? id,
    );
  };
  const buildAnswer = (questionId: string): ClarifyAnswerV2 => {
    const question = spec.questions.find((entry) => entry.id === questionId);
    const answer = draft.answerForQuestion(questionId);
    const customText = answer.customText.trim();
    const useCustomText =
      customText.length > 0 &&
      (question?.selection === "multiple" ||
        answer.selectedOptionIds.length === 0);
    return {
      question_id: questionId,
      option_ids: answer.selectedOptionIds,
      ...(useCustomText ? { custom_text: customText } : {}),
    };
  };
  const submit = () => {
    const invalidIndex = spec.questions.findIndex(
      (question) => !validateQuestion(question.id),
    );
    if (invalidIndex >= 0) {
      focusQuestion(invalidIndex);
      return;
    }
    const answers = spec.questions.map((question) => buildAnswer(question.id));
    const responsePayload: WidgetClarifyResponseV2 = {
      v: 2,
      mode: "widget",
      answers,
    };
    const text = answers
      .flatMap((answer) => [
        ...optionLabels(answer.question_id, answer.option_ids),
        answer.custom_text ?? "",
      ])
      .filter((value) => value.trim().length > 0)
      .join("; ");
    onAnswer({ origin: "widget", text, response: responsePayload });
  };
  const next = () => {
    if (!validateQuestion(activeQuestion.id)) {
      return;
    }
    focusQuestion(activeIndex + 1);
  };

  return (
    <section
      aria-label="Clarifying questions"
      className="not-prose my-3 flex flex-col gap-3 rounded-xl border bg-card p-3 text-sm"
    >
      <div className="flex flex-col gap-2">
        {spec.questions.map((question, index) => {
          const isActive = index === activeIndex;
          const isAnswered = answerIsPresent(question.id);
          if (isActive) {
            return (
              <ClarifyQuestion
                draft={currentDraft}
                isFinal={index === spec.questions.length - 1}
                key={question.id}
                onCustomTextChange={(value) => {
                  draft.setQuestionAnswer(question.id, (previous) => ({
                    ...previous,
                    customText: value,
                    selectedOptionIds:
                      question.selection === "single" && value.trim().length > 0
                        ? []
                        : previous.selectedOptionIds,
                    validationError: null,
                  }));
                }}
                onNext={next}
                onOptionChange={(optionId, checked) => {
                  draft.setQuestionAnswer(question.id, (previous) => ({
                    ...previous,
                    selectedOptionIds:
                      question.selection === "single"
                        ? checked
                          ? [optionId]
                          : []
                        : checked
                          ? [...previous.selectedOptionIds, optionId]
                          : previous.selectedOptionIds.filter(
                              (id) => id !== optionId,
                            ),
                    customText:
                      question.selection === "single" && checked
                        ? ""
                        : previous.customText,
                    validationError: null,
                  }));
                }}
                onSubmit={submit}
                question={question}
                questionHeadingRef={(node) => {
                  headingRefs.current[question.id] = node;
                }}
                questionNumber={index + 1}
                totalQuestions={spec.questions.length}
              />
            );
          }

          return (
            <div
              className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2"
              key={question.id}
            >
              <div className="min-w-0">
                <button
                  className="text-left text-sm font-medium text-foreground outline-none"
                  onClick={() => focusQuestion(index)}
                  ref={(node) => {
                    headingRefs.current[question.id] = node;
                  }}
                  type="button"
                >
                  {question.question}
                </button>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {isAnswered
                    ? answerTextForQuestion(
                        spec,
                        {
                          v: 2,
                          mode: "widget",
                          answers: [buildAnswer(question.id)],
                        },
                        question.id,
                      )
                    : "Not answered yet."}
                </p>
              </div>
              {isAnswered && (
                <Button
                  onClick={() => focusQuestion(index)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Edit
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p aria-live="polite" className="sr-only">
        {draft.draft.sendState === "sending"
          ? "Sending clarification answer."
          : draft.draft.sendState === "answered"
            ? "Clarification answered."
            : ""}
      </p>
    </section>
  );
}
