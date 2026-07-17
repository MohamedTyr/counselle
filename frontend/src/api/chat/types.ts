export const PROTOCOL_VERSION = 1;

export type Tier = "official" | "community";

export const SOURCE_NAMES = ["cds", "profile", "web", "edu", "reddit"] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];
export type SourceCurrentness = "current" | "historical" | "undated";
export type SourcePeriodBasis = "page_content" | "metadata";

export type Caveat = { kind: string; text: string };
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EvidenceItem = {
  eid: string;
  value_display: string;
  label: string;
  page: number;
  section?: string | null;
  row_label?: string | null;
  column_label?: string | null;
  excerpt: string;
};

export type Citation = {
  v: 2;
  source: SourceName;
  tier: Tier;
  vintage: string;
  url?: string | null;
  document_sha256?: string | null;
  source_kind?: string | null;
  retrieved_at?: string | null;
  academic_year?: number | null;
  manifest_version?: string | null;
  school_unitid?: number | null;
  profile_sha256?: string | null;
  source_period?: string | null;
  source_period_basis?: SourcePeriodBasis | null;
  source_period_evidence?: string | null;
  source_currentness?: SourceCurrentness | null;
};

type EnvelopeBase = {
  v: 2;
  field: string | null;
  label: string;
  display: string;
  raw?: JsonValue;
  unit?: string | null;
  caveats: Caveat[];
};

export type CitationEnvelope =
  | (EnvelopeBase & {
      available: true;
      citation: Citation;
      evidence?: EvidenceItem | null;
      marker: string;
    })
  | (EnvelopeBase & {
      available: false;
      display: "not available";
      citation?: null;
      evidence?: null;
      marker?: null;
    });

export type SchoolRef = {
  unitid: number | null;
  name: string;
  domain?: string | null;
};

export type VizRow = { label: string; cells: CitationEnvelope[] };

export type TabularRenderSpec = {
  v: 2;
  type: "stat_block" | "comparison_table";
  title: string;
  columns: SchoolRef[];
  rows: VizRow[];
};

export type OpaqueRenderSpec = {
  v: number;
  type: string;
  title?: string | null;
  [key: string]: unknown;
};

export type RenderSpec = TabularRenderSpec | OpaqueRenderSpec;

export type ClarifyOption = { label: string; hint: string };

export type ClarifySpec = {
  v: number;
  question: string;
  header: string;
  multi_select: boolean;
  options: ClarifyOption[];
};

export type MetaData = {
  trace_id: string;
  session_id: string;
  model: string;
  message_id: string;
  user_message_id: string;
};

export type DeltaData = { text: string };

export type SourceEntry = {
  v: 2;
  index: number;
  citation: Citation;
  label: string;
  snippet?: string | null;
  evidence: EvidenceItem[];
  evidence_omitted_count: number;
};

/** Stored-transcript compatibility only. This deliberately does not share the
 * current SourceName vocabulary and is never accepted by the live SSE parser. */
export type LegacySourceEntry = {
  v: 1;
  index: number;
  label: string;
  citation: {
    v: 1;
    source: string;
    tier: Tier;
    vintage: string;
    url?: string | null;
    caveat?: string | null;
    raw_table?: string | null;
  };
};
export type ReplaySourceEntry = SourceEntry | LegacySourceEntry;

export type SourcesData = { sources: SourceEntry[] };
export type SourceFocus = { index: number; evidenceId?: string };
export type MessageSourcesPayload = {
  sources: ReplaySourceEntry[];
  active?: SourceFocus;
  displayNumbers: Map<number, number>;
  schoolDomains: Map<number, string>;
};

export type UsageData = {
  input_tokens: number;
  output_tokens: number;
  est_cost_usd?: number | null;
  tool_calls: number;
};

export type DoneStatus = "complete" | "awaiting_input" | "cancelled";

export type DoneData = { status: DoneStatus };

export type ErrorData = { message: string; trace_id?: string };

export type KnownStepKind =
  | "db_tool"
  | "sql"
  | "web_search"
  | "edu_search"
  | "reddit_search"
  | "viz"
  | "skill"
  | "research"
  | "write_plan"
  | "workspace"
  | "memory";

export type StepKind = KnownStepKind | (string & {});

export type StepTier = "official" | "community" | null;

export type StepDetail = {
  query?: string;
  summary?: string;
  domains?: string[];
  result_count?: number;
  value_count?: number;
  duration_ms?: number;
  tool?: string;
  domain_id?: string;
  row_count?: number;
  viz_type?: string;
  schools?: string[];
  /** render_viz only — the distinct citation markers used in the rendered
   * card (e.g. ["[1]", "[3]"]). Unrelated to `StepData.sources` (the
   * favicon/label chip list), which lives one level up. */
  sources?: string[];
  items?: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
  }>;
  completed?: number;
  total?: number;
  next_actions?: string[];
  error?: string;
};

export type StepSource = {
  label: string;
  favicon?: string;
  url?: string;
};

export type ToolUi = {
  widget: string;
  data: Record<string, unknown>;
};

export type StepData = {
  step_id: string;
  status: "start" | "end" | "error";
  kind: StepKind;
  label: string;
  tier: StepTier;
  detail: StepDetail | null;
  sources?: StepSource[];
  ui?: ToolUi;
};

export type NarrationData = { text: string };

export type ThinkingData = { text: string };

export type UserMessageData = {
  text: string;
  user_message_id: string;
  injected: boolean;
};

