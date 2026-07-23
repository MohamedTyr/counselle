import type { ClarifyResponseV2, ClarifySpecV2 } from "@/api/chat/types";

import { answerTextForQuestion } from "./clarify-format";

export function ClarifySummary({
  response,
  spec,
}: {
  spec: ClarifySpecV2;
  response: ClarifyResponseV2 | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      {spec.questions.map((question) => {
        const answer =
          response === null
            ? "Not answered."
            : answerTextForQuestion(spec, response, question.id);

        return (
          <div
            className="rounded-lg border bg-background px-3 py-2"
            key={question.id}
          >
            <p className="text-sm font-medium text-foreground">
              {question.question}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {answer}
            </p>
          </div>
        );
      })}
    </div>
  );
}
