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

export type TimelineEntry =
  | { type: "step"; step: StepData }
  | { type: "thinking"; id: string; text: string };

export type TurnState = {
  meta: MetaData | null;
  blocks: ContentBlock[];
  vizSignatures: ReadonlySet<string>;
  steps: TurnStep[];
  thinking: string[];
  timeline: TimelineEntry[];
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
    blocks: [],
    vizSignatures: new Set(),
    steps: [],
    thinking: [],
    timeline: [],
    clarify: null,
    sources: [],
    usage: null,
    status: "idle",
    error: null,
    startedAtMs: null,
    completedAtMs: null,
  };
}

function appendDelta(state: TurnState, text: string): TurnState {
  const last = state.blocks.at(-1);

  if (last?.kind === "markdown") {
    return {
      ...state,
      blocks: [
        ...state.blocks.slice(0, -1),
        { kind: "markdown", text: last.text + text },
      ],
    };
  }

  return {
    ...state,
    blocks: [...state.blocks, { kind: "markdown", text }],
  };
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
    blocks: [...state.blocks, { kind: "viz", spec }],
    vizSignatures: new Set([...state.vizSignatures, signature]),
  };
}

function replaceTimelineStep(
  timeline: TimelineEntry[],
  merged: StepData,
): TimelineEntry[] {
  const index = timeline.findIndex(
    (entry) => entry.type === "step" && entry.step.step_id === merged.step_id,
  );

  if (index === -1) {
    return [...timeline, { type: "step", step: merged }];
  }

  return [
    ...timeline.slice(0, index),
    { type: "step", step: merged },
    ...timeline.slice(index + 1),
  ];
}

function mergeStep(state: TurnState, step: StepData): TurnState {
  const index = state.steps.findIndex(
    (existing) => existing.step_id === step.step_id,
  );

  if (index === -1) {
    return {
      ...state,
      steps: [...state.steps, step],
      timeline: [...state.timeline, { type: "step", step }],
    };
  }

  const merged = { ...state.steps[index], ...step };

  return {
    ...state,
    steps: [
      ...state.steps.slice(0, index),
      merged,
      ...state.steps.slice(index + 1),
    ],
    timeline: replaceTimelineStep(state.timeline, merged),
  };
}

export function reduceTurn(state: TurnState, event: ProtocolEvent): TurnState {
  switch (event.type) {
    case "meta":
      return { ...state, meta: event.data, status: "streaming" };
    case "delta":
      return appendDelta(
        state.status === "idle" ? { ...state, status: "streaming" } : state,
        event.data.text,
      );
    case "step":
      return mergeStep(state, event.data);
    case "thinking": {
      const id = `think-${state.thinking.length}`;

      return {
        ...state,
        thinking: [...state.thinking, event.data.text],
        timeline: [
          ...state.timeline,
          { type: "thinking", id, text: event.data.text },
        ],
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

export function proseOf(state: TurnState): string {
  return state.blocks
    .filter(
      (block): block is Extract<ContentBlock, { kind: "markdown" }> =>
        block.kind === "markdown",
    )
    .map((block) => block.text)
    .join("\n\n");
}

export function deriveReceipt(
  steps: TurnStep[],
  thinking: string[],
): string {
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

export function deriveDurationMs(state: TurnState): number | undefined {
  if (state.startedAtMs === null || state.completedAtMs === null) {
    const fallbackTotal = state.steps.reduce(
      (sum, step) => sum + (step.detail?.duration_ms ?? 0),
      0,
    );

    return fallbackTotal > 0 ? fallbackTotal : undefined;
  }

  return Math.max(0, state.completedAtMs - state.startedAtMs);
}

export function toStepRecord(state: TurnState): StepRecord | undefined {
  if (state.steps.length === 0 && state.thinking.length === 0) {
    return undefined;
  }

  return {
    steps: state.steps,
    thinking: state.thinking,
    receipt: deriveReceipt(state.steps, state.thinking),
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

    for (const text of entry.step_record.thinking) {
      events.push({ v: 1, type: "thinking", data: { text } });
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