export type ProtocolEvent =
  | { v?: number; type: "meta"; data: MetaData }
  | { v?: number; type: "delta"; data: DeltaData }
  | { v?: number; type: "step"; data: StepData }
  | { v?: number; type: "narration"; data: NarrationData }
  | { v?: number; type: "thinking"; data: ThinkingData }
  | { v?: number; type: "user_message"; data: UserMessageData }
  | { v?: number; type: "viz"; data: RenderSpec }
  | { v?: number; type: "clarify"; data: ClarifySpec }
  | { v?: number; type: "sources"; data: SourcesData }
  | { v?: number; type: "usage"; data: UsageData }
  | { v?: number; type: "done"; data: DoneData }
  | { v?: number; type: "error"; data: ErrorData };

export type ProtocolEventType = ProtocolEvent["type"];

export const protocolEventTypes = [
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
  "done",
  "error",
] as const satisfies readonly ProtocolEventType[];

export type StepRecord = {
  steps: StepData[];
  narration?: string[];
  thinking: string[];
  receipt: string;
};

export type TranscriptUserEntry = {
  role: "user";
  text: string;
  ts: string | null;
  message_id?: string;
  synthesized?: boolean;
  skills?: string[];
};

export type AssistantContentPart =
  { type: "text"; text: string } | { type: "viz"; spec: RenderSpec };

export type TranscriptSegment =
  | { kind: "narration"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "user"; text: string; user_message_id: string; injected: boolean }
  | { kind: "step"; data: StepData }
  | { kind: "delta"; text: string }
  | { kind: "viz"; spec: RenderSpec };

export type TranscriptAssistantEntry = {
  role: "assistant";
  text: string;
  ts: string | null;
  message_id?: string;
  step_record?: StepRecord;
  parts?: AssistantContentPart[];
  segments?: TranscriptSegment[];
  clarify?: { spec: ClarifySpec; answer: string | null };
  sources?: ReplaySourceEntry[];
  usage?: UsageData;
  status?: DoneStatus | "error";
  error?: ErrorData;
  feedback?: { rating: "up" | "down" };
};

export type TranscriptEntry = TranscriptUserEntry | TranscriptAssistantEntry;

export type Subreddit =
  | "r/ApplyingToCollege"
  | "r/chanceme"
  | "r/financialaid"
  | "r/premed"
  | "r/csMajors";

export type SourceConfig = {
  webSearch: boolean;
  eduSources: boolean;
  reddit: boolean;
  selectedSubreddits: Subreddit[];
};

export type SourceConfigWire = {
  web: boolean;
  edu: boolean;
  reddit: boolean;
  reddit_subreddits: string[] | null;
};

export type SkillCatalogEntryWire = {
  name: string;
  display_name: string;
  description: string;
};

export type SkillCatalogEntry = {
  name: string;
  displayName: string;
  description: string;
};

export type ChatConfigWire = {
  greeting: string;
  season_note: string | null;
  conversation_starters: string[];
  default_source_config: SourceConfigWire | null;
  skills?: SkillCatalogEntryWire[];
  max_selected_skills?: number;
};

export type ComposerConfig = {
  greeting: string;
  sourceConfig: SourceConfig;
  skills: SkillCatalogEntry[];
  maxSelectedSkills: number;
};

export type CreatedSession = {
  sessionId: string;
  sourceConfig: SourceConfig;
};

export type ChatSessionSummary = {
  sessionId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  sourceConfig: SourceConfig;
  isGenerating: boolean;
};

export type ChatSessionList = {
  sessions: ChatSessionSummary[];
  nextCursor: string | null;
};

export type ChatSession = ChatSessionSummary & {
  transcript: TranscriptEntry[];
};

export type StreamResult = {
  accepted: boolean;
};

export type StartTurnResult =
  | {
      ok: true;
      sessionId: string;
    }
  | {
      ok: false;
    };

export type SendMessageInput = {
  sessionId: string;
  text: string;
  sourceConfig: SourceConfig;
  skills?: string[];
  signal?: AbortSignal;
  replaceMessageId?: string;
};

export type SteerMessageInput = {
  sessionId: string;
  text: string;
};

export type SteerMessageResult =
  { status: "queued"; userMessageId: string } | { status: "idle" };

export type AttachStreamResult =
  | { active: false }
  | { active: true; stream: AsyncIterable<SseFrame<ProtocolEvent>> };

export type SetMessageFeedbackInput = {
  sessionId: string;
  messageId: string;
  rating: "up" | "down" | null;
};

export type SseFrame<TEvent extends ProtocolEvent = ProtocolEvent> = {
  id?: string;
  event?: string;
  data: TEvent;
};

export type ChatTransport = {
  getChatConfig: () => Promise<ChatConfigWire>;
  createSession: (input: {
    sourceConfig: SourceConfig;
  }) => Promise<CreatedSession>;
  listSessions: (input?: {
    limit?: number;
    q?: string;
    cursor?: string | null;
  }) => Promise<ChatSessionList>;
  getSession: (sessionId: string) => Promise<ChatSession>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendMessage: (
    input: SendMessageInput,
  ) => AsyncIterable<SseFrame<ProtocolEvent>>;
  steerMessage: (input: SteerMessageInput) => Promise<SteerMessageResult>;
  attachStream: (input: {
    sessionId: string;
    signal?: AbortSignal;
  }) => Promise<AttachStreamResult>;
  streamFirstMessage: (
    input: SendMessageInput & {
      onEvent?: (event: ProtocolEvent) => void;
    },
  ) => Promise<StreamResult>;
  cancelActiveTurn: (sessionId: string) => Promise<void>;
  setMessageFeedback: (input: SetMessageFeedbackInput) => Promise<void>;
};
