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

  it("accepts narration as a first-class protocol event", async () => {
    const frames = await collect(
      streamOf(frame("narration", { text: "Checking official data." }, "13")),
    );

    expect(frames).toEqual([
      {
        id: "13",
        event: "narration",
        data: {
          v: 1,
          type: "narration",
          data: { text: "Checking official data." },
        },
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
    ["narration", {}],
    ["thinking", {}],
    ["step", { step_id: "s1", status: "start" }],
    [
      "step",
      {
        step_id: "s1",
        status: "end",
        kind: "db_tool",
        label: "Reading",
        tier: null,
        detail: [],
      },
    ],
    [
      "step",
      {
        step_id: "s1",
        status: "end",
        kind: "db_tool",
        label: "Reading",
        tier: null,
        detail: null,
        sources: [{ url: "https://example.com" }],
      },
    ],
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

  it("ignores unknown top-level event types and continues parsing later frames", async () => {
    const frames = await collect(
      streamOf(
        frame("future_event", { value: true }, "1"),
        frame("delta", { text: "still works" }, "2"),
      ),
    );

    expect(frames).toEqual([
      {
        id: "2",
        event: "delta",
        data: { v: 1, type: "delta", data: { text: "still works" } },
      },
    ]);
  });

  it("preserves unknown step kinds as generic step events", async () => {
    const frames = await collect(
      streamOf(
        frame(
          "step",
          {
            step_id: "s1",
            status: "end",
            kind: "write_plan",
            label: "Updated the plan",
            tier: null,
            detail: {
              summary: "Plan updated",
              value_count: 2,
              items: [
                { content: "Resolve schools", status: "completed" },
                { content: "Compare costs", status: "in_progress" },
              ],
              completed: 1,
              total: 2,
              next_actions: ["Compare costs"],
              error: "safe retry guidance",
            },
          },
          "1",
        ),
      ),
    );

    expect(frames[0]?.data).toEqual({
      v: 1,
      type: "step",
      data: {
        step_id: "s1",
        status: "end",
        kind: "write_plan",
        label: "Updated the plan",
        tier: null,
        detail: {
          summary: "Plan updated",
          value_count: 2,
          items: [
            { content: "Resolve schools", status: "completed" },
            { content: "Compare costs", status: "in_progress" },
          ],
          completed: 1,
          total: 2,
          next_actions: ["Compare costs"],
          error: "safe retry guidance",
        },
      },
    });
  });

  it("preserves valid step source chips", async () => {
    const frames = await collect(
      streamOf(
        frame("step", {
          step_id: "s1",
          status: "end",
          kind: "db_tool",
          label: "Reading",
          tier: "official",
          detail: null,
          sources: [
            {
              label: "Duke University",
              favicon: "https://duke.edu/favicon.ico",
              url: "https://duke.edu",
            },
          ],
        }),
      ),
    );

    expect(frames[0]?.data).toMatchObject({
      type: "step",
      data: {
        sources: [
          {
            label: "Duke University",
            favicon: "https://duke.edu/favicon.ico",
            url: "https://duke.edu",
          },
        ],
      },
    });
  });

  it("coerces unknown done statuses to a safe complete status", async () => {
    const frames = await collect(streamOf(frame("done", { status: "archived" }, "1")));

    expect(frames[0]?.data).toEqual({
      v: 1,
      type: "done",
      data: { status: "complete" },
    });
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
