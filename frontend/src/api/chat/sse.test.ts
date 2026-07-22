import { parseSseStream } from "@/api/chat/sse";
import type { SseFrame } from "@/api/chat/types";
import { isCurrentCitation } from "@/api/chat/validation";

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

function cdsCitation() {
  return {
    v: 2,
    source: "cds",
    tier: "official",
    vintage: "Common Data Set 2024-25",
    url: null,
    document_sha256: "a".repeat(64),
    source_kind: "upload",
    retrieved_at: "2026-07-15T00:00:00Z",
    academic_year: 2024,
    manifest_version: "5.0.1",
    school_unitid: 198419,
    profile_sha256: null,
  };
}

function webCitation() {
  return {
    v: 2,
    source: "web",
    tier: "official",
    vintage: "Retrieved Jul 16, 2026 (live web)",
    url: "https://example.edu/admissions",
    source_period: "2025-2026",
    source_period_basis: "page_content",
    source_period_evidence: "2025-2026 undergraduate admissions",
    source_currentness: "current",
  };
}

function currentViz() {
  return {
    v: 2,
    type: "comparison_table",
    title: "Comparison",
    columns: [
      { unitid: 198419, name: "Duke University", domain: "duke.edu" },
      { unitid: null, name: "Web College", domain: "example.edu" },
    ],
    rows: [
      {
        label: "Acceptance rate",
        cells: [
          {
            v: 2,
            field: "admissions.acceptance_rate",
            label: "Acceptance rate",
            display: "6.8%",
            raw: 0.068,
            available: true,
            unit: "percent",
            citation: cdsCitation(),
            evidence: {
              eid: "admissions.acceptance_rate",
              value_display: "6.8%",
              label: "Acceptance rate",
              page: 7,
              section: "C1",
              excerpt: "Applicants admitted: 6.8%",
            },
            caveats: [
              { kind: "stale_edition", text: "This value is from 2024-25." },
            ],
            marker: "[123]",
          },
          {
            v: 2,
            field: null,
            label: "Acceptance rate",
            display: "not available",
            raw: null,
            available: false,
            unit: null,
            citation: null,
            evidence: null,
            caveats: [],
            marker: null,
          },
        ],
      },
    ],
  };
}

