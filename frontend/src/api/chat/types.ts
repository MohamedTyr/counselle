export const PROTOCOL_VERSION = 1;

/** The Quick/Think product selector (plan §3.1/§8.1). Additive protocol-v1
 * data; server-validated, never a raw model id. */
export type ResponseMode = "quick" | "think";

export type Tier = "official" | "community";

export const SOURCE_NAMES = ["cds", "profile", "web", "edu", "reddit"] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];
export type SourceCurrentness = "current" | "historical" | "undated";
export type SourcePeriodBasis = "page_content" | "metadata";

export type Caveat = { kind: string; text: string };
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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
  /** Additive (plan §3.3). Absent only for pre-feature callers; current
   * server code always supplies "quick"/"think". Validate before trusting —
   * see `@/api/chat/response-mode`. */
  response_mode?: string;
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

/** `code` is additive (plan §5.4): `"model_unavailable"` only for the
 * explicitly-mapped provider-capacity/not-found statuses that support
 * mode-aware recovery (`Retry Think` / `Retry with Quick`). Unknown/absent
 * codes mean "message-only", exactly like before. */
export type ErrorData = { message: string; trace_id?: string; code?: string };

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

export type WorkspacePreviewItem = {
  kind: "task" | "school" | "essay" | "activity" | "honor" | "document";
  title: string;
  meta: Array<{ label: string; value: string }>;
  status?: string | null;
  group?: string | null;
};

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
  workspace_items?: WorkspacePreviewItem[];
  error?: string;
  /** The typed mutation receipt (agent mutation receipts plan §6). Present
   * only on workspace/memory write steps. */
  mutation?: unknown;
  /** Independent capability marker — present on every newly terminalized
   * write, including synthesized failed/unknown ones. Marker present with a
   * missing/invalid `mutation` is a CURRENT corrupted receipt (never legacy
   * fallback); marker absent is pre-feature history (§6.7). */
  mutation_contract?: 1;
};

// ---------------------------------------------------------------------------
// Mutation receipt contract (agent mutation receipts plan §6) — mirrors
// domain/mutation_receipts.py. `unknown`-typed at the parse boundary; only
// `parseMutationReceipt` (mutation-receipts/parseMutationReceipt.ts) may
// widen raw JSON into these types.
// ---------------------------------------------------------------------------

export type MutationFamily =
  | "task"
  | "school"
  | "essay"
  | "essay_content"
  | "activity"
  | "honor"
  | "profile"
  | "memory";

export type MutationAction =
  | "create"
  | "update"
  | "archive"
  | "restore"
  | "duplicate"
  | "reorder"
  | "edit"
  | "write"
  | "remember"
  | "update_memory"
  | "forget";

export type MutationOutcome =
  "success" | "no_change" | "partial" | "failed" | "unknown";

export type BoundedDisplayText = {
  text: string;
  truncated: boolean;
  original_graphemes?: number | null;
};

export type MutationSubject = {
  title: BoundedDisplayText;
  resource_ref?: string | null;
};

export type MutationValueKind =
  | "text"
  | "enum"
  | "enum_list"
  | "text_list"
  | "reference"
  | "reference_list"
  | "date"
  | "datetime"
  | "integer"
  | "decimal"
  | "boolean"
  | "count"
  | "word_budget";

export type MutationValue = {
  kind: MutationValueKind;
  text?: BoundedDisplayText | null;
  enum?: string | null;
  list_items?: string[] | null;
  reference?: MutationSubject | null;
  reference_list?: MutationSubject[] | null;
  date?: string | null;
  datetime?: string | null;
  integer?: number | null;
  decimal?: string | null;
  boolean?: boolean | null;
  count?: number | null;
  word_budget_used?: number | null;
  word_budget_limit?: number | null;
};

export type MutationChangeOperation =
  "set" | "clear" | "replace" | "delete" | "move" | "state_only";

export type MutationChange = {
  field_key: string;
  operation: MutationChangeOperation;
  before?: MutationValue | null;
  after?: MutationValue | null;
};

export type MutationNotice = {
  kind: "info" | "warning";
  code: string;
  message: BoundedDisplayText;
};

export type MutationItemDisposition =
  "changed" | "unchanged" | "skipped" | "failed" | "not_attempted" | "unknown";

export type MutationItem = {
  input_index: number;
  disposition: MutationItemDisposition;
  subject?: MutationSubject | null;
  reason?: BoundedDisplayText | null;
  recovery?: BoundedDisplayText | null;
};

export type MutationOmissions = {
  subjects: number;
  changes: number;
  item_details: number;
  notices: number;
  edit_operations: number;
};

export type BatchMutationBody = {
  kind: "batch";
  items: MutationItem[];
};

export type UpdateMutationBody = {
  kind: "update";
  subject: MutationSubject;
  changes: MutationChange[];
};

