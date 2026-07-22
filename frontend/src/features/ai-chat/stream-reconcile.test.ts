import { describe, expect, test } from "vitest";

import type { ChatMessage } from "./model";
import { patchClarifyResponse, upsertAssistantMessage } from "./stream-reconcile";

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
    runMarkdown: "Answer",
    segments: [{ type: "answer", text: "Answer" }],
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
      runMarkdown: "Replacement",
      segments: [{ type: "answer" as const, text: "Replacement" }],
    };

    expect(
      upsertAssistantMessage(
        [existingUser, otherConversationAssistant, existingAssistant],
        replacement,
      ),
    ).toEqual([existingUser, otherConversationAssistant, replacement]);
  });

  test("patchClarifyResponse freezes the parked A1 message only", () => {
    const parked: ChatMessage = {
      ...assistant("a1"),
      text: "",
      blocks: [],
      segments: [
        {
          type: "clarify",
          spec: {
            v: 2,
            questions: [
              {
                id: "q1",
                question: "Which term?",
                selection: "single",
                options: [
                  { id: "q1_o1", label: "Fall" },
                  { id: "q1_o2", label: "Spring" },
                ],
              },
            ],
          },
          response: null,
        },
      ],
      clarify: {
        v: 2,
        questions: [
          {
            id: "q1",
            question: "Which term?",
            selection: "single",
            options: [
              { id: "q1_o1", label: "Fall" },
              { id: "q1_o2", label: "Spring" },
            ],
          },
        ],
      },
      turnStatus: "awaiting_input",
    };
    const a2 = assistant("a2");

    const next = patchClarifyResponse([parked, a2], "a1", "a2", {
      v: 2,
      mode: "widget",
      answers: [{ question_id: "q1", option_ids: ["q1_o1"] }],
    });

    expect(next[0]).toMatchObject({
      kind: "assistant",
      messageId: "a1",
      clarifyAnswer: "Fall",
      continuationMessageId: "a2",
      turnStatus: "complete",
      runMarkdown: "Clarifying question\nQ: Which term?\nA: Fall",
    });
    expect(next[1]).toBe(a2);
  });
});
