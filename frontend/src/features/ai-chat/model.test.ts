import { describe, expect, test } from "vitest";

import type { TimelineEntry } from "./turn-reducer";
import { initialTurnState, type TurnState } from "./turn-reducer";
import { assistantMessage, messagesFromTranscript } from "./model";
import type { TranscriptEntry } from "@/api/chat/types";

describe("messagesFromTranscript", () => {
  test("projects user and assistant entries with preserved ids and parents", () => {
    const entries: TranscriptEntry[] = [
      {
        role: "user",
        text: "What is NYU?",
        ts: "2026-06-01T00:00:00Z",
        message_id: "u1",
      },
      {
        role: "assistant",
        text: "A school.",
        ts: "2026-06-01T00:00:01Z",
        message_id: "a1",
      },
    ];

    const messages = messagesFromTranscript("c1", entries);

    expect(messages[0]).toMatchObject({
      kind: "user",
      isCreatedByUser: true,
      messageId: "u1",
      hasBackendId: true,
    });
    expect(messages[1]).toMatchObject({
      kind: "assistant",
      isCreatedByUser: false,
      messageId: "a1",
      parentMessageId: "u1",
      hasBackendId: true,
    });
    expect("blocks" in messages[0]).toBe(false);
  });

  test("fallback ids mark pre-MVP2 messages as backend-id-less", () => {
    const messages = messagesFromTranscript("c1", [
      { role: "user", text: "hi", ts: null },
    ]);

    expect(messages[0].messageId).toBe("msg-c1-0");
    expect(messages[0].hasBackendId).toBe(false);
  });

  test("synthesized clarify-answer bubble carries synthesized flag", () => {
    const messages = messagesFromTranscript("c1", [
      {
        role: "user",
        text: "Early Decision",
        ts: null,
        message_id: "u1",
        synthesized: true,
      },
    ]);

    expect(messages[0]).toMatchObject({ kind: "user", synthesized: true });
  });

  test("feedback maps up/down to thumbsUp/thumbsDown", () => {
    const messages = messagesFromTranscript("c1", [
      {
        role: "assistant",
        text: "A.",
        ts: null,
        message_id: "a1",
        feedback: { rating: "up" },
      },
      {
        role: "assistant",
        text: "B.",
        ts: null,
        message_id: "a2",
        feedback: { rating: "down" },
      },
    ]);

    expect(messages[0]).toMatchObject({
      kind: "assistant",
      feedback: { rating: "thumbsUp" },
    });
    expect(messages[1]).toMatchObject({
      kind: "assistant",
      feedback: { rating: "thumbsDown" },
    });
  });

  test("clarifyAnswer is threaded from transcript entry outside reducer replay", () => {
    const messages = messagesFromTranscript("c1", [
      {
        role: "assistant",
        text: "Which round?",
        ts: null,
        message_id: "a1",
        clarify: {
          spec: {
            v: 1,
            question: "Which round?",
            header: "",
            multi_select: false,
            options: [],
          },
          answer: "Regular Decision",
        },
      },
    ]);

    expect(messages[0]).toMatchObject({
      kind: "assistant",
      clarifyAnswer: "Regular Decision",
    });
  });
});

describe("assistantMessage activities", () => {
  test("same timeline reference returns same activities array reference", () => {
    const timeline: TimelineEntry[] = [
      {
        type: "step",
        step: {
          step_id: "s1",
          label: "Reading CDS",
          status: "end",
          kind: "db_tool",
          tier: null,
          detail: null,
        },
      },
      { type: "thinking", id: "t1", text: "pondering" },
    ];
    const state: TurnState = {
      ...initialTurnState(),
      timeline,
      status: "complete",
    };

    const first = assistantMessage("c1", "a1", "u1", state, null);
    const second = assistantMessage("c1", "a1", "u1", state, null);

    expect(first.activities).toBe(second.activities);
    expect(first.activities).toEqual(["Reading CDS", "Thinking…"]);
  });
});