describe("parseSseStream", () => {
  it("validates web source-period evidence as one coherent claim", () => {
    expect(isCurrentCitation(webCitation())).toBe(true);
    expect(
      isCurrentCitation({
        ...webCitation(),
        source_period: null,
        source_period_basis: null,
        source_period_evidence: null,
        source_currentness: "undated",
      }),
    ).toBe(true);
    expect(
      isCurrentCitation({ ...webCitation(), source_period_evidence: null }),
    ).toBe(false);
    expect(
      isCurrentCitation({ ...webCitation(), source_currentness: "undated" }),
    ).toBe(false);
    expect(
      isCurrentCitation({ ...cdsCitation(), source_currentness: "undated" }),
    ).toBe(false);
  });

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

  it("accepts strict v2 clarify specs and clarify_response acknowledgements", async () => {
    const spec = {
      v: 2,
      questions: [
        {
          id: "q1",
          question: "Which start term?",
          selection: "single",
          options: [
            { id: "q1_o1", label: "Fall", hint: "Fall start" },
            { id: "q1_o2", label: "Spring" },
          ],
        },
      ],
    };
    const response = {
      v: 2,
      mode: "widget",
      answers: [{ question_id: "q1", option_ids: ["q1_o1"] }],
    };

    const frames = await collect(
      streamOf(
        frame("clarify", spec, "1"),
        frame(
          "clarify_response",
          {
            clarify_message_id: "a1",
            continuation_message_id: "a2",
            response,
          },
          "2",
        ),
      ),
    );

    expect(frames.map((item) => item.data.type)).toEqual([
      "clarify",
      "clarify_response",
    ]);
    expect(frames[1].data).toMatchObject({
      type: "clarify_response",
      data: { clarify_message_id: "a1", response },
    });
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
        kind: "render_viz",
        label: "Built a comparison",
        tier: null,
        detail: { sources: "[1]" },
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
      "step",
      {
        step_id: "s1",
        status: "end",
        kind: "db_tool",
        label: "Reading",
        tier: null,
        detail: null,
        ui: { widget: "", data: {} },
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
        ui: { widget: "task_added", data: [] },
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
    [
      "clarify",
      {
        v: 2,
        questions: [
          {
            id: "q1",
            question: "Which term?",
            selection: "single",
            options: [{ id: "q1_o1", label: "Fall" }],
          },
        ],
      },
    ],
    [
      "clarify",
      {
        v: 2,
        questions: [
          {
            id: "q1",
            question: "Which term?",
            selection: "single",
            options: [
              { id: "q1_o1", label: "Fall", extra: true },
              { id: "q1_o2", label: "Spring" },
            ],
          },
        ],
      },
    ],
    [
      "clarify_response",
      {
        clarify_message_id: "a1",
        continuation_message_id: "a2",
        response: { v: 2, mode: "reply", text: "", user_message_id: "u2" },
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
            tool: "write_plan",
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
        tool: "write_plan",
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
          ui: {
            widget: "task_added",
            data: {
              title: "Submit Duke financial aid forms",
              school: "Duke University",
            },
          },
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
        ui: {
          widget: "task_added",
          data: {
            title: "Submit Duke financial aid forms",
            school: "Duke University",
          },
        },
      },
    });
  });

  it("accepts historical step events without tool identity", async () => {
    const frames = await collect(
      streamOf(
        frame("step", {
          step_id: "legacy-s1",
          status: "end",
          kind: "db_tool",
          label: "Reading",
          tier: "official",
          detail: null,
        }),
      ),
    );

    expect(frames[0]?.data).toMatchObject({
      type: "step",
      data: { step_id: "legacy-s1", label: "Reading" },
    });
  });

  it("coerces unknown done statuses to a safe complete status", async () => {
    const frames = await collect(
      streamOf(frame("done", { status: "archived" }, "1")),
    );

    expect(frames[0]?.data).toEqual({
      v: 1,
      type: "done",
      data: { status: "complete" },
    });
  });

  it("accepts outer v1 with a strict nested v2 table, CDS evidence, and null unitid", async () => {
    const frames = await collect(streamOf(frame("viz", currentViz(), "1")));
    expect(frames[0]?.data).toMatchObject({
      v: 1,
      type: "viz",
      data: { v: 2 },
    });
  });

  it.each([
    ["wrong nested version", { ...currentViz(), v: 1 }],
    [
      "old schools vocabulary",
      { ...currentViz(), columns: undefined, schools: [] },
    ],
    [
      "row width mismatch",
      {
        ...currentViz(),
        rows: [
          { ...currentViz().rows[0], cells: [currentViz().rows[0].cells[0]] },
        ],
      },
    ],
    [
      "CDS citation without evidence",
      {
        ...currentViz(),
        rows: [
          {
            ...currentViz().rows[0],
            cells: [
              { ...currentViz().rows[0].cells[0], evidence: null },
              currentViz().rows[0].cells[1],
            ],
          },
        ],
      },
    ],
    [
      "unavailable cell with citation",
      {
        ...currentViz(),
        rows: [
          {
            ...currentViz().rows[0],
            cells: [
              currentViz().rows[0].cells[0],
              { ...currentViz().rows[0].cells[1], citation: cdsCitation() },
            ],
          },
        ],
      },
    ],
  ])("rejects malformed known v2 visualization: %s", async (_label, viz) => {
    await expect(collect(streamOf(frame("viz", viz, "1")))).rejects.toThrow(
      "malformed viz",
    );
  });

  it("preserves an opaque unknown visualization without inspecting its payload", async () => {
    const opaque = {
      v: 2,
      type: "community_card",
      title: "Student voices",
      payload: { rows: "not tabular" },
    };
    const frames = await collect(streamOf(frame("viz", opaque, "1")));
    expect(frames[0]?.data).toEqual({ v: 1, type: "viz", data: opaque });
  });

  it("enforces source-conditional citation and evidence shapes", async () => {
    const valid = {
      sources: [
        {
          v: 2,
          index: 123,
          citation: cdsCitation(),
          label: "Duke University — Common Data Set 2024-25",
          snippet: null,
          evidence: [currentViz().rows[0].cells[0].evidence],
          evidence_omitted_count: 2,
        },
      ],
    };
    const populatedFrames = await collect(
      streamOf(frame("sources", valid, "1")),
    );
    expect(populatedFrames).toEqual([
      {
        id: "1",
        event: "sources",
        data: { v: 1, type: "sources", data: valid },
      },
    ]);

    const emptyEvidence = {
      sources: [
        { ...valid.sources[0], evidence: [], evidence_omitted_count: 0 },
      ],
    };
    const emptyFrames = await collect(
      streamOf(frame("sources", emptyEvidence, "1")),
    );
    expect(emptyFrames).toEqual([
      {
        id: "1",
        event: "sources",
        data: { v: 1, type: "sources", data: emptyEvidence },
      },
    ]);

    const invalidCitation = {
      sources: [
        {
          ...valid.sources[0],
          citation: { ...cdsCitation(), tier: "community" },
        },
      ],
    };
    await expect(
      collect(streamOf(frame("sources", invalidCitation, "1"))),
    ).rejects.toThrow("malformed sources");

    const invalidEvidence = {
      sources: [
        {
          ...valid.sources[0],
          evidence: [{ ...valid.sources[0].evidence[0], page: 0 }],
        },
      ],
    };
    await expect(
      collect(streamOf(frame("sources", invalidEvidence, "1"))),
    ).rejects.toThrow("malformed sources");

    const nonCdsEvidence = {
      sources: [
        {
          ...valid.sources[0],
          citation: {
            v: 2,
            source: "web",
            tier: "official",
            vintage: "2026",
            url: "https://example.edu/admissions",
            retrieved_at: null,
            academic_year: null,
            school_unitid: null,
          },
        },
      ],
    };
    await expect(
      collect(streamOf(frame("sources", nonCdsEvidence, "1"))),
    ).rejects.toThrow("malformed sources");
  });

  it.each([
    ["zero school identity", { school_unitid: 0 }],
    ["fractional academic year", { academic_year: 2024.5 }],
    ["date without serialized time", { retrieved_at: "2026-07-15" }],
    ["datetime without timezone", { retrieved_at: "2026-07-15T00:00:00" }],
    ["impossible calendar date", { retrieved_at: "2026-02-30T00:00:00Z" }],
    ["unsafe academic year", { academic_year: Number.MAX_SAFE_INTEGER + 1 }],
    ["profile identity on CDS", { profile_sha256: "b".repeat(64) }],
  ])("rejects malformed CDS identity: %s", async (_label, override) => {
    const viz = currentViz();
    const cell = viz.rows[0].cells[0];
    const malformed = {
      ...viz,
      rows: [
        {
          ...viz.rows[0],
          cells: [
            { ...cell, citation: { ...cdsCitation(), ...override } },
            viz.rows[0].cells[1],
          ],
        },
      ],
    };
    await expect(
      collect(streamOf(frame("viz", malformed, "1"))),
    ).rejects.toThrow("malformed viz");
  });

  it("rejects non-positive DB column unitids", async () => {
    const viz = currentViz();
    await expect(
      collect(
        streamOf(
          frame(
            "viz",
            {
              ...viz,
              columns: [{ ...viz.columns[0], unitid: -1 }, viz.columns[1]],
            },
            "1",
          ),
        ),
      ),
    ).rejects.toThrow("malformed viz");
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
