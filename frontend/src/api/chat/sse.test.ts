import { parseSseStream } from "@/api/chat/sse";
import type { SseFrame } from "@/api/chat/types";

function streamOf(...frames: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.join("")));
      controller.close();
    },
  });
}

function frame(type: string, data: unknown, id?: string) {
  return `${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify({
    v: 1,
    type,
    data,
  })}\n\n`;
}

async function collect(body: ReadableStream<Uint8Array>) {
  const frames: SseFrame[] = [];
  for await (const item of parseSseStream(body)) {
    frames.push(item);
  }
  return frames;
}

describe("parseSseStream", () => {
  it("exposes frame id, event field, and parsed protocol event data", async () => {
    const frames = await collect(
      streamOf(frame("delta", { text: "hi" }, "12")),
    );

    expect(frames).toEqual([
      {
        id: "12",
        event: "delta",
        data: { v: 1, type: "delta", data: { text: "hi" } },
      },
    ]);
  });

  it("rejects malformed identity-bearing frames", async () => {
    await expect(
      collect(
        streamOf(
          frame("meta", {}, "1"),
          frame("delta", { text: "still works" }, "2"),
        ),
      ),
    ).rejects.toThrow("malformed meta");
  });

  it.each([
    ["delta", {}],
    ["thinking", {}],
    ["step", { step_id: "s1", status: "start" }],
    [
      "viz",
      {
        v: 1,
        type: "comparison_table",
        title: "Bad viz",
        schools: [{ unitid: 1, name: "School" }],
        rows: [{ label: "Aid", cells: [{}] }],
      },
    ],
    [
      "clarify",
      {
        v: 1,
        question: "Which school?",
        header: "Choose",
        multi_select: false,
        options: [{}],
      },
    ],
    ["sources", { sources: "bad" }],
    ["sources", { sources: [{}] }],
    ["usage", { input_tokens: 1, output_tokens: 2 }],
  ])("rejects malformed %s frames", async (type, data) => {
    await expect(collect(streamOf(frame(type, data, "1")))).rejects.toThrow(
      `malformed ${type}`,
    );
  });

  it("keeps data split across multiple data lines", async () => {
    const frames = await collect(
      streamOf(
        'id: 1\nevent: delta\ndata: {"v":1,"type":"delta",\ndata: "data":{"text":"hi"}}\n\n',
      ),
    );

    expect(frames[0]?.data).toEqual({
      v: 1,
      type: "delta",
      data: { text: "hi" },
    });
  });
});
