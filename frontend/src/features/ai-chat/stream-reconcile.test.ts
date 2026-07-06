import { describe, expect, test } from "vitest";

import type { ChatMessage } from "./model";
import { upsertAssistantMessage } from "./stream-reconcile";

function user(messageId: string, conversationId = "s1"): ChatMessage {
  return {
    kind: "user",
    messageId,
    conversationId,
    parentMessageId: null,
    text: "Question",
    isCreatedByUser: true,
    sender: "",
    hasBackendId: true,
    ts: null,
  };
}

function assistant(messageId: string, conversationId = "s1"): ChatMessage {
  return {
    kind: "assistant",
    messageId,
    conversationId,
    parentMessageId: "u1",
    text: "Answer",
    isCreatedByUser: false,
    sender: "Counselle",
    blocks: [{ kind: "markdown", text: "Answer" }],
    hasBackendId: true,
    ts: null,
  };
}

describe("stream reconcile", () => {
  test("upsert replaces only matching assistant cards", () => {
    const existingUser = user("a1");
    const otherConversationAssistant = assistant("a1", "s2");
    const existingAssistant = assistant("a1");
    const replacement = {
      ...assistant("a1"),
      text: "Replacement",
      blocks: [{ kind: "markdown" as const, text: "Replacement" }],
    };

    expect(
      upsertAssistantMessage(
        [existingUser, otherConversationAssistant, existingAssistant],
        replacement,
      ),
    ).toEqual([existingUser, otherConversationAssistant, replacement]);
  });
});
