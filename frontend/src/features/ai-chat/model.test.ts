import { describe, expect, test } from "vitest";

import type { Segment } from "./turn-reducer";
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

describe("assistantMessage", () => {
  test("segments carry the tool step and narration line in stream order", () => {
    const segments: Segment[] = [
      {
        type: "tool",
        step: {
          step_id: "s1",
          label: "Reading CDS",
          status: "end",
          kind: "db_tool",
          tier: null,
          detail: null,
        },
      },
      { type: "narration", id: "narration-0", text: "pondering" },
    ];
    const state: TurnState = {
      ...initialTurnState(),
      segments,
      status: "complete",
    };

    const message = assistantMessage("c1", "a1", "u1", state, null, {
      supported: true,
      mode: "quick",
    });

    expect(message.segments).toBe(segments);
    expect(message.stepRecord?.steps).toHaveLength(1);
    expect(message.stepRecord?.thinking).toEqual(["pondering"]);
    expect(message.runMarkdown).toBe("- Reading CDS\n\npondering");
  });

  test("message text remains answer-only while runMarkdown keeps the whole run", () => {
    const state: TurnState = {
      ...initialTurnState(),
      status: "complete",
      segments: [
        { type: "narration", id: "narration-0", text: "Checking aid data." },
        {
          type: "user",
          id: "steer-1",
          text: "Also compare cost.",
          injected: true,
        },
        { type: "answer", text: "Final answer only." },
      ],
    };

    const message = assistantMessage("c1", "a1", "u1", state, null, {
      supported: true,
      mode: "quick",
    });

    expect(message.text).toBe("Final answer only.");
    expect(message.runMarkdown).toBe(
      ["Checking aid data.", "> Also compare cost.", "Final answer only."].join(
        "\n\n",
      ),
    );
  });

  test("raw thinking segments render but do not enter the legacy step record", () => {
    const state: TurnState = {
      ...initialTurnState(),
      status: "complete",
      segments: [
        { type: "narration", id: "narration-0", text: "Checking aid data." },
        {
          type: "thinking",
          id: "thinking-0",
          text: "Native reasoning summary.",
        },
      ],
    };

    const message = assistantMessage("c1", "a1", "u1", state, null, {
      supported: true,
      mode: "quick",
    });

    expect(message.segments).toEqual(state.segments);
    expect(message.stepRecord?.thinking).toEqual(["Checking aid data."]);
  });

  test("legacy transcript thinking displays as narration until ordered segments land", () => {
    const messages = messagesFromTranscript("c1", [
      {
        role: "assistant",
        text: "Done.",
        ts: null,
        message_id: "a1",
        step_record: {
          receipt: "",
          thinking: ["Reading official costs."],
          steps: [],
        },
      },
    ]);

    expect(messages[0]).toMatchObject({
      kind: "assistant",
      segments: [
        {
          type: "narration",
          id: "narration-0",
          text: "Reading official costs.",
        },
        { type: "answer", text: "Done." },
      ],
    });
  });

  test("duration uses live arrival timing, not summed tool durations", () => {
    const state: TurnState = {
      ...initialTurnState(),
      startedAtMs: 1_000,
      completedAtMs: 2_500,
      status: "complete",
      segments: [
        {
          type: "tool",
          step: {
            step_id: "s1",
            label: "Slow backend detail",
            status: "end",
            kind: "db_tool",
            tier: null,
            detail: { duration_ms: 10_000 },
          },
        },
      ],
    };

    const message = assistantMessage("c1", "a1", "u1", state, null, {
      supported: true,
      mode: "quick",
    });

    expect(message.durationMs).toBe(1_500);
  });

  test("duration falls back to persisted step durations for historical transcript replay", () => {
    const messages = messagesFromTranscript("c1", [
      {
        role: "assistant",
        text: "Done.",
        ts: null,
        message_id: "a1",
        step_record: {
          receipt: "1 lookup",
          thinking: [],
          steps: [
            {
              step_id: "s1",
              label: "Reading",
              status: "end",
              kind: "db_tool",
              tier: null,
              detail: { duration_ms: 4200 },
            },
          ],
        },
      },
    ]);

    expect(messages[0]).toMatchObject({ kind: "assistant", durationMs: 4200 });
  });
});
