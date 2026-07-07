import type {
  ClarifySpec,
  DoneStatus,
  ErrorData,
  MetaData,
  ProtocolEvent,
  RenderSpec,
  SourceEntry,
  StepData,
  StepRecord,
  TranscriptAssistantEntry,
  UsageData,
} from "@/api/chat/types";

export type ContentBlock =
  | { kind: "markdown"; text: string }
  | { kind: "viz"; spec: RenderSpec };

export type TurnStatus =
  | "idle"
  | "streaming"
  | "awaiting_input"
  | "complete"
  | "cancelled"
  | "error";

export type TurnStep = StepData;

/**
 * One beat in the chronological run surface, in stream arrival order.
 * `narration` is the agent's loud talk (shown inline); `thinking` is native
 * raw reasoning (collapsed by default).
 */
export type Segment =
  | { type: "narration"; id: string; text: string }
  | { type: "thinking"; id: string; text: string }
  | { type: "tool"; step: StepData }
  | { type: "answer"; text: string }
  | { type: "viz"; spec: RenderSpec };

export type TurnState = {
  meta: MetaData | null;
  segments: Segment[];
  vizSignatures: ReadonlySet<string>;
  clarify: ClarifySpec | null;
  sources: SourceEntry[];
  usage: UsageData | null;
  status: TurnStatus;
  error: ErrorData | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
};

export function initialTurnState(): TurnState {
  return {
    meta: null,
    segments: [],
    vizSignatures: new Set(),
    clarify: null,
    sources: [],
    usage: null,
    status: "idle",
    error: null,
    startedAtMs: null,
    completedAtMs: null,
  };
}

function appendAnswerText(segments: Segment[], text: string): Segment[] {
  const last = segments.at(-1);

  if (last?.type === "answer") {
    return [...segments.slice(0, -1), { type: "answer", text: last.text + text }];
  }

  return [...segments, { type: "answer", text }];
}

function vizSignature(spec: RenderSpec): string {
  return JSON.stringify({
    type: spec.type,
    schools: spec.schools.map((school) => ({
      unitid: school.unitid,
      name: school.name,
    })),
    rows: spec.rows.map((row) => ({
      label: row.label,
      cells: row.cells.map((cell) => ({
        field: cell.field,
        display: cell.display,
        raw: cell.raw ?? null,
        unit: cell.unit ?? null,
        available: cell.available,
        citation: {
          source: cell.citation.source,
          tier: cell.citation.tier,
          vintage: cell.citation.vintage,
          caveat: cell.citation.caveat ?? null,
          raw_table: cell.citation.raw_table ?? null,
          url: cell.citation.url ?? null,
        },
      })),
    })),
  });
}

function appendViz(state: TurnState, spec: RenderSpec): TurnState {
  const signature = vizSignature(spec);

  if (state.vizSignatures.has(signature)) {
    return state;
  }

  return {
    ...state,
    segments: [...state.segments, { type: "viz", spec }],
    vizSignatures: new Set([...state.vizSignatures, signature]),
  };
}

function mergeToolSegment(segments: Segment[], step: StepData): Segment[] {
  const index = segments.findIndex(
    (segment) => segment.type === "tool" && segment.step.step_id === step.step_id,
  );

  if (index === -1) {
    return [...segments, { type: "tool", step }];
  }

  const existing = segments[index] as Extract<Segment, { type: "tool" }>;
  const merged = { ...existing.step, ...step };

  return [
    ...segments.slice(0, index),
    { type: "tool", step: merged },
    ...segments.slice(index + 1),
  ];
}

function narrationSegmentCount(segments: Segment[]): number {
  return segments.filter((segment) => segment.type === "narration").length;
}

function thinkingSegmentCount(segments: Segment[]): number {
  return segments.filter((segment) => segment.type === "thinking").length;
}

