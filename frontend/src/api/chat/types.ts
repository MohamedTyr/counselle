export const PROTOCOL_VERSION = 1;

export type Tier = "official" | "community";

export type SourceName =
  "ipeds" | "scorecard" | "cds" | "web" | "edu" | "reddit";

export type Citation = {
  source: SourceName;
  tier: Tier;
  vintage: string;
  caveat?: string | null;
  raw_table?: string | null;
  url?: string | null;
};

export type CitationEnvelope = {
  v: number;
  field: string;
  label: string;
  display: string;
  raw?: number | boolean | string | null;
  available: boolean;
  unit?: string | null;
  citation: Citation;
};

export type SchoolRef = {
  unitid: number;
  name: string;
  domain?: string | null;
};

export type VizRow = { label: string; cells: CitationEnvelope[] };

export type RenderSpec = {
  v: number;
  type: "stat_block" | "comparison_table";
  title: string;
  schools: SchoolRef[];
  rows: VizRow[];
};

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
  index: number;
  citation: Citation;
  label: string;
  snippet?: string | null;
};

export type SourcesData = { sources: SourceEntry[] };

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
  | "research";

export type StepKind = KnownStepKind | (string & {});

export type StepTier = "official" | "community" | null;

export type StepDetail = {
  query?: string;
  domains?: string[];
  result_count?: number;
  duration_ms?: number;
  tool?: string;
  field_keys?: string[];
  row_count?: number;
  viz_type?: string;
  schools?: string[];
};

export type StepSource = {
  label: string;
  favicon?: string;
  url?: string;
};

export type StepData = {
  step_id: string;
  status: "start" | "end" | "error";
  kind: StepKind;
  label: string;
  tier: StepTier;
  detail: StepDetail | null;
  sources?: StepSource[];
};

export type ThinkingData = { text: string };

export type ProtocolEvent =
  | { v?: number; type: "meta"; data: MetaData }
  | { v?: number; type: "delta"; data: DeltaData }
  | { v?: number; type: "step"; data: StepData }
  | { v?: number; type: "thinking"; data: ThinkingData }
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
  "thinking",
  "viz",
  "clarify",
  "sources",
  "usage",
  "done",
  "error",
] as const satisfies readonly ProtocolEventType[];

export type StepRecord = {
  steps: StepData[];
  thinking: string[];
  receipt: string;
};

export type TranscriptUserEntry = {
  role: "user";
  text: string;
  ts: string | null;
  message_id?: string;
  synthesized?: boolean;
};

export type AssistantContentPart =
  { type: "text"; text: string } | { type: "viz"; spec: RenderSpec };

export type TranscriptAssistantEntry = {
  role: "assistant";
  text: string;
  ts: string | null;
  message_id?: string;
  step_record?: StepRecord;
  parts?: AssistantContentPart[];
  clarify?: { spec: ClarifySpec; answer: string | null };
  sources?: SourceEntry[];
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

export type ChatConfigWire = {
  greeting: string;
  season_note: string | null;
  conversation_starters: string[];
  default_source_config: SourceConfigWire | null;
};

export type ComposerConfig = {
  greeting: string;
  sourceConfig: SourceConfig;
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
  signal?: AbortSignal;
  replaceMessageId?: string;
};

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
