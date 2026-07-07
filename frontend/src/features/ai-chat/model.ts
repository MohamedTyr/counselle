import type {
  ClarifySpec,
  ErrorData,
  SourceEntry,
  StepRecord,
  TranscriptEntry,
} from "@/api/chat/types";

import {
  answerBlocksOf,
  deriveDurationMs,
  narrationTextsOf,
  proseOf,
  reduceTranscriptEntry,
  stepsOf,
  toStepRecord,
  type ContentBlock,
  type Segment,
  type TurnState,
  type TurnStatus,
} from "./turn-reducer";

export type FeedbackRating = "thumbsUp" | "thumbsDown";

export type ChatMessageBase = {
  messageId: string;
  conversationId: string;
  parentMessageId: string | null;
  text: string;
  sender: string;
  ts: string | null;
  hasBackendId?: boolean;
};

export type UserChatMessage = ChatMessageBase & {
  kind: "user";
  isCreatedByUser: true;
  synthesized?: boolean;
};

export type AssistantChatMessage = ChatMessageBase & {
  kind: "assistant";
  isCreatedByUser: false;
  /** The full chronological run surface: narration, tool, thinking, answer,
   * and viz beats in stream order — what `AssistantBody` renders. */
  segments: Segment[];
  /** The final citeable answer's content only (markdown + inline viz) — what
   * copy/citations/sources key off. A subset of `segments`, never the render
   * order. */
  blocks: ContentBlock[];
  stepRecord?: StepRecord;
  receipt?: string;
  /** Whole-turn wall-clock duration. Not rendered by any component today —
   * the settled "Thought for Xs" affordance moved to the per-occurrence,
   * per-beat `ThinkingBeat` (which needs its own timing, not the turn
   * total). Kept for telemetry and a future settled-duration display. */
  durationMs?: number;
  sources?: SourceEntry[];
  clarify?: ClarifySpec;
  clarifyAnswer?: string | null;
  turnStatus?: TurnStatus;
  streamError?: ErrorData;
  isThinking?: boolean;
  feedback?: { rating: FeedbackRating };
};

export type ChatMessage = UserChatMessage | AssistantChatMessage;

export type AskProps = {
  text: string;
  messageId?: string | null;
  parentMessageId?: string | null;
  conversationId?: string | null;
};

export function assistantMessage(
  conversationId: string,
  messageId: string,
  parentMessageId: string | null,
  state: TurnState,
  ts: string | null,
): AssistantChatMessage {
  const blocks = answerBlocksOf(state);
  const steps = stepsOf(state);
  const thinking = narrationTextsOf(state);
  const record = toStepRecord(state, steps, thinking);
  const isLive = state.status === "streaming" || state.status === "idle";
  const hasProseTail = blocks.at(-1)?.kind === "markdown";
  const hasActiveTool = state.segments.some(
    (segment) => segment.type === "tool" && segment.step.status === "start",
  );
  const hasNarrationOrThinking = state.segments.some(
    (segment) => segment.type === "narration" || segment.type === "thinking",
  );
  const isThinking = isLive && !hasActiveTool && !hasProseTail && !hasNarrationOrThinking;

  return {
    kind: "assistant",
    messageId,
    conversationId,
    parentMessageId,
    text: proseOf(state, blocks),
    isCreatedByUser: false,
    sender: "Counselle",
    segments: state.segments,
    blocks,
    stepRecord: record,
    receipt: record?.receipt,
    durationMs: deriveDurationMs(state, steps),
    sources: state.sources.length > 0 ? state.sources : undefined,
    clarify: state.clarify ?? undefined,
    turnStatus: state.status,
    streamError: state.error ?? undefined,
    isThinking,
    ts,
  };
}

export function userMessage(
  conversationId: string,
  messageId: string,
  parentMessageId: string | null,
  text: string,
  ts: string | null,
): UserChatMessage {
  return {
    kind: "user",
    messageId,
    conversationId,
    parentMessageId,
    text,
    isCreatedByUser: true,
    sender: "",
    ts,
  };
}

export function messagesFromTranscript(
  conversationId: string,
  entries: TranscriptEntry[],
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  entries.forEach((entry, index) => {
    const hasBackendId = entry.message_id !== undefined;
    const messageId = entry.message_id ?? `msg-${conversationId}-${index}`;
    const parentMessageId =
      index > 0 ? (messages[index - 1]?.messageId ?? null) : null;

    if (entry.role === "user") {
      messages.push({
        ...userMessage(conversationId, messageId, parentMessageId, entry.text, entry.ts),
        synthesized: entry.synthesized === true,
        hasBackendId,
      });
      return;
    }

    const state = reduceTranscriptEntry(entry);
    messages.push({
      ...assistantMessage(conversationId, messageId, parentMessageId, state, entry.ts),
      hasBackendId,
      clarifyAnswer: entry.clarify?.answer,
      feedback:
        entry.feedback !== undefined
          ? {
              rating:
                entry.feedback.rating === "up" ? "thumbsUp" : "thumbsDown",
            }
          : undefined,
    });
  });

  return messages;
}
