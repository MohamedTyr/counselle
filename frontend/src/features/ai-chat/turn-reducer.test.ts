import { describe, expect, test } from "vitest";

import type {
  ProtocolEvent,
  RenderSpec,
  StepData,
  TranscriptAssistantEntry,
} from "@/api/chat/types";

import {
  initialTurnState,
  proseOf,
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

function vizBlocks(
  state: TurnState,
): Array<Extract<ContentBlock, { kind: "viz" }>> {
  return state.blocks.filter(
    (block): block is Extract<ContentBlock, { kind: "viz" }> =>
      block.kind === "viz",
  );
}

describe("turn reducer", () => {
  test("live inline viz order preserves markdown viz markdown blocks", () => {
    const state = reduceEvents([
      { v: 1, type: "delta", data: { text: "Intro" } },
      { v: 1, type: "viz", data: renderSpec() },
      { v: 1, type: "delta", data: { text: "Outro" } },
    ]);

    expect(state.blocks.map((block) => block.kind)).toEqual([
      "markdown",
      "viz",
      "markdown",
    ]);
    expect(proseOf(state)).toBe("Intro\n\nOutro");
  });

  test("transcript inline viz order preserves markdown viz markdown blocks", () => {
    const state = reduceTranscriptEntry(
      assistantEntry([
        { type: "text", text: "Intro" },
        { type: "viz", spec: renderSpec() },
        { type: "text", text: "Outro" },
      ]),
    );

    expect(state.blocks.map((block) => block.kind)).toEqual([
      "markdown",
      "viz",
      "markdown",
    ]);
    expect(proseOf(state)).toBe("Intro\n\nOutro");
  });

  test("duplicate equivalent viz events append one block", () => {
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

  test("thinking entries get stable unique ids while interleaved with steps", () => {
    let state = initialTurnState();
    state = reduceTurn(state, { v: 1, type: "thinking", data: { text: "a" } });
    state = reduceTurn(state, stepEvent({ step_id: "s1", status: "start" }));
    state = reduceTurn(state, { v: 1, type: "thinking", data: { text: "b" } });
    state = reduceTurn(state, stepEvent({ step_id: "s1", status: "end" }));
    state = reduceTurn(state, { v: 1, type: "thinking", data: { text: "a" } });

    expect(
      state.timeline
        .filter((entry) => entry.type === "thinking")
        .map((entry) => ({ id: entry.id, text: entry.text })),
    ).toEqual([
      { id: "think-0", text: "a" },
      { id: "think-1", text: "b" },
      { id: "think-2", text: "a" },
    ]);
  });

  test("step end-event sources merge onto the started step", () => {
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

    expect(state.steps[0].status).toBe("end");
    expect(state.steps[0].sources).toEqual([
      {
        label: "usnews.com",
        favicon: "https://cdn/f",
        url: "https://usnews.com/x",
      },
    ]);
    expect(state.timeline.filter((entry) => entry.type === "step")).toHaveLength(1);
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
