/* eslint-disable react-refresh/only-export-components */
import type * as React from "react";
import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/*
 * The one prompt-entry pattern in the app (rule 21): a prompt textarea plus
 * an optional word-limit field. Fully controlled, and it renders no actions
 * of its own — the school-workspace list row (SchoolEssaysSection) and the
 * "New essay" dialog's supplement branch (a later phase) each own submit and
 * cancel differently, so the composer only owns the two fields both callers
 * share.
 *
 * An empty prompt field *is* "no prompt" — there is no mode toggle, no
 * radio, no second button. One affordance that degrades.
 */

export interface EssayPromptComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  wordLimit: string;
  onWordLimitChange: (value: string) => void;
  /** Focus target for callers that move focus in on open. */
  promptFieldRef?: React.Ref<HTMLTextAreaElement>;
  /** Focus target for callers that return focus here after a blocked submit. */
  wordLimitFieldRef?: React.Ref<HTMLInputElement>;
  className?: string;
}

export function EssayPromptComposer({
  prompt,
  onPromptChange,
  wordLimit,
  onWordLimitChange,
  promptFieldRef,
  wordLimitFieldRef,
  className,
}: EssayPromptComposerProps): React.ReactElement {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Prompt (optional)
        <Textarea
          onChange={(event) => onPromptChange(event.currentTarget.value)}
          placeholder="Paste or type the prompt — leave it blank if you don't have it yet"
          ref={promptFieldRef}
          value={prompt}
        />
      </label>
      <WordLimitField
        onWordLimitChange={onWordLimitChange}
        wordLimit={wordLimit}
        wordLimitFieldRef={wordLimitFieldRef}
      />
    </div>
  );
}

function WordLimitField({
  onWordLimitChange,
  wordLimit,
  wordLimitFieldRef,
}: {
  onWordLimitChange: (value: string) => void;
  wordLimit: string;
  wordLimitFieldRef?: React.Ref<HTMLInputElement>;
}) {
  const wordLimitId = useId();
  const wordLimitErrorId = useId();
  const wordLimitInvalid = isWordLimitInvalid(wordLimit);

  return (
    <div className="flex max-w-40 flex-col gap-1.5">
      <label className="text-sm font-medium" htmlFor={wordLimitId}>
        Word limit (optional)
      </label>
      <Input
        aria-describedby={wordLimitInvalid ? wordLimitErrorId : undefined}
        aria-invalid={wordLimitInvalid}
        id={wordLimitId}
        max={MAX_WORD_LIMIT}
        min={1}
        onChange={(event) => onWordLimitChange(event.currentTarget.value)}
        ref={wordLimitFieldRef}
        type="number"
        value={wordLimit}
      />
      {wordLimitInvalid && (
        <p
          className="text-xs text-destructive"
          id={wordLimitErrorId}
          role="alert"
        >
          Enter a whole number from 1 to {MAX_WORD_LIMIT.toLocaleString()}, or
          leave it blank.
        </p>
      )}
    </div>
  );
}

/** No essay realistically needs a limit past this — guards against typos and
 * the browser's own `type="number"` exponential notation (`"1e3"`). */
const MAX_WORD_LIMIT = 100_000;

/**
 * Shared by both composer callers: a blank or non-positive word limit means
 * "no limit," never a zero. Only a plain positive integer counts — anything
 * else (decimals, exponential notation like the browser-accepted "1e3",
 * stray characters) is rejected outright rather than silently truncated by
 * `parseInt`.
 */
export function parseWordLimit(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed > 0 && parsed <= MAX_WORD_LIMIT ? parsed : null;
}

/**
 * True only when the student has typed *something* that `parseWordLimit`
 * rejects — a blank field is "no limit," not an error, so it is never
 * invalid. Exported so callers can block submission on the same rule the
 * composer uses to render its own error state (one source of truth).
 */
export function isWordLimitInvalid(text: string): boolean {
  return text.trim() !== "" && parseWordLimit(text) === null;
}
