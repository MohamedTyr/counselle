import { describe, expect, test } from "vitest";

import type {
  ProtocolEvent,
  RenderSpec,
  StepData,
  TranscriptAssistantEntry,
} from "@/api/chat/types";
import { isTabularRenderSpec } from "@/api/chat/validation";

import {
  answerBlocksOf,
  initialTurnState,
  proseOf,
  reduceLiveTurn,
  reduceTranscriptEntry,
  reduceTurn,
  runMarkdownOf,
  transcriptEntryToEvents,
  type ContentBlock,
  type TurnState,
} from "./turn-reducer";
import { messagesFromTranscript } from "./model";

function renderSpec(overrides: Partial<RenderSpec> = {}): RenderSpec {
  return {
    v: 2,
    type: "comparison_table",
    title: "Admission rates",
    columns: [
      { unitid: 100, name: "North College", domain: "north.edu" },
      { unitid: 200, name: "South University", domain: "south.edu" },
    ],
    rows: [
      {
        label: "Acceptance rate",
        cells: [
          {
            v: 2,
            field: "admissions.acceptance_rate",
            label: "Acceptance rate",
            display: "12%",
            raw: 0.12,
            available: true,
            unit: "percent",
            citation: {
              v: 2,
              source: "cds",
              tier: "official",
              vintage: "CDS 2024-25",
              url: null,
              document_sha256: "a".repeat(64),
              source_kind: "upload",
              retrieved_at: "2026-07-15T00:00:00Z",
              academic_year: 2024,
              manifest_version: "5.0.1",
              school_unitid: 100,
            },
            evidence: {
              eid: "admissions.acceptance_rate",
              value_display: "12%",
              label: "Acceptance rate",
              page: 7,
              excerpt: "Rate 12%",
            },
            caveats: [],
            marker: "[1]",
          },
          {
            v: 2,
            field: "admissions.acceptance_rate",
            label: "Acceptance rate",
            display: "42%",
            raw: 0.42,
            available: true,
            unit: "percent",
            citation: {
              v: 2,
              source: "edu",
              tier: "official",
              vintage: "Retrieved 2026",
              url: "https://south.edu/rate",
            },
            evidence: null,
            caveats: [
              { kind: "edition_mismatch_comparison", text: "Editions differ." },
            ],
            marker: "[2]",
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
): Extract<ProtocolEvent, { type: "step" }> {
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
  return answerBlocksOf(state).filter(
    (block): block is Extract<ContentBlock, { kind: "viz" }> =>
      block.kind === "viz",
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

  test("resolved provenance differences never dedupe", () => {
    const first = renderSpec();
    const baseline = renderSpec();
    if (!isTabularRenderSpec(baseline))
      throw new Error("expected tabular fixture");
    const firstCell = baseline.rows[0].cells[0];
    const changed: RenderSpec = {
      ...baseline,
      rows: [
        {
          ...baseline.rows[0],
          cells: [
            {
              ...firstCell,
              citation:
                firstCell.citation === null || firstCell.citation === undefined
                  ? firstCell.citation
                  : { ...firstCell.citation, document_sha256: "b".repeat(64) },
            },
            ...baseline.rows[0].cells.slice(1),
          ],
        },
        ...baseline.rows.slice(1),
      ],
    };

    const state = reduceEvents([
      { v: 1, type: "viz", data: first },
      { v: 1, type: "viz", data: changed },
    ]);
    expect(vizBlocks(state)).toHaveLength(2);
  });

  test("opaque payloads survive replay and export only a safe placeholder", () => {
    const spec: RenderSpec = {
      v: 2,
      type: "community_card",
      title: "Student voices",
      secret_payload: "must not export",
    };
    const state = reduceTranscriptEntry(
      assistantEntry([{ type: "viz", spec }]),
    );
    expect(vizBlocks(state)[0].spec).toEqual(spec);
    expect(runMarkdownOf(state)).toContain("### Student voices");
    expect(runMarkdownOf(state)).toContain("requires a newer client");
    expect(runMarkdownOf(state)).not.toContain("must not export");
  });

  test.each([
    [
      "array-only shell",
      (spec: Record<string, unknown>) => ({ ...spec, columns: [], rows: [] }),
    ],
    [
      "bad cell",
      (spec: Record<string, unknown>) => ({
        ...spec,
        rows: [{ label: "Rate", cells: ["12%"] }],
      }),
    ],
    [
      "wrong row width",
      (spec: Record<string, unknown>) => ({
        ...spec,
        rows: [{ label: "Rate", cells: [] }],
      }),
    ],
    [
      "bad citation",
      (spec: Record<string, unknown>) => {
        const rows = structuredClone(spec.rows) as Array<{
          cells: Array<Record<string, unknown>>;
        }>;
        rows[0].cells[0].citation = { source: "cds" };
        return { ...spec, rows };
      },
    ],
    [
      "bad evidence",
      (spec: Record<string, unknown>) => {
        const rows = structuredClone(spec.rows) as Array<{
          cells: Array<Record<string, unknown>>;
        }>;
        rows[0].cells[0].evidence = { eid: "wrong" };
        return { ...spec, rows };
      },
    ],
    [
      "extra keys",
      (spec: Record<string, unknown>) => ({ ...spec, unexpected: true }),
    ],
  ])("rejects malformed current-v2 %s", (_label, mutate) => {
    const malformed = mutate(
      structuredClone(renderSpec()) as unknown as Record<string, unknown>,
    );
    expect(isTabularRenderSpec(malformed)).toBe(false);
    const state = reduceTranscriptEntry(
      assistantEntry([{ type: "viz", spec: malformed as RenderSpec }]),
    );
    expect(runMarkdownOf(state)).toContain("requires a newer client");
  });

  test("legacy evidence-less transcript sources remain replayable", () => {
    const legacy = {
      role: "assistant",
      text: "Legacy answer [1].",
      ts: null,
      sources: [
        {
          index: 1,
          label: "IPEDS 2024 admissions",
          citation: {
            source: "ipeds",
            tier: "official",
            vintage: "IPEDS 2024",
            caveat: "provisional",
          },
        },
      ],
      status: "complete",
    } as unknown as TranscriptAssistantEntry;
    const state = reduceTranscriptEntry(legacy);
    expect(state.status).toBe("complete");
    expect(state.sources[0]).toMatchObject({
      index: 1,
      citation: { source: "ipeds" },
    });
  });

  test("attach replay with overlapping live and persisted viz frames keeps one card", () => {
    const liveSpec = renderSpec({ title: "Live card title" });
    const replaySpec = renderSpec({
      title: "Replay card title",
      columns: [
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
      {
        v: 1,
        type: "narration",
        data: { text: "Checking the official site." },
      },
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

  test("consecutive thinking events coalesce into one episode", () => {
    const state = reduceEvents([
      { v: 1, type: "thinking", data: { text: "First thought." } },
      { v: 1, type: "thinking", data: { text: "Second thought." } },
      { v: 1, type: "narration", data: { text: "Checking the database." } },
      { v: 1, type: "thinking", data: { text: "Third thought." } },
    ]);

    expect(state.segments).toEqual([
      {
        type: "thinking",
        id: "thinking-0",
        text: "First thought.\n\nSecond thought.",
      },
      {
        type: "narration",
        id: "narration-0",
        text: "Checking the database.",
      },
      {
        type: "thinking",
        id: "thinking-1",
        text: "Third thought.",
      },
    ]);
  });

  test("step updates break thinking coalescing even when merged in place", () => {
    const state = reduceEvents([
      stepEvent({ step_id: "s1", status: "start", label: "Searching" }),
      { v: 1, type: "thinking", data: { text: "First thought." } },
      stepEvent({
        step_id: "s1",
        status: "end",
        label: "Searched",
        detail: { result_count: 2 },
      }),
      { v: 1, type: "thinking", data: { text: "Second thought." } },
    ]);

    expect(state.segments).toEqual([
      {
        type: "tool",
        step: {
          kind: "web_search",
          label: "Searched",
          tier: null,
          detail: { result_count: 2 },
          step_id: "s1",
          status: "end",
        },
      },
      { type: "thinking", id: "thinking-0", text: "First thought." },
      { type: "thinking", id: "thinking-1", text: "Second thought." },
    ]);
  });

  test("user_message updates break thinking coalescing even when merged in place", () => {
    const state = reduceEvents([
      {
        v: 1,
        type: "user_message",
        data: {
          text: "Also compare cost.",
          user_message_id: "steer-1",
          injected: false,
        },
      },
      { v: 1, type: "thinking", data: { text: "First thought." } },
      {
        v: 1,
        type: "user_message",
        data: {
          text: "Also compare cost.",
          user_message_id: "steer-1",
          injected: true,
        },
      },
      { v: 1, type: "thinking", data: { text: "Second thought." } },
    ]);

    expect(state.segments).toEqual([
      {
        type: "user",
        id: "steer-1",
        text: "Also compare cost.",
        injected: true,
      },
      { type: "thinking", id: "thinking-0", text: "First thought." },
      { type: "thinking", id: "thinking-1", text: "Second thought." },
    ]);
  });

  test("user_message upserts by id and upgrades injected false to true", () => {
    let state = initialTurnState();
    state = reduceTurn(state, {
      v: 1,
      type: "user_message",
      data: {
        text: "Also compare cost.",
        user_message_id: "steer-1",
        injected: false,
      },
    });
    state = reduceTurn(state, {
      v: 1,
      type: "user_message",
      data: {
        text: "Also compare cost.",
        user_message_id: "steer-1",
        injected: true,
      },
    });

    expect(state.segments).toEqual([
      {
        type: "user",
        id: "steer-1",
        text: "Also compare cost.",
        injected: true,
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

  test("ordered transcript user segments replay as inline user_message events", () => {
    const state = reduceTranscriptEntry({
      role: "assistant",
      text: "",
      ts: null,
      segments: [
        { kind: "narration", text: "Checking." },
        {
          kind: "user",
          text: "Also compare cost.",
          user_message_id: "steer-1",
          injected: true,
        },
        { kind: "delta", text: "Done." },
      ],
      status: "complete",
    });

    expect(state.segments).toEqual([
      { type: "narration", id: "narration-0", text: "Checking." },
      {
        type: "user",
        id: "steer-1",
        text: "Also compare cost.",
        injected: true,
      },
      { type: "answer", text: "Done." },
    ]);
  });

  test("ordered transcript segments replay the same beat sequence as the live reducer", () => {
    const tool = stepEvent({
      step_id: "search-1",
      status: "end",
      kind: "web_search",
      label: "Searching web",
      detail: { query: "MIT Pitzer prestige student life", result_count: 3 },
    }).data;
    const viz = renderSpec({ title: "Selectivity comparison" });
    const liveEvents: ProtocolEvent[] = [
      { v: 1, type: "thinking", data: { text: "Separate prestige from fit." } },
      {
        v: 1,
        type: "narration",
        data: { text: "I'll compare reputation and student life." },
      },
      { v: 1, type: "step", data: tool },
      {
        v: 1,
        type: "delta",
        data: { text: "MIT has the stronger global brand." },
      },
      { v: 1, type: "viz", data: viz },
      {
        v: 1,
        type: "user_message",
        data: {
          text: "Also mention campus vibe.",
          user_message_id: "steer-1",
          injected: true,
        },
      },
      {
        v: 1,
        type: "delta",
        data: { text: " Pitzer has the tighter LAC community." },
      },
      {
        v: 1,
        type: "sources",
        data: {
          sources: [
            {
              v: 2,
              index: 1,
              citation: {
                v: 2,
                source: "web",
                tier: "official",
                vintage: "2026",
                url: "https://example.com",
              },
              label: "Example",
              evidence: [],
              evidence_omitted_count: 0,
            },
          ],
        },
      },
      { v: 1, type: "done", data: { status: "complete" } },
    ];
    const liveState = reduceEvents(liveEvents);
    const reloaded = messagesFromTranscript("c1", [
      {
        role: "assistant",
        text: "",
        ts: null,
        message_id: "a1",
        segments: [
          { kind: "thinking", text: "Separate prestige from fit." },
          {
            kind: "narration",
            text: "I'll compare reputation and student life.",
          },
          { kind: "step", data: tool },
          { kind: "delta", text: "MIT has the stronger global brand." },
          { kind: "viz", spec: viz },
          {
            kind: "user",
            text: "Also mention campus vibe.",
            user_message_id: "steer-1",
            injected: true,
          },
          { kind: "delta", text: " Pitzer has the tighter LAC community." },
        ],
        sources: liveState.sources,
        status: "complete",
      },
    ]);

    expect(reloaded[0]).toMatchObject({ kind: "assistant" });
    if (reloaded[0].kind !== "assistant") {
      throw new Error("Expected an assistant message");
    }
    expect(reloaded[0].segments).toEqual(liveState.segments);
    expect(reloaded[0].blocks).toEqual(answerBlocksOf(liveState));
    expect(reloaded[0].text).toBe(proseOf(liveState));
    expect(reloaded[0].runMarkdown).toBe(runMarkdownOf(liveState));
    expect(reloaded[0].sources).toEqual(liveState.sources);
  });

  test("sources and done settle the turn without reordering existing beats", () => {
    const beforeCompletion = reduceEvents([
      {
        v: 1,
        type: "thinking",
        data: { text: "Check ranking and fit separately." },
      },
      {
        v: 1,
        type: "narration",
        data: { text: "I'll check the current evidence." },
      },
      stepEvent({
        step_id: "search-1",
        status: "end",
        kind: "web_search",
        label: "Searching web",
        detail: { query: "MIT Pitzer prestige", result_count: 2 },
      }),
      { v: 1, type: "delta", data: { text: "MIT wins on prestige." } },
    ]);

    const withSources = reduceTurn(beforeCompletion, {
      v: 1,
      type: "sources",
      data: {
        sources: [
          {
            v: 2,
            index: 1,
            citation: {
              v: 2,
              source: "web",
              tier: "official",
              vintage: "2026",
              url: "https://example.com",
            },
            label: "Example",
            evidence: [],
            evidence_omitted_count: 0,
          },
        ],
      },
    });
    const settled = reduceTurn(withSources, {
      v: 1,
      type: "done",
      data: { status: "complete" },
    });

    expect(withSources.segments).toBe(beforeCompletion.segments);
    expect(settled.segments).toBe(beforeCompletion.segments);
    expect(settled.segments).toEqual([
      {
        type: "thinking",
        id: "thinking-0",
        text: "Check ranking and fit separately.",
      },
      {
        type: "narration",
        id: "narration-0",
        text: "I'll check the current evidence.",
      },
      {
        type: "tool",
        step: {
          step_id: "search-1",
          status: "end",
          kind: "web_search",
          label: "Searching web",
          tier: null,
          detail: { query: "MIT Pitzer prestige", result_count: 2 },
        },
      },
      { type: "answer", text: "MIT wins on prestige." },
    ]);
    expect(settled.sources).toHaveLength(1);
    expect(settled.status).toBe("complete");
  });

  test("runMarkdownOf serializes the visible run in chronological order", () => {
    const state = reduceEvents([
      { v: 1, type: "narration", data: { text: "Checking official data." } },
      { v: 1, type: "thinking", data: { text: "Hidden native thought." } },
      stepEvent({
        step_id: "search-1",
        status: "end",
        kind: "web_search",
        label: "Searching web",
        detail: {
          query: "Duke financial aid",
          result_count: 2,
        },
      }),
      {
        v: 1,
        type: "user_message",
        data: {
          text: "Also compare cost.",
          user_message_id: "steer-1",
          injected: true,
        },
      },
      { v: 1, type: "delta", data: { text: "Here is the answer." } },
      { v: 1, type: "viz", data: renderSpec({ title: "Cost comparison" }) },
    ]);

    expect(runMarkdownOf(state)).toBe(
      [
        "Checking official data.",
        '- Searching web: "Duke financial aid" · 2 results',
        "> Also compare cost.",
        "Here is the answer.",
        [
          "### Cost comparison",
          "",
          "| Metric | North College | South University |",
          "| --- | --- | --- |",
          "| Acceptance rate | 12% (CDS 2024-25, cds) | 42% (Retrieved 2026, edu) |",
        ].join("\n"),
      ].join("\n\n"),
    );
    expect(runMarkdownOf(state)).not.toContain("Hidden native thought");
  });

  test("runMarkdownOf handles receipt-free tools and multiline user beats", () => {
    const state = reduceEvents([
      stepEvent({
        step_id: "search-1",
        status: "start",
        label: "Searching",
      }),
      {
        v: 1,
        type: "user_message",
        data: {
          text: "First line\nSecond line",
          user_message_id: "steer-1",
          injected: true,
        },
      },
    ]);

    expect(runMarkdownOf(state.segments)).toBe(
      ["- Searching", "> First line\n> Second line"].join("\n\n"),
    );
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

    const toolSegments = state.segments.filter(
      (segment) => segment.type === "tool",
    );
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
    state = reduceTurn(
      state,
      stepEvent({ step_id: "task-1", status: "start" }),
    );
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

    const toolSegments = state.segments.filter(
      (segment) => segment.type === "tool",
    );
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
    state = reduceLiveTurn(
      state,
      { v: 1, type: "done", data: { status: "complete" } },
      2_500,
    );

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
          v: 2,
          index: 1,
          label: "Source",
          citation: {
            v: 2,
            source: "web",
            tier: "community",
            vintage: "Fetched today",
            url: "https://example.com",
          },
          evidence: [],
          evidence_omitted_count: 0,
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