export function reduceTurn(state: TurnState, event: ProtocolEvent): TurnState {
  switch (event.type) {
    case "meta":
      return { ...state, meta: event.data, status: "streaming" };
    case "delta":
      return {
        ...(state.status === "idle" ? { ...state, status: "streaming" as const } : state),
        segments: appendAnswerText(state.segments, event.data.text),
      };
    case "step":
      return { ...state, segments: mergeToolSegment(state.segments, event.data) };
    case "narration": {
      const id = `narration-${narrationSegmentCount(state.segments)}`;

      return {
        ...state,
        segments: [...state.segments, { type: "narration", id, text: event.data.text }],
      };
    }
    case "thinking": {
      const id = `thinking-${thinkingSegmentCount(state.segments)}`;

      return {
        ...state,
        segments: [...state.segments, { type: "thinking", id, text: event.data.text }],
      };
    }
    case "viz":
      return appendViz(state, event.data);
    case "clarify":
      return { ...state, clarify: event.data };
    case "sources":
      return { ...state, sources: event.data.sources };
    case "usage":
      return { ...state, usage: event.data };
    case "done":
      return { ...state, status: doneStatusToTurnStatus(event.data.status) };
    case "error":
      return { ...state, status: "error", error: event.data };
    default:
      return state;
  }
}

const ARRIVAL_START_EVENTS = new Set<ProtocolEvent["type"]>([
  "meta",
  "delta",
  "step",
  "narration",
  "thinking",
  "viz",
  "clarify",
  "sources",
  "usage",
]);

export function reduceLiveTurn(
  state: TurnState,
  event: ProtocolEvent,
  arrivedAtMs = Date.now(),
): TurnState {
  const startedAtMs =
    state.startedAtMs === null && ARRIVAL_START_EVENTS.has(event.type)
      ? arrivedAtMs
      : state.startedAtMs;
  const reduced = reduceTurn({ ...state, startedAtMs }, event);

  if (event.type === "done" || event.type === "error") {
    return {
      ...reduced,
      startedAtMs: reduced.startedAtMs ?? arrivedAtMs,
      completedAtMs: arrivedAtMs,
    };
  }

  return reduced;
}

function doneStatusToTurnStatus(status: DoneStatus): TurnStatus {
  if (status === "complete") {
    return "complete";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  return "awaiting_input";
}

/** The final citeable answer's content blocks (markdown + inline viz), in
 * order — narration/tool/thinking beats are NOT part of this: they are
 * shown, not part of the answer artifact (copy/citations key off this). */
export function answerBlocksOf(state: TurnState): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const segment of state.segments) {
    if (segment.type === "answer") {
      blocks.push({ kind: "markdown", text: segment.text });
    } else if (segment.type === "viz") {
      blocks.push({ kind: "viz", spec: segment.spec });
    }
  }

  return blocks;
}

export function stepsOf(state: TurnState): StepData[] {
  return state.segments
    .filter((segment): segment is Extract<Segment, { type: "tool" }> => segment.type === "tool")
    .map((segment) => segment.step);
}

/** The narration lines said out loud this turn. Mirrors the persisted
 * receipt's legacy `thinking` bucket until ordered transcript segments land. */
export function narrationTextsOf(state: TurnState): string[] {
  return state.segments
    .filter(
      (segment): segment is Extract<Segment, { type: "narration" }> =>
        segment.type === "narration",
    )
    .map((segment) => segment.text);
}

/** Accepts an already-computed `blocks` (e.g. from `answerBlocksOf`) to avoid
 * re-deriving it from `state.segments` when a caller already has it. */
export function proseOf(
  state: TurnState,
  blocks: ContentBlock[] = answerBlocksOf(state),
): string {
  return blocks
    .filter(
      (block): block is Extract<ContentBlock, { kind: "markdown" }> =>
        block.kind === "markdown",
    )
    .map((block) => block.text)
    .join("\n\n");
}

