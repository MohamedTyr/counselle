/**
 * The v1 protocol — TypeScript mirror of the backend's event types.
 *
 * Sources of truth (field names verbatim):
 *   - `domain/events.py` (MVP1: meta/delta/viz/clarify/sources/usage/done/error)
 *   - `plans/mvp2/architecture.md` §27.1–27.2 (step/thinking), §27.4
 *     (done.status gains "cancelled"), §27.5 (the transcript contract)
 *   - `domain/specs.py` (RenderSpec/ClarifySpec), `domain/envelope.py`
 *     (Citation/CitationEnvelope)
 *
 * FE-7 reconciles the mock fixtures written against these types with the
 * backend's exported protocol fixtures — that reconciliation is the contract
 * test (§34). Nothing outside `src/api/` may know these shapes.
 */

export const PROTOCOL_VERSION = 1;

// ── Citation envelope (domain/envelope.py) ───────────────────────────────────

export type Tier = 'cds' | 'ipeds' | 'scorecard' | 'web' | 'edu' | 'reddit' | string;

export type Citation = {
  source: string;
  tier: Tier;
  /** Human string, e.g. "IPEDS 2024-25 (provisional)". */
  vintage: string;
  caveat?: string | null;
  raw_table?: string | null;
  /** For web/edu/reddit sources. */
  url?: string | null;
};

export type CitationEnvelope = {
  v: number;
  /** Field key or pseudo-key (e.g. "web.search_result"). */
  field: string;
  label: string;
  /** ALWAYS set; "not available" when available=false. */
  display: string;
  raw?: number | boolean | string | null;
  available: boolean;
  unit?: string | null;
  citation: Citation;
};

// ── Specs (domain/specs.py) ──────────────────────────────────────────────────

export type SchoolRef = { unitid: number; name: string };

export type VizRow = { label: string; cells: CitationEnvelope[] };

export type ScoreBand = { test: 'sat' | 'act' | 'both' };

export type RenderSpec = {
  v: number;
  type: 'stat_block' | 'comparison_table' | 'score_band';
  title: string;
  schools: SchoolRef[];
  rows: VizRow[];
  band?: ScoreBand | null;
};

export type ClarifyOption = { label: string; hint: string };

export type ClarifySpec = {
  v: number;
  question: string;
  header: string;
  multi_select: boolean;
  options: ClarifyOption[];
};

// ── Event payloads ───────────────────────────────────────────────────────────

export type MetaData = {
  trace_id: string;
  session_id: string;
  model: string;
};

export type DeltaData = { text: string };

export type SourceEntry = {
  index: number;
  citation: Citation;
  label: string;
};

export type SourcesData = { sources: SourceEntry[] };

export type UsageData = {
  input_tokens: number;
  output_tokens: number;
  est_cost_usd?: number | null;
  tool_calls: number;
};

/** §27.4: "cancelled" extends the existing MVP1 enum (complete | awaiting_input). */
export type DoneStatus = 'complete' | 'awaiting_input' | 'cancelled';

export type DoneData = { status: DoneStatus };

export type ErrorData = { message: string; trace_id: string };

// ── §27.1 step ───────────────────────────────────────────────────────────────

export type StepKind =
  | 'db_tool'
  | 'sql'
  | 'web_search'
  | 'edu_search'
  | 'reddit_search'
  | 'viz'
  | 'skill'
  | 'research';

export type StepTier = 'official' | 'community' | null;

/** Kind-specific receipt payload (§27.1 "end" detail). */
export type StepDetail = {
  query?: string;
  domains?: string[];
  result_count?: number;
  duration_ms?: number;
  /** db_tool/sql kinds. */
  tool?: string;
  field_keys?: string[];
  row_count?: number;
  /** viz kind. */
  viz_type?: string;
  schools?: string[];
};

export type StepData = {
  /** Unique within the turn; pairs start/end. */
  step_id: string;
  status: 'start' | 'end' | 'error';
  kind: StepKind;
  /** Human label, pre-built server-side. */
  label: string;
  /** Drives the icon/color grammar. */
  tier: StepTier;
  detail: StepDetail | null;
};

// ── §27.2 thinking ───────────────────────────────────────────────────────────

export type ThinkingData = { text: string };

// ── The envelope ─────────────────────────────────────────────────────────────

export type ProtocolEvent =
  | { v: number; type: 'meta'; data: MetaData }
  | { v: number; type: 'delta'; data: DeltaData }
  | { v: number; type: 'step'; data: StepData }
  | { v: number; type: 'thinking'; data: ThinkingData }
  | { v: number; type: 'viz'; data: RenderSpec }
  | { v: number; type: 'clarify'; data: ClarifySpec }
  | { v: number; type: 'sources'; data: SourcesData }
  | { v: number; type: 'usage'; data: UsageData }
  | { v: number; type: 'done'; data: DoneData }
  | { v: number; type: 'error'; data: ErrorData };

export type ProtocolEventType = ProtocolEvent['type'];

// ── §27.5 the transcript contract ────────────────────────────────────────────

/**
 * The persisted step record, written into graph state at turn end (§27.1):
 * steps with their receipts (end-state), the thinking lines, and the derived
 * one-line receipt.
 */
export type StepRecord = {
  steps: StepData[];
  thinking: string[];
  receipt: string;
};

export type TranscriptUserEntry = {
  role: 'user';
  text: string;
  ts: string | null;
  /** Message id — MVP2 carries it for feedback/edit addressing (§27.6). */
  message_id?: string;
};

/**
 * One ordered piece of assistant output. `text` parts carry prose; `viz`
 * parts carry render specs at their in-stream position. (MVP1's transcript
 * is prose-only; `parts` preserves viz placement so a reload reproduces the
 * live render — reconciled with the backend's export in FE-7.)
 */
export type AssistantContentPart =
  | { type: 'text'; text: string }
  | { type: 'viz'; spec: RenderSpec };

export type TranscriptAssistantEntry = {
  role: 'assistant';
  /** Concatenated prose (the §27.5-faithful field). */
  text: string;
  ts: string | null;
  /** Message id — MVP2 carries it for feedback/edit addressing (§27.6). */
  message_id?: string;
  /** §27.5: per assistant message, the persisted step record. Pre-MVP2 turns have none. */
  step_record?: StepRecord;
  parts?: AssistantContentPart[];
  sources?: SourceEntry[];
  usage?: UsageData;
  status?: DoneStatus | 'error';
  error?: ErrorData;
};

export type TranscriptEntry = TranscriptUserEntry | TranscriptAssistantEntry;
