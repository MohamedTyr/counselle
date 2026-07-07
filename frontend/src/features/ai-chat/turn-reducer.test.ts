import { describe, expect, test } from "vitest";

import type {
  ProtocolEvent,
  RenderSpec,
  StepData,
  TranscriptAssistantEntry,
} from "@/api/chat/types";

import {
  answerBlocksOf,
  initialTurnState,
  proseOf,
  reduceLiveTurn,
  reduceTranscriptEntry,
  reduceTurn,
  transcriptEntryToEvents,
  type ContentBlock,
  type TurnState,
} from "./turn-reducer";

function renderSpec(overrides: Partial<RenderSpec> = {}): RenderSpec {
  return {
    v: 1,
    type: "comparison_table",
    title: "Admission rates",
    schools: [
      { unitid: 100, name: "North College", domain: "north.edu" },
      { unitid: 200, name: "South University", domain: "south.edu" },
    ],
    rows: [
      {
        label: "Acceptance rate",
        cells: [
          {
            v: 1,
            field: "admissions.acceptance_rate",
            label: "Acceptance rate",
            display: "12%",
            raw: 0.12,
            available: true,
            unit: "percent",
            citation: {
              source: "cds",
              tier: "official",
              vintage: "CDS 2024-25",
              caveat: null,
              raw_table: "B",
              url: null,
            },
          },
          {
            v: 1,
            field: "admissions.acceptance_rate",
            label: "Acceptance rate",
            display: "42%",
            raw: 0.42,
            available: true,
            unit: "percent",
            citation: {
              source: "ipeds",
              tier: "official",
              vintage: "IPEDS 2024-25",
              caveat: "provisional",
              raw_table: null,
              url: null,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function reduceEvents(events: ProtocolEvent[]): TurnState {
  return events.reduce(reduceTurn, initialTurnState());
}

function stepEvent(
  step: Partial<StepData> & Pick<StepData, "step_id" | "status">,
): ProtocolEvent {
  return {
    v: 1,
    type: "step",
    data: {
      kind: "web_search",
      label: "Searching",
      tier: null,
      detail: null,
      ...step,
    },
  };
}

function assistantEntry(
  parts: TranscriptAssistantEntry["parts"],
): TranscriptAssistantEntry {
  return {
    role: "assistant",
    text: "",
    ts: null,
    parts,
    status: "complete",
  };
}

function vizBlocks(state: TurnState): Array<Extract<ContentBlock, { kind: "viz" }>> {
  return answerBlocksOf(state).filter(
    (block): block is Extract<ContentBlock, { kind: "viz" }> => block.kind === "viz",
  );
}

describe("turn reducer", () => {
  test("live inline viz order preserves answer/viz/answer segment order", () => {
    const state = reduceEvents([
      { v: 1, type: "delta", data: { text: "Intro" } },
      { v: 1, type: "viz", data: renderSpec() },
      { v: 1, type: "delta", data: { text: "Outro" } },
    ]);

    expect(state.segments.map((segment) => segment.type)).toEqual([
      "answer",
      "viz",
      "answer",
    ]);
    expect(proseOf(state)).toBe("Intro\n\nOutro");
  });

  test("transcript inline viz order preserves answer/viz/answer segment order", () => {
    const state = reduceTranscriptEntry(
      assistantEntry([
        { type: "text", text: "Intro" },
        { type: "viz", spec: renderSpec() },
        { type: "text", text: "Outro" },
      ]),
    );

    expect(state.segments.map((segment) => segment.type)).toEqual([
      "answer",
      "viz",
      "answer",
    ]);
    expect(proseOf(state)).toBe("Intro\n\nOutro");
  });

  test("duplicate equivalent viz events append one segment", () => {
    const first = renderSpec({ title: "Admissions snapshot" });
    const duplicate = renderSpec({ title: "Different heading" });

    const state = reduceEvents([
      { v: 1, type: "viz", data: first },
      { v: 1, type: "viz", data: duplicate },
    ]);

    expect(vizBlocks(state)).toHaveLength(1);
    expect(vizBlocks(state)[0].spec.title).toBe("Admissions snapshot");
  });

  test("attach replay with overlapping live and persisted viz frames keeps one card", () => {
    const liveSpec = renderSpec({ title: "Live card title" });
    const replaySpec = renderSpec({
      title: "Replay card title",
      schools: [
        { unitid: 100, name: "North College", domain: "northcollege.edu" },
        { unitid: 200, name: "South University", domain: null },
      ],
    });
    const liveState = reduceEvents([
      { v: 1, type: "delta", data: { text: "Live intro." } },
      { v: 1, type: "viz", data: liveSpec },
    ]);
    const replayEvents = transcriptEntryToEvents(
      assistantEntry([
        { type: "text", text: "Replayed intro." },
        { type: "viz", spec: replaySpec },
        { type: "text", text: "Replayed closing." },
      ]),
    );

    const attachedState = replayEvents.reduce(reduceTurn, liveState);

    expect(vizBlocks(attachedState)).toHaveLength(1);
    expect(vizBlocks(attachedState)[0].spec.title).toBe("Live card title");
  });

  test("narration entries get stable unique ids while interleaved with tool segments", () => {
    let state = initialTurnState();
    state = reduceTurn(state, { v: 1, type: "narration", data: { text: "a" } });
    state = reduceTurn(state, stepEvent({ step_id: "s1", status: "start" }));
    state = reduceTurn(state, { v: 1, type: "narration", data: { text: "b" } });
    state = reduceTurn(state, stepEvent({ step_id: "s1", status: "end" }));
    state = reduceTurn(state, { v: 1, type: "narration", data: { text: "a" } });

    expect(
      state.segments
        .filter((segment) => segment.type === "narration")
        .map((segment) => ({ id: segment.id, text: segment.text })),
    ).toEqual([
      { id: "narration-0", text: "a" },
      { id: "narration-1", text: "b" },
      { id: "narration-2", text: "a" },
    ]);
  });

  test("thinking entries stay distinct from visible narration", () => {
    const state = reduceEvents([
      { v: 1, type: "narration", data: { text: "Checking the official site." } },
      { v: 1, type: "thinking", data: { text: "Native thought summary." } },
    ]);

    expect(state.segments).toEqual([
      {
        type: "narration",
        id: "narration-0",
        text: "Checking the official site.",
      },
      {
        type: "thinking",
        id: "thinking-0",
        text: "Native thought summary.",
      },
    ]);
  });

  test("legacy transcript step_record thinking replays as visible narration", () => {
    const events = transcriptEntryToEvents({
      role: "assistant",
      text: "Done.",
      ts: null,
      step_record: {
        steps: [],
        thinking: ["Checking the CDS.", "Comparing the aid figures."],
        receipt: "",
      },
    });

    expect(events.slice(0, 2)).toEqual([
      { v: 1, type: "narration", data: { text: "Checking the CDS." } },
      {
        v: 1,
        type: "narration",
        data: { text: "Comparing the aid figures." },
      },
    ]);

    const state = events.reduce(reduceTurn, initialTurnState());
    expect(
      state.segments
        .filter((segment) => segment.type === "narration")
        .map((segment) => segment.text),
    ).toEqual(["Checking the CDS.", "Comparing the aid figures."]);
  });

  test("transcript narration replays separately from native thinking", () => {
    const events = transcriptEntryToEvents({
      role: "assistant",
      text: "Done.",
      ts: null,
      step_record: {
        steps: [],
        narration: ["Checking the CDS."],
        thinking: ["Native thought summary."],
        receipt: "",
      },
    });

    expect(events.slice(0, 2)).toEqual([
      { v: 1, type: "narration", data: { text: "Checking the CDS." } },
      { v: 1, type: "thinking", data: { text: "Native thought summary." } },
    ]);

    const state = events.reduce(reduceTurn, initialTurnState());
    expect(state.segments.slice(0, 2)).toEqual([
      { type: "narration", id: "narration-0", text: "Checking the CDS." },
      { type: "thinking", id: "thinking-0", text: "Native thought summary." },
    ]);
  });

  test("ordered transcript segments take precedence over legacy fields and map delta", () => {
    const events = transcriptEntryToEvents({
      role: "assistant",
      text: "Legacy text.",
      ts: null,
      segments: [
        { kind: "narration", text: "Ordered narration." },
        { kind: "delta", text: "Ordered answer." },
      ],
      step_record: {
        steps: [stepEvent({ step_id: "legacy-step", status: "end" }).data],
        narration: ["Legacy narration."],
        thinking: ["Legacy thinking."],
        receipt: "",
      },
      parts: [{ type: "text", text: "Legacy part." }],
      status: "complete",
    });

    expect(events).toEqual([
      { v: 1, type: "narration", data: { text: "Ordered narration." } },
      { v: 1, type: "delta", data: { text: "Ordered answer." } },
      { v: 1, type: "done", data: { status: "complete" } },
    ]);

    const state = events.reduce(reduceTurn, initialTurnState());
    expect(state.segments).toEqual([
      {
        type: "narration",
        id: "narration-0",
        text: "Ordered narration.",
      },
      { type: "answer", text: "Ordered answer." },
    ]);
  });

  test("step end-event sources merge onto the started step in place", () => {
    let state = initialTurnState();
    state = reduceTurn(state, stepEvent({ step_id: "s1", status: "start" }));
    state = reduceTurn(
      state,
      stepEvent({
        step_id: "s1",
        status: "end",
        sources: [
          {
            label: "usnews.com",
            favicon: "https://cdn/f",
            url: "https://usnews.com/x",
          },
        ],
      }),
    );

    const toolSegments = state.segments.filter((segment) => segment.type === "tool");
    expect(toolSegments).toHaveLength(1);
    expect(toolSegments[0].step.status).toBe("end");
    expect(toolSegments[0].step.sources).toEqual([
      {
        label: "usnews.com",
        favicon: "https://cdn/f",
        url: "https://usnews.com/x",
      },
    ]);
  });

  test("step end-event ui payload merges onto the started tool segment", () => {
    let state = initialTurnState();
    state = reduceTurn(state, stepEvent({ step_id: "task-1", status: "start" }));
    state = reduceTurn(
      state,
      stepEvent({
        step_id: "task-1",
        status: "end",
        kind: "skill",
        label: "Adding a task",
        ui: {
          widget: "task_added",
          data: {
            title: "Submit Duke financial aid forms",
            school: "Duke University",
          },
        },
      }),
    );

    const toolSegments = state.segments.filter((segment) => segment.type === "tool");
    expect(toolSegments).toHaveLength(1);
    expect(toolSegments[0].step).toMatchObject({
      step_id: "task-1",
      status: "end",
      ui: {
        widget: "task_added",
        data: {
          title: "Submit Duke financial aid forms",
          school: "Duke University",
        },
      },
    });
  });

  test("live reducer records arrival wall-clock duration", () => {
    let state = initialTurnState();
    state = reduceLiveTurn(
      state,
      stepEvent({
        step_id: "s1",
        status: "start",
        detail: { duration_ms: 10_000 },
      }),
      1_000,
    );
    state = reduceLiveTurn(state, { v: 1, type: "done", data: { status: "complete" } }, 2_500);

    expect(state.startedAtMs).toBe(1_000);
    expect(state.completedAtMs).toBe(2_500);
  });

  test("unknown additive protocol events are ignored", () => {
    const state = reduceEvents([
      { v: 1, type: "delta", data: { text: "Hello" } },
    ]);
    const unknownEvent = {
      v: 1,
      type: "future_event",
      data: { value: true },
    } as unknown as ProtocolEvent;

    expect(reduceTurn(state, unknownEvent)).toBe(state);
  });

  test("transcript replay maps status, sources, usage, and clarify through reducer", () => {
    const state = reduceTranscriptEntry({
      role: "assistant",
      text: "Which one?",
      ts: null,
      message_id: "a1",
      clarify: {
        spec: {
          v: 1,
          question: "Which one?",
          header: "Choose",
          multi_select: false,
          options: [{ label: "A", hint: "First" }],
        },
        answer: null,
      },
      sources: [
        {
          index: 1,
          label: "Source",
          citation: {
            source: "web",
            tier: "community",
            vintage: "Fetched today",
            url: "https://example.com",
          },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 2, tool_calls: 3 },
      status: "awaiting_input",
    });

    expect(state.status).toBe("awaiting_input");
    expect(state.clarify?.question).toBe("Which one?");
    expect(state.sources).toHaveLength(1);
    expect(state.usage?.tool_calls).toBe(3);
  });
});
