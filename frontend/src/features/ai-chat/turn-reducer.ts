import type {
  ClarifySpec,
  DoneStatus,
  ErrorData,
  MetaData,
  ProtocolEvent,
  RenderSpec,
  ReplaySourceEntry,
  StepData,
  StepRecord,
  TranscriptAssistantEntry,
  TranscriptSegment,
  UsageData,
  UserMessageData,
} from "@/api/chat/types";
import { isTabularRenderSpec } from "@/api/chat/validation";

import { receiptText } from "./step-receipts";

export type ContentBlock =
  { kind: "markdown"; text: string } | { kind: "viz"; spec: RenderSpec };

export type TurnStatus =
  "idle" | "streaming" | "awaiting_input" | "complete" | "cancelled" | "error";

export type TurnStep = StepData;

/**
 * One beat in the chronological run surface, in stream arrival order.
 * `narration` is the agent's loud talk (shown inline); `thinking` is native
 * raw reasoning (collapsed by default).
 */
export type Segment =
  | { type: "narration"; id: string; text: string }
  | { type: "thinking"; id: string; text: string }
  | { type: "user"; id: string; text: string; injected: boolean }
  | { type: "tool"; step: StepData }
  | { type: "answer"; text: string }
  | { type: "viz"; spec: RenderSpec };

export type TurnState = {
  meta: MetaData | null;
  segments: Segment[];
  vizSignatures: ReadonlySet<string>;
  clarify: ClarifySpec | null;
  sources: ReplaySourceEntry[];
  usage: UsageData | null;
  status: TurnStatus;
  error: ErrorData | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  lastEventType: ProtocolEvent["type"] | null;
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
    lastEventType: null,
  };
}

function appendAnswerText(segments: Segment[], text: string): Segment[] {
  const last = segments.at(-1);

  if (last?.type === "answer") {
    return [
      ...segments.slice(0, -1),
      { type: "answer", text: last.text + text },
    ];
  }

  return [...segments, { type: "answer", text }];
}

