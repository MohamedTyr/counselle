/**
 * The turn reducer — protocol events in, turn view-state out.
 *
 * PURE module: no React imports, no I/O (ADR 0020, architecture.md §31.4).
 * Components are dumb draws over its output. Both a live event stream and a
 * persisted transcript entry (§27.5) reduce through the SAME `reduce` — the
 * transcript path synthesizes the equivalent event sequence and replays it
 * (`reduceTranscriptEntry`), so old chats and live streams share one code path
 * (the §34 contract).
 *
 * All updates are immutable. Completed content blocks keep their object
 * identity across events — that reference stability is what lets the vendored
 * MessageRender/MarkdownBlocks memoization skip them while the tail streams.
 */
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
} from './protocol';

// ── View-state shapes ────────────────────────────────────────────────────────

/**
 * One ordered piece of assistant output, in render order.
 * - `markdown` — prose; delta text accumulates into the LAST open markdown block.
 * - `viz` — an opaque render-spec payload (FE-4 renders it properly; FE-3 shows
 *   a labeled placeholder card). A viz block closes the current markdown block:
 *   the next delta opens a new one.
 * Unknown future kinds never reach here — `reduce` ignores unknown event types
 * (the degrade rule); unknown viz spec types are the renderer's fallback.
 */
export type ContentBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'viz'; spec: RenderSpec };

export type TurnStatus = 'idle' | 'streaming' | 'awaiting_input' | 'complete' | 'cancelled' | 'error';

/** A step merged to its latest status (start → end/error), receipts attached. */
export type TurnStep = StepData;

/**
 * One row of the activity timeline, in ARRIVAL order: a step's first event
 * appends an entry (subsequent events for the same step_id merge into it in
 * place); thinking lines append between them. This interleaving is exact for
 * live streams; persisted turns replay steps-then-thinking (§27.5 stores them
 * as two lists), which is the accepted ordering for old chats.
 */
export type TimelineEntry =
  | { type: 'step'; step: StepData }
  | { type: 'thinking'; id: string; text: string };

export type TurnState = {
  meta: MetaData | null;
  /** Ordered content blocks; markdown accumulates into the last open block. */
  blocks: ContentBlock[];
  /** Steps in arrival order, start/end pairs merged by step_id. */
  steps: TurnStep[];
  /** Thinking lines in arrival order (§27.2). */
  thinking: string[];
  /** Steps + thinking interleaved in arrival order — what the timeline draws. */
  timeline: TimelineEntry[];
  /** Pause state — set by a clarify event, turn parks as awaiting_input. */
  clarify: ClarifySpec | null;
  sources: SourceEntry[];
  usage: UsageData | null;
  status: TurnStatus;
  error: ErrorData | null;
};

export function initialTurnState(): TurnState {
  return {
    meta: null,
    blocks: [],
    steps: [],
    thinking: [],
    timeline: [],
    clarify: null,
    sources: [],
    usage: null,
    status: 'idle',
    error: null,
  };
}

// ── Internal helpers (all immutable) ─────────────────────────────────────────

function appendDelta(state: TurnState, text: string): TurnState {
  const blocks = state.blocks;
  const last = blocks[blocks.length - 1];
  if (last !== undefined && last.kind === 'markdown') {
    const updated: ContentBlock = { kind: 'markdown', text: last.text + text };
    return { ...state, blocks: [...blocks.slice(0, -1), updated] };
  }
  return { ...state, blocks: [...blocks, { kind: 'markdown', text }] };
}

