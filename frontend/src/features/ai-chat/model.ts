import type {
  ClarifySpec,
  ErrorData,
  SourceEntry,
  StepRecord,
  TranscriptEntry,
} from "@/api/chat/types";

import {
  deriveDurationMs,
  proseOf,
  reduceTranscriptEntry,
  toStepRecord,
  type ContentBlock,
  type TimelineEntry,
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
  blocks: ContentBlock[];
  stepRecord?: StepRecord;
  activities?: string[];
  timeline?: TimelineEntry[];
  receipt?: string;
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

export const THINKING_LABEL = "Thinking…";

const activitiesByTimeline = new WeakMap<TimelineEntry[], string[]>();

function deriveActivities(timeline: TimelineEntry[]): string[] {
  const cached = activitiesByTimeline.get(timeline);
  if (cached !== undefined) {
    return cached;
  }

  const activities = timeline
    .map((entry) => (entry.type === "step" ? entry.step.label : THINKING_LABEL))
    .filter((label, index, labels) => index === 0 || label !== labels[index - 1]);

  activitiesByTimeline.set(timeline, activities);

  return activities;
}

export function assistantMessage(
  conversationId: string,
  messageId: string,
  parentMessageId: string | null,
  state: TurnState,
  ts: string | null,
): AssistantChatMessage {
  const record = toStepRecord(state);
  const activeStep = [...state.steps]
    .reverse()
    .find((step) => step.status === "start");
  const activities = deriveActivities(state.timeline);
  const isLive = state.status === "streaming" || state.status === "idle";
  const lastBlock = state.blocks.at(-1);
  const hasProseTail = lastBlock?.kind === "markdown";
  const isThinking =
    isLive &&
    activeStep === undefined &&
    !hasProseTail &&
    state.thinking.length === 0;

  return {
    kind: "assistant",
    messageId,
    conversationId,
    parentMessageId,
    text: proseOf(state),
    isCreatedByUser: false,
    sender: "Counselle",
    blocks: state.blocks,
    stepRecord: record,
    activities,
    timeline: state.timeline,
    receipt: record?.receipt,
    durationMs: deriveDurationMs(state),
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
