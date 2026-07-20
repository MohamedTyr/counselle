import { parseSseStream } from "@/api/chat/sse";
import type { ProtocolEvent, TranscriptEntry } from "@/api/chat/types";
import { isTabularRenderSpec } from "@/api/chat/validation";
import { reduceTranscriptEntry } from "@/features/ai-chat/turn-reducer";
import {
  adaptLegacyCompletedTurn,
  adaptStoredTranscript,
  isLegacySourceEntry,
} from "@/api/chat/legacy-replay";
import legacyRaw from "../../../tests/fixtures/protocol/legacy_v1_completed_turn.json?raw";
import transcriptRaw from "../../../tests/fixtures/protocol/transcript.json?raw";
import turnCancelledRaw from "../../../tests/fixtures/protocol/turn_cancelled.json?raw";
import turnFullRaw from "../../../tests/fixtures/protocol/turn_full.json?raw";
import turnNoClarifyRaw from "../../../tests/fixtures/protocol/turn_no_clarify.json?raw";

function streamOf(events: ProtocolEvent[]) {
  const body = events
    .map(
      (event, index) =>
        `id: ${index}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("");

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

async function parseFixture(raw: string) {
  const payload = JSON.parse(raw) as { events: ProtocolEvent[] };
  const frames = [];
  for await (const frame of parseSseStream(streamOf(payload.events))) {
    frames.push(frame);
  }
  return frames.map((frame) => frame.data);
}

describe("shared protocol fixtures", () => {
  test("stored malformed known-v2 visualizations become safe opaque records", () => {
    const [entry] = adaptStoredTranscript([
      {
        role: "assistant",
        text: "Stored answer",
        ts: null,
        parts: [
          {
            type: "viz",
            spec: {
              v: 2,
              type: "comparison_table",
              title: "Unsafe table",
              columns: [],
              rows: [],
              secret: "drop me",
            },
          },
        ],
        status: "complete",
      },
    ]);
    if (entry?.role !== "assistant" || entry.parts?.[0]?.type !== "viz")
      throw new Error("stored fixture was not adapted");
    expect(entry.parts[0].spec).toEqual({
      v: 2,
      type: "comparison_table",
      title: "Unsafe table",
    });
    expect(isTabularRenderSpec(entry.parts[0].spec)).toBe(false);
  });

  it("replays the separate legacy v1 fixture without admitting it to live SSE", async () => {
    const fixture = JSON.parse(legacyRaw) as { turn_records: unknown[] };
    const legacy = adaptLegacyCompletedTurn(fixture.turn_records[0]);
    expect(legacy).not.toBeNull();
    expect(legacy?.text).toBe("The legacy display was 7% [1].");
    expect(legacy?.sources?.[0] && isLegacySourceEntry(legacy.sources[0])).toBe(
      true,
    );
    expect(legacy?.sources?.[0]?.citation.source).toBe("ipeds");

    const legacyEvent = frameFromLegacySource(fixture.turn_records[0]);
    await expect(
      parseFixture(JSON.stringify({ events: [legacyEvent] })),
    ).rejects.toThrow("malformed sources");

    const current = JSON.parse(turnFullRaw) as { events: ProtocolEvent[] };
    await expect(parseFixture(turnFullRaw)).resolves.toHaveLength(
      current.events.length,
    );
    expect(reduceTranscriptEntry(legacy!).sources[0]?.citation.source).toBe(
      "ipeds",
    );
  });

  it("replays the backend transcript form of the persisted v1 fixture", () => {
    const fixture = JSON.parse(legacyRaw) as {
      turn_records: Array<Record<string, unknown>>;
    };
    const turn = fixture.turn_records[0]!;
    const [source] = turn.sources as Array<Record<string, unknown>>;
    const [entry] = adaptStoredTranscript([
      {
        role: "assistant",
        text: "The legacy display was 7% [1].",
        ts: null,
        message_id: turn.message_id,
        parts: turn.parts,
        segments: [{ kind: "delta", text: "The legacy display was 7% [1]." }],
        status: "complete",
        sources: [
          {
            ...source,
            v: 1,
            citation: { ...(source?.citation as object), v: 1 },
          },
        ],
      },
    ]);

    expect(entry?.role).toBe("assistant");
    if (entry?.role !== "assistant")
      throw new Error("legacy fixture did not replay");
    expect(entry.text).toBe("The legacy display was 7% [1].");
    expect(entry.sources?.[0] && isLegacySourceEntry(entry.sources[0])).toBe(
      true,
    );
    expect(reduceTranscriptEntry(entry).sources[0]?.citation.source).toBe(
      "ipeds",
    );
  });

  it("accepts backend event fixtures with the live SSE parser", async () => {
    await expect(parseFixture(turnFullRaw)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "done" })]),
    );
    await expect(parseFixture(turnCancelledRaw)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "done",
          data: { status: "cancelled" },
        }),
      ]),
    );
  });

  it("pins the current golden to the v1 event/v2 evidence contract", () => {
    const payload = JSON.parse(turnFullRaw) as { events: ProtocolEvent[] };
    expect(payload.events.every((event) => event.v === 1)).toBe(true);

    const viz = payload.events.find(
      (event): event is Extract<ProtocolEvent, { type: "viz" }> =>
        event.type === "viz",
    );
    expect(viz?.data).toMatchObject({
      v: 2,
      type: "comparison_table",
      columns: [
        { unitid: expect.any(Number), name: expect.any(String) },
        { unitid: null, name: expect.any(String) },
      ],
    });
    if (!viz || !isTabularRenderSpec(viz.data))
      throw new Error("current fixture lacks a tabular viz");
    const cells = viz.data.rows.flatMap((row) => row.cells);
    expect(cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          v: 2,
          available: true,
          citation: expect.objectContaining({
            source: "cds",
            document_sha256: expect.any(String),
          }),
          evidence: expect.objectContaining({
            eid: expect.any(String),
            page: expect.any(Number),
          }),
          caveats: expect.arrayContaining([
            expect.objectContaining({
              kind: expect.any(String),
              text: expect.any(String),
            }),
          ]),
        }),
        expect.objectContaining({
          available: true,
          citation: expect.objectContaining({ source: "web" }),
        }),
        expect.objectContaining({
          available: false,
          citation: null,
          evidence: null,
          marker: null,
        }),
      ]),
    );

    const sources = payload.events.find(
      (event): event is Extract<ProtocolEvent, { type: "sources" }> =>
        event.type === "sources",
    );
    expect(sources?.data.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          v: 2,
          citation: expect.objectContaining({ source: "cds" }),
          evidence: expect.arrayContaining([
            expect.objectContaining({ eid: expect.any(String) }),
          ]),
        }),
        expect.objectContaining({
          citation: expect.objectContaining({ source: "web" }),
          evidence: [],
        }),
      ]),
    );

    const webStep = payload.events.find(
      (event): event is Extract<ProtocolEvent, { type: "step" }> =>
        event.type === "step" &&
        event.data.kind === "web_search" &&
        event.data.status === "end",
    );
    expect(webStep?.data.detail).toHaveProperty("domains");
    expect(webStep?.data.detail).not.toHaveProperty("field_keys");
    const dbStep = payload.events.find(
      (event): event is Extract<ProtocolEvent, { type: "step" }> =>
        event.type === "step" &&
        event.data.kind === "db_tool" &&
        event.data.status === "end",
    );
    expect(dbStep?.data.detail).toMatchObject({
      tool: "get_domain",
      domain_id: "admissions",
    });
    expect(dbStep?.data.detail).not.toHaveProperty("field_keys");
  });

  it("pins the Agent V1 no-clarify event fixture", async () => {
    const events = await parseFixture(turnNoClarifyRaw);

    expect(events.map((event) => event.type)).not.toContain("clarify");
    expect(events.at(-1)).toEqual({
      v: 1,
      type: "done",
      data: { status: "complete" },
    });
  });

  it("pins the no-clarify transcript fixture shape", () => {
    const payload = JSON.parse(transcriptRaw) as {
      transcript: TranscriptEntry[];
    };
    const assistants = payload.transcript.filter(
      (entry) => entry.role === "assistant",
    );

    expect(assistants).toHaveLength(3);
    expect(assistants[1]).not.toHaveProperty("clarify");
    expect(
      payload.transcript.some(
        (entry) => entry.role === "user" && entry.synthesized === true,
      ),
    ).toBe(false);
  });

  it("replays fixture transcript narration distinctly from native thinking", () => {
    const turnFull = JSON.parse(turnFullRaw) as { events: ProtocolEvent[] };
    const transcript = JSON.parse(transcriptRaw) as {
      transcript: TranscriptEntry[];
    };
    const liveNarration = turnFull.events.find(
      (event): event is Extract<ProtocolEvent, { type: "narration" }> =>
        event.type === "narration",
    );
    const assistant = transcript.transcript.find(
      (entry) =>
        entry.role === "assistant" &&
        entry.step_record?.narration?.includes(liveNarration?.data.text ?? ""),
    );

    expect(liveNarration?.data.text).toBe(
      "Let me look at Duke's housing first.",
    );
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role !== "assistant") {
      throw new Error("fixture transcript is missing replayable narration");
    }

    const state = reduceTranscriptEntry(assistant);
    expect(
      state.segments.some(
        (segment) =>
          segment.type === "narration" &&
          segment.text === liveNarration?.data.text,
      ),
    ).toBe(true);
  });

  it("preserves ordered segments from the shared transcript fixture", () => {
    const transcript = JSON.parse(transcriptRaw) as {
      transcript: TranscriptEntry[];
    };
    const assistant = transcript.transcript.find(
      (entry) =>
        entry.role === "assistant" &&
        entry.segments?.some((segment) => segment.kind === "viz"),
    );

    expect(assistant?.role).toBe("assistant");
    if (assistant?.role !== "assistant") {
      throw new Error(
        "fixture transcript is missing ordered assistant segments",
      );
    }

    expect(assistant.segments?.map((segment) => segment.kind)).toEqual([
      "step",
      "narration",
      "step",
      "delta",
      "viz",
      "delta",
    ]);

    const state = reduceTranscriptEntry(assistant);
    expect(state.segments.map((segment) => segment.type)).toEqual([
      "tool",
      "narration",
      "tool",
      "answer",
      "viz",
      "answer",
    ]);
  });
});

function frameFromLegacySource(value: unknown): ProtocolEvent {
  const turn = value as { sources: unknown[] };
  return {
    v: 1,
    type: "sources",
    data: { sources: turn.sources },
  } as ProtocolEvent;
}
