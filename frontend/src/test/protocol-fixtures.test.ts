import { parseSseStream } from "@/api/chat/sse";
import type { ProtocolEvent, TranscriptEntry } from "@/api/chat/types";
import { reduceTranscriptEntry } from "@/features/ai-chat/turn-reducer";
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
  it("accepts backend event fixtures with the live SSE parser", async () => {
    await expect(parseFixture(turnFullRaw)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "done" })]),
    );
    await expect(parseFixture(turnCancelledRaw)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "done", data: { status: "cancelled" } }),
      ]),
    );
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
    const payload = JSON.parse(transcriptRaw) as { transcript: TranscriptEntry[] };
    const assistants = payload.transcript.filter((entry) => entry.role === "assistant");

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
    const transcript = JSON.parse(transcriptRaw) as { transcript: TranscriptEntry[] };
    const liveNarration = turnFull.events.find(
      (event): event is Extract<ProtocolEvent, { type: "narration" }> =>
        event.type === "narration",
    );
    const assistant = transcript.transcript.find(
      (entry) =>
        entry.role === "assistant" &&
        entry.step_record?.narration?.includes(liveNarration?.data.text ?? ""),
    );

    expect(liveNarration?.data.text).toBe("Let me look at Duke's housing first.");
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role !== "assistant") {
      throw new Error("fixture transcript is missing replayable narration");
    }

    const state = reduceTranscriptEntry(assistant);
    expect(
      state.segments.some(
        (segment) =>
          segment.type === "narration" && segment.text === liveNarration?.data.text,
      ),
    ).toBe(true);
  });
});