export type StateTransitionMutationBody = {
  kind: "state_transition";
  state: "created" | "restored" | "archived";
  subjects: MutationSubject[];
  cascade?: MutationNotice | null;
};

export type DuplicateMutationBody = {
  kind: "duplicate";
  source: MutationSubject;
  copy: MutationSubject;
};

export type ReorderMutationBody = {
  kind: "reorder";
  new_order: MutationSubject[];
  old_ranks?: number[] | null;
  moved_index?: number | null;
  moved_from_rank?: number | null;
};

export type EssayEditLocation = {
  kind: "paragraph_range" | "word_range" | "unavailable";
  start?: number | null;
  end?: number | null;
};

export type EssayEditOperation = {
  location: EssayEditLocation;
  operation: "insert" | "delete" | "replace";
  before_words: number;
  after_words: number;
};

export type EssayEditMutationBody = {
  kind: "essay_edit";
  subject: MutationSubject;
  operations: EssayEditOperation[];
  final_word_count: number;
  word_limit?: number | null;
};

export type EssayWriteMutationBody = {
  kind: "essay_write";
  subject: MutationSubject;
  mode: "drafted" | "replaced";
  previous_word_count?: number | null;
  final_word_count: number;
  word_limit?: number | null;
};

export type ProfileSectionChange = {
  section_key: string;
  section_label: string;
  changes: MutationChange[];
};

export type ProfileMutationBody = {
  kind: "profile";
  sections: ProfileSectionChange[];
};

export type MemoryMutationBody = {
  kind: "memory";
  operation: "remember" | "update_memory" | "forget";
  note_count: number;
  active_notes: BoundedDisplayText[];
};

export type UnresolvedMutationBody = {
  kind: "unresolved";
  family: MutationFamily;
  verification:
    | "task_list"
    | "school_list"
    | "essay_list"
    | "activity_list"
    | "honor_list"
    | "profile"
    | "memory_list";
  attempted_count?: number | null;
};

export type MutationBody =
  | BatchMutationBody
  | UpdateMutationBody
  | StateTransitionMutationBody
  | DuplicateMutationBody
  | ReorderMutationBody
  | EssayEditMutationBody
  | EssayWriteMutationBody
  | ProfileMutationBody
  | MemoryMutationBody
  | UnresolvedMutationBody;

export type WorkspaceMutationReceipt = {
  v: 1;
  family: MutationFamily;
  action: MutationAction;
  outcome: MutationOutcome;
  body: MutationBody;
  notices: MutationNotice[];
  omissions: MutationOmissions;
};

export type StepSource = {
  label: string;
  title?: string;
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
  tool?: string;
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
  /** Historical execution mode (plan §6.2). A genuinely legacy record omits
   * this key entirely; the server always sends it (defaulting to "quick")
   * for every current record, so `undefined` means pre-feature history, not
   * "quick". A present but unknown value must still render, just as
   * unsupported for regenerate — see `@/api/chat/response-mode`. */
  response_mode?: string;
  /** The exact configured model string actually invoked. Absent for legacy
   * history — Counselle never fabricates what served an old answer. */
  model?: string;
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

/** Presentation-safe response-mode capability (plan §3.3): the backend owns
 * the available ids, configured model identity, and display name; the
 * frontend owns the Quick/Think product labels/copy. */
export type ResponseModeOptionWire = {
  id: string;
  model: string;
  model_display_name: string;
  preview: boolean;
};

export type ResponseModeOption = {
  id: ResponseMode;
  model: string;
  modelDisplayName: string;
  preview: boolean;
};

export type ChatConfigWire = {
  greeting: string;
  season_note: string | null;
  conversation_starters: string[];
  default_source_config: SourceConfigWire | null;
  skills?: SkillCatalogEntryWire[];
  max_selected_skills?: number;
  default_response_mode?: string;
  response_modes?: ResponseModeOptionWire[];
};

export type ComposerConfig = {
  greeting: string;
  sourceConfig: SourceConfig;
  skills: SkillCatalogEntry[];
  maxSelectedSkills: number;
  defaultResponseMode: ResponseMode;
  responseModes: ResponseModeOption[];
};

export type CreatedSession = {
  sessionId: string;
  sourceConfig: SourceConfig;
  responseMode: ResponseMode;
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
  /** The chat's sticky next-turn mode (plan §3.3). Optional in the type only
   * so hand-built test fixtures don't all need updating; the live transport
   * always populates it (falling back to "quick" for a legacy row). */
  responseMode?: ResponseMode;
};

export type StreamResult = {
  accepted: boolean;
};

export type StartTurnResult =
  | {
      ok: true;
      sessionId: string;
      responseMode: ResponseMode;
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
  /** Omitted for a parked clarification continuation (server inherits the
   * parked mode); a normal new turn always sends it (plan §3.3/§8.4). */
  responseMode?: ResponseMode;
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
    responseMode?: ResponseMode;
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