function appendViz(state: TurnState, spec: RenderSpec): TurnState {
  const signature = vizSignature(spec);
  const exists = state.blocks.some(
    (block) => block.kind === 'viz' && vizSignature(block.spec) === signature,
  );
  if (exists) {
    return state;
  }
  return { ...state, blocks: [...state.blocks, { kind: 'viz', spec }] };
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

function mergeStep(state: TurnState, step: StepData): TurnState {
  const idx = state.steps.findIndex((s) => s.step_id === step.step_id);
  if (idx === -1) {
    // First event for this step_id: append to both lists (arrival order).
    return {
      ...state,
      steps: [...state.steps, step],
      timeline: [...state.timeline, { type: 'step', step }],
    };
  }
  const merged: TurnStep = { ...state.steps[idx], ...step };
  return {
    ...state,
    steps: [...state.steps.slice(0, idx), merged, ...state.steps.slice(idx + 1)],
    timeline: replaceTimelineStep(state.timeline, merged),
  };
}

/** Merge a step's later event into its existing timeline entry, keeping order. */
function replaceTimelineStep(timeline: TimelineEntry[], merged: StepData): TimelineEntry[] {
  const idx = timeline.findIndex((e) => e.type === 'step' && e.step.step_id === merged.step_id);
  if (idx === -1) {
    return [...timeline, { type: 'step', step: merged }];
  }
  return [
    ...timeline.slice(0, idx),
    { type: 'step', step: merged },
    ...timeline.slice(idx + 1),
  ];
}

// ── The reducer ──────────────────────────────────────────────────────────────

export function reduce(state: TurnState, event: ProtocolEvent): TurnState {
  switch (event.type) {
    case 'meta':
      return { ...state, meta: event.data, status: 'streaming' };
    case 'delta':
      return appendDelta(state.status === 'idle' ? { ...state, status: 'streaming' } : state, event.data.text);
    case 'step':
      return mergeStep(state, event.data);
    case 'thinking': {
      // Each thinking entry gets a STABLE, never-reused id so the renderer can
      // key on it instead of the positional array index (FE-H3). The ordinal is
      // the count of thinking lines already present: the reducer only ever
      // appends, so `state.thinking.length` increments by exactly one per
      // thinking event and is independent of how many steps interleave — two
      // entries can never collide, and an entry's id never changes once created.
      // The id is the ordinal, NOT the text, so duplicate thinking text is fine.
      const id = `think-${state.thinking.length}`;
      return {
        ...state,
        thinking: [...state.thinking, event.data.text],
        timeline: [...state.timeline, { type: 'thinking', id, text: event.data.text }],
      };
    }
    case 'viz':
      return appendViz(state, event.data);
    case 'clarify':
      return { ...state, clarify: event.data };
    case 'sources':
      return { ...state, sources: event.data.sources };
    case 'usage':
      return { ...state, usage: event.data };
    case 'done':
      return { ...state, status: doneStatusToTurnStatus(event.data.status) };
    case 'error':
      return { ...state, status: 'error', error: event.data };
    default:
      // Unknown event type → ignored (forward compatibility, PRD story 35).
      return state;
  }
}

function doneStatusToTurnStatus(status: DoneStatus): TurnStatus {
  if (status === 'complete') {
    return 'complete';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  return 'awaiting_input';
}

// ── Derivations ──────────────────────────────────────────────────────────────

/**
 * The turn's prose only — what persists as the §27.5 `text` field.
 *
 * DIGIT-SCAN-ONLY, NEVER CLAUSE-WRAPPING (FE-M6): this joins markdown blocks
 * with `\n\n` and elides viz blocks, so the result does NOT reflect render order
 * around a card. It is safe ONLY as the `text` fallback for the citation digit
 * scan (`citedIndexesForMessage`), which cares about which `[n]` markers appear,
 * not where. Clause wrapping (reveal/DB-span bounding) MUST use `content` blocks,
 * never this string — live turns always carry `content`, so the fallback is
 * legacy-only.
 */
export function proseOf(state: TurnState): string {
  return state.blocks
    .filter((b): b is Extract<ContentBlock, { kind: 'markdown' }> => b.kind === 'markdown')
    .map((b) => b.text)
    .join('\n\n');
}

/**
 * The derived one-line receipt (§27.1): what the timeline collapses to at
 * `done`. Editorial form: "Checked N sources · M searches" style counts.
 */
export function deriveReceipt(steps: TurnStep[], thinking: string[]): string {
  if (steps.length === 0 && thinking.length === 0) {
    return '';
  }
  const counts = new Map<string, number>();
  for (const step of steps) {
    counts.set(step.kind, (counts.get(step.kind) ?? 0) + 1);
  }
  const labels: string[] = [];
  const db = (counts.get('db_tool') ?? 0) + (counts.get('sql') ?? 0);
  if (db > 0) {
    labels.push(`${db} database ${db === 1 ? 'lookup' : 'lookups'}`);
  }
  const web = (counts.get('web_search') ?? 0) + (counts.get('edu_search') ?? 0);
  if (web > 0) {
    labels.push(`${web} web ${web === 1 ? 'search' : 'searches'}`);
  }
  const reddit = counts.get('reddit_search') ?? 0;
  if (reddit > 0) {
    labels.push(`${reddit} Reddit ${reddit === 1 ? 'search' : 'searches'}`);
  }
  const viz = counts.get('viz') ?? 0;
  if (viz > 0) {
    labels.push(`${viz} ${viz === 1 ? 'visualization' : 'visualizations'}`);
  }
  const other = steps.length - db - web - reddit - viz;
  if (other > 0) {
    labels.push(`${other} ${other === 1 ? 'step' : 'steps'}`);
  }
  return labels.join(' · ');
}

/** Total worked time across steps (sum of receipt duration_ms), if any. */
export function deriveDurationMs(steps: TurnStep[]): number | undefined {
  let total = 0;
  for (const step of steps) {
    total += step.detail?.duration_ms ?? 0;
  }
  return total > 0 ? total : undefined;
}

/** The persisted step record for a finished turn (§27.1/§27.5). */
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

// ── The transcript path (§27.5) — same reducer, synthesized events ──────────

/**
 * Synthesize the event sequence a persisted assistant entry stands for, then
 * replay it through `reduce`. One code path for live and persisted renders.
 *
 * Timeline ordering note (§34): the step record stores steps and thinking as
 * two lists, so the replayed timeline is steps-then-thinking. Exact
 * interleaving is a live-stream-only property — acceptable for old chats.
 */
export function transcriptEntryToEvents(entry: TranscriptAssistantEntry): ProtocolEvent[] {
  const events: ProtocolEvent[] = [];
  const record = entry.step_record;
  if (record !== undefined) {
    for (const step of record.steps) {
      events.push({ v: 1, type: 'step', data: step });
    }
    for (const text of record.thinking) {
      events.push({ v: 1, type: 'thinking', data: { text } });
    }
  }
  const parts = entry.parts ?? [{ type: 'text' as const, text: entry.text }];
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text.length > 0) {
        events.push({ v: 1, type: 'delta', data: { text: part.text } });
      }
    } else if (part.type === 'viz') {
      events.push({ v: 1, type: 'viz', data: part.spec });
    }
  }
  if (entry.clarify !== undefined) {
    // The persisted clarify renders as the frozen transcript record (PRD 25).
    // B2: the entry carries {spec, answer}; the stream event stays the bare
    // spec (wire-contract §1.4). B5 threads `answer` into the frozen widget.
    events.push({ v: 1, type: 'clarify', data: entry.clarify.spec });
  }
  if (entry.sources !== undefined && entry.sources.length > 0) {
    events.push({ v: 1, type: 'sources', data: { sources: entry.sources } });
  }
  if (entry.usage !== undefined) {
    events.push({ v: 1, type: 'usage', data: entry.usage });
  }
  if (entry.status === 'error') {
    events.push({
      v: 1,
      type: 'error',
      data: entry.error ?? { message: 'The answer was interrupted by an error.', trace_id: '' },
    });
  } else {
    events.push({ v: 1, type: 'done', data: { status: entry.status ?? 'complete' } });
  }
  return events;
}

export function reduceTranscriptEntry(entry: TranscriptAssistantEntry): TurnState {
  return transcriptEntryToEvents(entry).reduce(reduce, initialTurnState());
}