export function deriveReceipt(steps: TurnStep[], thinking: string[]): string {
  if (steps.length === 0 && thinking.length === 0) {
    return "";
  }

  const counts = new Map<string, number>();
  for (const step of steps) {
    counts.set(step.kind, (counts.get(step.kind) ?? 0) + 1);
  }

  const labels: string[] = [];
  const db = (counts.get("db_tool") ?? 0) + (counts.get("sql") ?? 0);
  if (db > 0) {
    labels.push(`${db} database ${db === 1 ? "lookup" : "lookups"}`);
  }

  const web = (counts.get("web_search") ?? 0) + (counts.get("edu_search") ?? 0);
  if (web > 0) {
    labels.push(`${web} web ${web === 1 ? "search" : "searches"}`);
  }

  const reddit = counts.get("reddit_search") ?? 0;
  if (reddit > 0) {
    labels.push(`${reddit} Reddit ${reddit === 1 ? "search" : "searches"}`);
  }

  const viz = counts.get("viz") ?? 0;
  if (viz > 0) {
    labels.push(`${viz} ${viz === 1 ? "visualization" : "visualizations"}`);
  }

  const other = steps.length - db - web - reddit - viz;
  if (other > 0) {
    labels.push(`${other} ${other === 1 ? "step" : "steps"}`);
  }

  return labels.join(" · ");
}

/** Accepts an already-computed `steps` (e.g. from `stepsOf`) to avoid
 * re-deriving it from `state.segments` when a caller already has it. */
export function deriveDurationMs(
  state: TurnState,
  steps: StepData[] = stepsOf(state),
): number | undefined {
  if (state.startedAtMs === null || state.completedAtMs === null) {
    const fallbackTotal = steps.reduce(
      (sum, step) => sum + (step.detail?.duration_ms ?? 0),
      0,
    );

    return fallbackTotal > 0 ? fallbackTotal : undefined;
  }

  return Math.max(0, state.completedAtMs - state.startedAtMs);
}

/** Accepts already-computed `steps`/`thinking` to avoid re-deriving them from
 * `state.segments` when a caller already has them. */
export function toStepRecord(
  state: TurnState,
  steps: StepData[] = stepsOf(state),
  thinking: string[] = narrationTextsOf(state),
): StepRecord | undefined {
  if (steps.length === 0 && thinking.length === 0) {
    return undefined;
  }

  return {
    steps,
    thinking,
    receipt: deriveReceipt(steps, thinking),
  };
}

export function transcriptEntryToEvents(
  entry: TranscriptAssistantEntry,
): ProtocolEvent[] {
  const events: ProtocolEvent[] = [];

  if (entry.step_record !== undefined) {
    for (const step of entry.step_record.steps) {
      events.push({ v: 1, type: "step", data: step });
    }

    const narration = entry.step_record.narration ?? entry.step_record.thinking;
    for (const text of narration) {
      events.push({ v: 1, type: "narration", data: { text } });
    }

    if (entry.step_record.narration !== undefined) {
      for (const text of entry.step_record.thinking) {
        events.push({ v: 1, type: "thinking", data: { text } });
      }
    }
  }

  const parts = entry.parts ?? [{ type: "text" as const, text: entry.text }];
  for (const part of parts) {
    if (part.type === "text" && part.text.length > 0) {
      events.push({ v: 1, type: "delta", data: { text: part.text } });
    }

    if (part.type === "viz") {
      events.push({ v: 1, type: "viz", data: part.spec });
    }
  }

  if (entry.clarify !== undefined) {
    events.push({ v: 1, type: "clarify", data: entry.clarify.spec });
  }

  if (entry.sources !== undefined && entry.sources.length > 0) {
    events.push({ v: 1, type: "sources", data: { sources: entry.sources } });
  }

  if (entry.usage !== undefined) {
    events.push({ v: 1, type: "usage", data: entry.usage });
  }

  if (entry.status === "error") {
    events.push({
      v: 1,
      type: "error",
      data: entry.error ?? {
        message: "The answer was interrupted by an error.",
        trace_id: "",
      },
    });
  } else {
    events.push({
      v: 1,
      type: "done",
      data: { status: entry.status ?? "complete" },
    });
  }

  return events;
}

export function reduceTranscriptEntry(
  entry: TranscriptAssistantEntry,
): TurnState {
  return transcriptEntryToEvents(entry).reduce(reduceTurn, initialTurnState());
}
