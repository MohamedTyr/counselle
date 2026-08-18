import type {
  EssayEditOperation,
  WorkspaceMutationReceipt,
} from "@/api/chat/types";

import { formatWordBudget } from "./MutationReceiptBody";

/**
 * Essay-content anatomy (plan §9.4): a numbered edit-operation timeline and
 * an exact word-budget meter — never metadata rows, never persisted prose.
 * Locations are structural facts only (paragraph/word ranges); a spanning
 * edit whose paragraph boundaries can't be mapped says "Location
 * unavailable" rather than guessing.
 */

function operationLocation(operation: EssayEditOperation): string {
  const { location } = operation;
  if (
    location.kind === "paragraph_range" &&
    location.start !== null &&
    location.start !== undefined
  ) {
    const end = location.end ?? location.start;
    return end !== location.start
      ? `Paragraphs ${location.start + 1}–${end + 1}`
      : `Paragraph ${location.start + 1}`;
  }
  if (
    location.kind === "word_range" &&
    location.start !== null &&
    location.start !== undefined
  ) {
    return `Words ${location.start}–${location.end}`;
  }
  return "Location unavailable";
}

function operationVerb(operation: EssayEditOperation): string {
  if (operation.operation === "insert") return "Inserted";
  if (operation.operation === "delete") return "Deleted";
  return "Replaced";
}

function operationWords(operation: EssayEditOperation): string {
  if (operation.operation === "delete") {
    return `${operation.before_words} words`;
  }
  if (operation.operation === "insert") {
    return `${operation.after_words} words`;
  }
  return `${operation.before_words} → ${operation.after_words} words`;
}

function WordMeter({
  used,
  limit,
}: {
  used: number;
  limit: number | null | undefined;
}) {
  const over = typeof limit === "number" && used > limit;
  return (
    <p
      className={
        over ? "tabular-nums text-[var(--danger-fg)]" : "tabular-nums text-[var(--ink-secondary)]"
      }
    >
      {formatWordBudget(used, limit)}
    </p>
  );
}

export function EssayContentMutationBody({
  receipt,
}: {
  receipt: WorkspaceMutationReceipt;
}) {
  const { body } = receipt;

  if (body.kind === "essay_edit") {
    return (
      <div className="grid gap-2.5">
        <ol className="grid gap-1">
          {body.operations.map((operation, index) => (
            <li className="flex gap-2 text-[var(--ink-secondary)]" key={index}>
              <span className="tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="min-w-0">
                {operationLocation(operation)}
                {" · "}
                {operationVerb(operation)} {operationWords(operation)}
              </span>
            </li>
          ))}
        </ol>
        <dl className="grid grid-cols-[96px_1fr] gap-2 border-t border-[var(--edge)] pt-2">
          <dt className="font-medium text-muted-foreground">Final length</dt>
          <dd>
            <WordMeter limit={body.word_limit} used={body.final_word_count} />
          </dd>
        </dl>
      </div>
    );
  }

  if (body.kind === "essay_write") {
    return (
      <dl className="grid gap-1.5">
        <div className="grid grid-cols-[96px_1fr] gap-2">
          <dt className="font-medium text-muted-foreground">Draft</dt>
          <dd className="text-[var(--ink-secondary)]">
            {body.mode === "drafted" ? "Drafted" : "Replaced full draft"}
          </dd>
        </div>
        {typeof body.previous_word_count === "number" && (
          <div className="grid grid-cols-[96px_1fr] gap-2">
            <dt className="font-medium text-muted-foreground">Previous length</dt>
            <dd className="tabular-nums text-[var(--ink-secondary)]">
              {body.previous_word_count.toLocaleString()} words
            </dd>
          </div>
        )}
        <div className="grid grid-cols-[96px_1fr] gap-2">
          <dt className="font-medium text-muted-foreground">Final length</dt>
          <dd>
            <WordMeter limit={body.word_limit} used={body.final_word_count} />
          </dd>
        </div>
      </dl>
    );
  }

  return null;
}
