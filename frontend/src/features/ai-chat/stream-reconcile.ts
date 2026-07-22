import type { ClarifyResponseV2, ResponseMode } from "@/api/chat/types";

import type { TurnState } from "./turn-reducer";
import { clarifyResponseText, runMarkdownOf } from "./turn-reducer";
import { assistantMessage, type ChatMessage } from "./model";

export function reconcileMetaIds(
  previous: ChatMessage[],
  previousUserId: string,
  backendUserId: string,
): { next: ChatMessage[]; matched: boolean } {
  let matched = false;
  const next = previous.map((message) => {
    if (message.messageId !== previousUserId) {
      return message;
    }

    matched = true;
    return { ...message, messageId: backendUserId, hasBackendId: true };
  });

  return { next, matched };
}

export function upsertAssistantMessage(
  previous: ChatMessage[],
  assistant: ChatMessage,
): ChatMessage[] {
  const replaceIndex = previous.findIndex(
    (message) =>
      message.kind === "assistant" &&
      message.conversationId === assistant.conversationId &&
      message.messageId === assistant.messageId,
  );

  if (replaceIndex === -1) {
    return [...previous, assistant];
  }

  return previous.map((message, index) =>
    index === replaceIndex ? assistant : message,
  );
}

export function patchClarifyResponse(
  previous: ChatMessage[],
  clarifyMessageId: string,
  continuationMessageId: string,
  response: ClarifyResponseV2,
): ChatMessage[] {
  let patched = false;
  const next = previous.map((message) => {
    if (
      message.kind !== "assistant" ||
      message.messageId !== clarifyMessageId ||
      message.clarify === undefined
    ) {
      return message;
    }

    patched = true;
    const segments = message.segments.map((segment) =>
      segment.type === "clarify" ? { ...segment, response } : segment,
    );
    const clarifyAnswer = clarifyResponseText(message.clarify, response);
    return {
      ...message,
      segments,
      clarifyAnswer,
      continuationMessageId,
      runMarkdown: runMarkdownOf(segments),
      turnStatus:
        message.turnStatus === "awaiting_input" ? "complete" : message.turnStatus,
    };
  });

  return patched ? next : previous;
}

export function persistTerminalTurn({
  sessionId,
  assistantMessageId,
  userMessageId,
  hasBackendId,
  state,
  executionResponseMode,
}: {
  sessionId: string;
  assistantMessageId: string;
  userMessageId: string;
  hasBackendId: boolean;
  state: TurnState;
  executionResponseMode: ResponseMode;
}): ChatMessage {
  return {
    ...assistantMessage(
      sessionId,
      assistantMessageId,
      userMessageId,
      state,
      new Date().toISOString(),
      { supported: true, mode: executionResponseMode },
    ),
    hasBackendId,
  };
}

export function persistErroredTurn({
  sessionId,
  assistantMessageId,
  userMessageId,
  hasBackendId,
  state,
  message,
  executionResponseMode,
}: {
  sessionId: string;
  assistantMessageId: string;
  userMessageId: string;
  hasBackendId: boolean;
  state: TurnState;
  message: string;
  executionResponseMode: ResponseMode;
}): ChatMessage {
  return persistTerminalTurn({
    sessionId,
    assistantMessageId,
    userMessageId,
    hasBackendId,
    state: {
      ...state,
      status: "error",
      error: state.error ?? { message, trace_id: "" },
    },
    executionResponseMode,
  });
}