function vizSignature(spec: RenderSpec): string {
  if (!isTabularRenderSpec(spec)) return JSON.stringify(spec);
  // Match the backend semantic signature: headings and decorative domains do
  // not change truth, while every resolved value and provenance field does.
  return JSON.stringify({
    v: spec.v,
    type: spec.type,
    columns: spec.columns.map(({ unitid, name }) => ({ unitid, name })),
    rows: spec.rows,
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
    (segment) =>
      segment.type === "tool" && segment.step.step_id === step.step_id,
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

function appendThinkingSegment(
  segments: Segment[],
  text: string,
  shouldCoalesce: boolean,
): Segment[] {
  const last = segments.at(-1);

  if (shouldCoalesce && last?.type === "thinking") {
    return [
      ...segments.slice(0, -1),
      { ...last, text: `${last.text}\n\n${text}` },
    ];
  }

  const id = `thinking-${thinkingSegmentCount(segments)}`;
  return [...segments, { type: "thinking", id, text }];
}

function mergeUserSegment(
  segments: Segment[],
  data: UserMessageData,
): Segment[] {
  const index = segments.findIndex(
    (segment) => segment.type === "user" && segment.id === data.user_message_id,
  );
  const nextSegment: Segment = {
    type: "user",
    id: data.user_message_id,
    text: data.text,
    injected: data.injected,
  };

  if (index === -1) {
    return [...segments, nextSegment];
  }

  return [
    ...segments.slice(0, index),
    {
      ...nextSegment,
      injected:
        (segments[index] as Extract<Segment, { type: "user" }>).injected ||
        data.injected,
    },
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
      return {
        ...state,
        meta: event.data,
        status: "streaming",
        lastEventType: event.type,
      };
    case "delta":
      return {
        ...(state.status === "idle"
          ? { ...state, status: "streaming" as const }
          : state),
        segments: appendAnswerText(state.segments, event.data.text),
        lastEventType: event.type,
      };
    case "step":
      return {
        ...state,
        segments: mergeToolSegment(state.segments, event.data),
        lastEventType: event.type,
      };
    case "narration": {
      const id = `narration-${narrationSegmentCount(state.segments)}`;

      return {
        ...state,
        segments: [
          ...state.segments,
          { type: "narration", id, text: event.data.text },
        ],
        lastEventType: event.type,
      };
    }
    case "thinking": {
      return {
        ...state,
        segments: appendThinkingSegment(
          state.segments,
          event.data.text,
          state.lastEventType === "thinking",
        ),
        lastEventType: event.type,
      };
    }
    case "user_message":
      return {
        ...(state.status === "idle"
          ? { ...state, status: "streaming" as const }
          : state),
        segments: mergeUserSegment(state.segments, event.data),
        lastEventType: event.type,
      };
    case "viz":
      return { ...appendViz(state, event.data), lastEventType: event.type };
    case "clarify":
      return { ...state, clarify: event.data, lastEventType: event.type };
    case "sources":
      return {
        ...state,
        sources: event.data.sources,
        lastEventType: event.type,
      };
    case "usage":
      return { ...state, usage: event.data, lastEventType: event.type };
    case "done":
      return {
        ...state,
        status: doneStatusToTurnStatus(event.data.status),
        lastEventType: event.type,
      };
    case "error":
      return {
        ...state,
        status: "error",
        error: event.data,
        lastEventType: event.type,
      };
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
  "user_message",
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

/** The final citeable answer subset (markdown + inline viz), in order.
 * Narration/tool/thinking/user beats are NOT part of this: they are shown in
 * the run surface, while citations and legacy answer text key off this subset. */
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

export function pendingUserSegmentsOf(
  state: TurnState,
): Array<Extract<Segment, { type: "user" }>> {
  return state.segments.filter(
    (segment): segment is Extract<Segment, { type: "user" }> =>
      segment.type === "user" && !segment.injected,
  );
}

export function withoutPendingUserSegments(state: TurnState): TurnState {
  const segments = state.segments.filter(
    (segment) => segment.type !== "user" || segment.injected,
  );
  return segments.length === state.segments.length
    ? state
    : { ...state, segments };
}

export function stepsOf(state: TurnState): StepData[] {
  return state.segments
    .filter(
      (segment): segment is Extract<Segment, { type: "tool" }> =>
        segment.type === "tool",
    )
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

function segmentsFrom(stateOrSegments: TurnState | Segment[]): Segment[] {
  return Array.isArray(stateOrSegments)
    ? stateOrSegments
    : stateOrSegments.segments;
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function citationSuffix(cell: {
  citation?: { vintage: string; source: string } | null;
}): string {
  const parts = [cell.citation?.vintage, cell.citation?.source].filter(
    (value) => value !== undefined && value !== null && value !== "",
  );

  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function vizMarkdown(spec: RenderSpec): string {
  if (!isTabularRenderSpec(spec)) {
    return `### ${typeof spec.title === "string" ? spec.title : "Visualization"}\n\nThis visualization requires a newer client.`;
  }

  const columns = ["Metric", ...spec.columns.map((school) => school.name)];
  const lines = [
    `### ${spec.title}`,
    "",
    `| ${columns.map(escapeMarkdownTableCell).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
  ];

  for (const row of spec.rows) {
    const cells = spec.columns.map((_school, index) => {
      const cell = row.cells[index];

      if (cell === undefined) {
        return "";
      }

      const display = cell.available ? cell.display : "Not available";
      const suffix = cell.available ? citationSuffix(cell) : "";
      return `${display}${suffix}`;
    });

    lines.push(
      `| ${[row.label, ...cells].map(escapeMarkdownTableCell).join(" | ")} |`,
    );
  }

  return lines.join("\n");
}

function userBlockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** Serialize the whole assistant run in chronological order for copy/export.
 * Native thinking is intentionally omitted; visible narration, tool receipts,
 * inline user steering, final answer prose, and viz cards are included. */
export function runMarkdownOf(stateOrSegments: TurnState | Segment[]): string {
  const chunks: string[] = [];

  for (const segment of segmentsFrom(stateOrSegments)) {
    switch (segment.type) {
      case "narration":
        if (segment.text.trim().length > 0) {
          chunks.push(segment.text);
        }
        break;
      case "thinking":
        break;
      case "user":
        if (segment.text.trim().length > 0) {
          chunks.push(userBlockquote(segment.text));
        }
        break;
      case "tool": {
        const receipt = receiptText(segment.step);
        chunks.push(
          receipt === null
            ? `- ${segment.step.label}`
            : `- ${segment.step.label}: ${receipt}`,
        );
        break;
      }
      case "answer":
        if (segment.text.trim().length > 0) {
          chunks.push(segment.text);
        }
        break;
      case "viz":
        chunks.push(vizMarkdown(segment.spec));
        break;
    }
  }

  return chunks.join("\n\n");
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

  if (entry.segments !== undefined) {
    events.push(...transcriptSegmentsToEvents(entry.segments));
  } else {
    if (entry.step_record !== undefined) {
      for (const step of entry.step_record.steps) {
        events.push({ v: 1, type: "step", data: step });
      }

      const narration =
        entry.step_record.narration ?? entry.step_record.thinking;
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
  }

  if (entry.clarify !== undefined) {
    events.push({ v: 1, type: "clarify", data: entry.clarify.spec });
  }

  // Legacy replay sources are storage-only and cannot be reintroduced as live
  // protocol events. They are attached after deterministic event reduction.

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

function transcriptSegmentsToEvents(
  segments: TranscriptSegment[],
): ProtocolEvent[] {
  return segments.map((segment) => {
    switch (segment.kind) {
      case "narration":
        return { v: 1, type: "narration", data: { text: segment.text } };
      case "thinking":
        return { v: 1, type: "thinking", data: { text: segment.text } };
      case "user":
        return {
          v: 1,
          type: "user_message",
          data: {
            text: segment.text,
            user_message_id: segment.user_message_id,
            injected: segment.injected,
          },
        };
      case "step":
        return { v: 1, type: "step", data: segment.data };
      case "delta":
        return { v: 1, type: "delta", data: { text: segment.text } };
      case "viz":
        return { v: 1, type: "viz", data: segment.spec };
    }
  });
}

export function reduceTranscriptEntry(
  entry: TranscriptAssistantEntry,
): TurnState {
  const state = transcriptEntryToEvents(entry).reduce(
    reduceTurn,
    initialTurnState(),
  );
  return entry.sources === undefined
    ? state
    : { ...state, sources: [...entry.sources] };
}
