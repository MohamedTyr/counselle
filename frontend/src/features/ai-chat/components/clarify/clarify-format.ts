import type {
  ClarifyResponseV2,
  ClarifySpec,
  ClarifySpecV1,
  ClarifySpecV2,
} from "@/api/chat/types";

export function isLegacyClarifySpec(spec: ClarifySpec): spec is ClarifySpecV1 {
  return spec.v === 1 && "options" in spec;
}

export function isCurrentClarifySpec(spec: ClarifySpec): spec is ClarifySpecV2 {
  return spec.v === 2 && "questions" in spec;
}

export function clarifyAnswerSummary(
  spec: ClarifySpecV2,
  response: ClarifyResponseV2 | null,
): string | null {
  if (response === null) return null;
  if (response.mode === "reply") return response.text;

  const questionById = new Map(
    spec.questions.map((question) => [question.id, question]),
  );
  const lines = response.answers.flatMap((answer) => {
    const question = questionById.get(answer.question_id);
    if (question === undefined) return [];
    const optionLabels = answer.option_ids.map(
      (id) => question.options.find((option) => option.id === id)?.label ?? id,
    );
    const text = [...optionLabels, answer.custom_text]
      .filter((value): value is string => value !== undefined && value !== null)
      .filter((value) => value.trim().length > 0)
      .join(", ");
    return text.trim().length > 0 ? [text] : [];
  });
  return lines.length > 0 ? lines.join("; ") : null;
}

export function answerTextForQuestion(
  spec: ClarifySpecV2,
  response: ClarifyResponseV2,
  questionId: string,
): string {
  if (response.mode === "reply") {
    return "Answered in reply.";
  }

  const question = spec.questions.find((entry) => entry.id === questionId);
  const answer = response.answers.find((entry) => entry.question_id === questionId);
  if (question === undefined || answer === undefined) {
    return "Not answered.";
  }

  const optionLabels = answer.option_ids.map(
    (id) => question.options.find((option) => option.id === id)?.label ?? id,
  );
  const text = [...optionLabels, answer.custom_text]
    .filter((value): value is string => value !== undefined && value !== null)
    .filter((value) => value.trim().length > 0)
    .join(", ");
  return text.length > 0 ? text : "Not answered.";
}
