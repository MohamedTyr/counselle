export type Actor = "student" | "counselle";
export type ApplicationStatus =
  | "Considering"
  | "Applying"
  | "Submitted"
  | "Deferred"
  | "Accepted"
  | "Enrolled"
  | "Rejected"
  | "Waitlisted"
  | "Withdrawn";
export type ListType = "Reach" | "Target" | "Safety";
export type Round = "EA" | "ED" | "ED2" | "REA" | "RD" | "Rolling" | "Priority";
export type TaskStatus = "todo" | "doing" | "waiting" | "done";
export type TaskCategory =
  "essay" | "lor" | "aid" | "research" | "other" | "form" | "interview";
export type TaskPriority = "low" | "med" | "high";
export type TestPlan = "submit" | "withhold" | "undecided";
export type ApplicationPlatform =
  "common_app" | "coalition" | "school_portal" | "direct" | "other";
export type RequirementApplicability =
  "required" | "optional" | "not_required" | "conditional" | "unknown";
export type TrackableRequirementKind =
  "fee" | "css_profile" | "fafsa" | "testing";
export type ChecklistEntry = {
  status: string;
  updated_at?: string | null;
};
export type ChecklistMap = Partial<
  Record<TrackableRequirementKind, ChecklistEntry>
>;
export type Assignee = "student" | "counselle";
export type EssayStatus =
  "Not started" | "Drafting" | "Needs review" | "Ready" | "Submitted";
export type EssayType =
  "Personal statement" | "Supplement" | "Scholarship" | "Optional";
export type WorkspaceObjectType =
  | "application"
  | "task"
  | "essay"
  | "activity"
  | "honor"
  | "profile"
  | "document"
  | "memory";
export type ChangeOp = "created" | "updated" | "archived" | "restored";

export type Rollup = {
  completed: number;
  total: number;
};

export type Application = {
  id: string;
  user_id: string;
  school_unitid: number;
  cycle_year: number | null;
  status: ApplicationStatus;
  list_type: ListType;
  round: Round;
  deadline: string | null;
  aid_deadline: string | null;
  scholarship_deadline: string | null;
  notes: string | null;
  intended_major: string | null;
  test_plan: TestPlan | null;
  checklist: ChecklistMap;
  platform: ApplicationPlatform | null;
  platform_other: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ApplicationView = Application & {
  school_name: string;
  school_city: string | null;
  school_state: string | null;
  website_url: string | null;
  progress: Rollup;
  essays: Rollup;
};

export type SchoolSearchResult = {
  unitid: number;
  name: string;
  city: string | null;
  state: string | null;
  website_url: string | null;
  on_list: boolean;
  active_cycle_years: number[];
  has_legacy_application: boolean;
};

export type ApplicationCreate = {
  unitid: number;
  cycle_year: number;
  list_type: ListType;
  round: Round;
  deadline?: string | null;
};

export type ApplicationPatch = Partial<{
  status: ApplicationStatus;
  list_type: ListType;
  round: Round;
  deadline: string | null;
  aid_deadline: string | null;
  scholarship_deadline: string | null;
  notes: string | null;
  intended_major: string | null;
  test_plan: TestPlan | null;
  cycle_year: number | null;
  checklist: Partial<Record<TrackableRequirementKind, ChecklistEntry | null>>;
  platform: ApplicationPlatform | null;
  platform_other: string | null;
}>;

export type ApplicationAddResult = {
  application: ApplicationView;
};

export type Task = {
  id: string;
  user_id: string;
  application_id: string | null;
  essay_id: string | null;
  requirement_kind: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  category: TaskCategory;
  priority: TaskPriority;
  assignee: Assignee;
  needs_input: boolean;
  due_at: string | null;
  planned_for: string | null;
  reminder_at: string | null;
  completed_at: string | null;
  archived_via_application: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type TaskCreate = {
  title: string;
  application_id?: string | null;
  essay_id?: string | null;
  requirement_kind?: string | null;
  notes?: string | null;
  status?: TaskStatus;
  category?: TaskCategory;
  priority?: TaskPriority;
  assignee?: Assignee;
  needs_input?: boolean;
  due_at?: string | null;
  planned_for?: string | null;
  reminder_at?: string | null;
};

export type TaskPatch = Partial<{
  title: string;
  application_id: string | null;
  essay_id: string | null;
  requirement_kind: string | null;
  notes: string | null;
  status: TaskStatus;
  category: TaskCategory;
  priority: TaskPriority;
  assignee: Assignee;
  needs_input: boolean;
  due_at: string | null;
  planned_for: string | null;
  reminder_at: string | null;
}>;

export type EssaySummary = {
  id: string;
  user_id: string;
  application_id: string | null;
  prompt_ref: string | null;
  title: string;
  essay_type: EssayType;
  status: EssayStatus;
  prompt: string | null;
  preview: string;
  word_count: number;
  word_limit: number | null;
  comment_count: number;
  suggestion_count: number;
  archived_via_application: string | null;
  school_name: string | null;
  school_city: string | null;
  school_state: string | null;
  cycle_year?: number | null;
  deadline: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type TiptapContent = Record<string, unknown>;

export type Essay = EssaySummary & {
  content: TiptapContent;
  comments: Record<string, unknown>[];
  suggestions: Record<string, unknown>[];
};

export type EssayCreate = {
  title: string;
  application_id?: string | null;
  prompt_ref?: string | null;
  essay_type?: EssayType;
  status?: EssayStatus;
  prompt?: string | null;
  content?: TiptapContent;
  word_count?: number;
  word_limit?: number | null;
};

export type EssayPatch = Partial<{
  title: string;
  application_id: string | null;
  prompt_ref: string | null;
  essay_type: EssayType;
  status: EssayStatus;
  prompt: string | null;
  content: TiptapContent;
  word_limit: number | null;
  deadline: string | null;
  expected_updated_at: string | null;
}>;

export type Activity = {
  id: string;
  user_id: string;
  sort_order: number;
  activity_type: string;
  position: string;
  organization: string;
  description: string;
  grades: string[];
  timing: string[];
  hours_per_week: number | null;
  weeks_per_year: number | null;
  continue_in_college: boolean | null;
  story: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ActivityCreate = Partial<{
  activity_type: string;
  position: string;
  organization: string;
  description: string;
  grades: string[];
  timing: string[];
  hours_per_week: number | null;
  weeks_per_year: number | null;
  continue_in_college: boolean | null;
  story: string | null;
}>;

export type ActivityPatch = ActivityCreate;

export type Honor = {
  id: string;
  user_id: string;
  sort_order: number;
  title: string;
  grades: string[];
  levels: string[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type HonorCreate = Partial<{
  title: string;
  grades: string[];
  levels: string[];
}>;

export type HonorPatch = HonorCreate;

export type ApplicationDetail = {
  application: ApplicationView;
  tasks: Task[];
  essays: EssaySummary[];
  reference: SchoolReference;
};

export type ReferenceProvenance = {
  source: string;
  source_url: string;
  verified_at: string;
};

export type SchoolPromptGroup = {
  id: string;
  label: string;
  choice_min: number;
  provenance: ReferenceProvenance;
};

export type SchoolEssayPrompt = {
  id: string;
  school_unitid: number;
  cycle_year: number;
  ordinal: number;
  prompt: string;
  word_limit: number | null;
  applicability: RequirementApplicability;
  audience: Record<string, unknown>;
  group_id?: string | null;
  provenance: ReferenceProvenance;
};

export type SchoolRequirement = {
  id: string;
  school_unitid: number;
  cycle_year: number;
  kind: string;
  label: string;
  applicability: RequirementApplicability;
  audience: Record<string, unknown>;
  detail: Record<string, unknown>;
  provenance: ReferenceProvenance;
};

export type TestPolicyReference = {
  display?: string | null;
  raw?: unknown;
  citation?: {
    caveat?: string | null;
    source?: string | null;
    vintage?: string | number | null;
    url?: string | null;
    [key: string]: unknown;
  } | null;
};

export type SchoolReference = {
  status: "cycle_required" | "loaded";
  cycle_year: number | null;
  populated: boolean;
  prompt_groups: SchoolPromptGroup[];
  prompts: SchoolEssayPrompt[];
  requirements: SchoolRequirement[];
  test_policy?: TestPolicyReference | null;
};

export type ChangeEventData = {
  object_type: WorkspaceObjectType;
  object_id: string;
  op: ChangeOp;
  actor: Actor;
  application_id: string | null;
};

export type ChangeEvent = {
  id: number;
  v: 1;
  type: `${WorkspaceObjectType}.${ChangeOp}` | string;
  data: ChangeEventData;
};

// --- Profile ---------------------------------------------------------------

export type HighSchool = {
  name?: string | null;
  type?:
    | "public"
    | "charter"
    | "magnet"
    | "private"
    | "parochial"
    | "homeschool"
    | "international"
    | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

export type Basics = {
  preferred_name?: string | null;
  pronouns?: string | null;
  grade_level?: "9" | "10" | "11" | "12" | "gap" | "other" | null;
  graduation_year?: number | null;
  high_school?: HighSchool | null;
  notes?: string | null;
};

export type GradeTrend = {
  trend?: "upward" | "flat" | "dip" | null;
  why?: string | null;
};

export type Academics = {
  gpa_unweighted?: string | null;
  gpa_weighted?: string | null;
  gpa_scale?: string | null;
  class_rank?: number | null;
  class_size?: number | null;
  school_ranks?: boolean | null;
  grade_trend?: GradeTrend | null;
  current_courses?: string[] | null;
  rigor_summary?: string | null;
  notes?: string | null;
};

export type SatScore = {
  total?: number | null;
  ebrw?: number | null;
  math?: number | null;
  date?: string | null;
};

export type ActScore = {
  composite?: number | null;
  sections?: Record<string, string> | null;
  date?: string | null;
};

export type PlannedTest = {
  test: string;
  date?: string | null;
};

export type PsatScore = {
  total?: number | null;
  nmsqt_status?: string | null;
};

export type ApScore = {
  subject: string;
  score: number;
};

export type IbScore = {
  programme?: string | null;
  predicted?: string | null;
  final?: string | null;
};

export type EnglishProficiency = {
  test?: string | null;
  score?: string | null;
  date?: string | null;
};

export type Testing = {
  sat?: SatScore | null;
  act?: ActScore | null;
  planned_tests?: PlannedTest[] | null;
  psat?: PsatScore | null;
  ap_scores?: ApScore[] | null;
  ib?: IbScore | null;
  english_proficiency?: EnglishProficiency | null;
  notes?: string | null;
};

export type Residence = {
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

export type HookKind =
  | "legacy"
  | "recruited_athlete"
  | "development"
  | "faculty_child"
  | "tribal"
  | "military_family"
  | "questbridge_posse"
  | "other";

export type Hook = {
  kind: HookKind;
  detail?: string | null;
};

export type Background = {
  citizenship?: string | null;
  visa_status?: string | null;
  residence?: Residence | null;
  first_gen?: boolean | null;
  family_education?: string | null;
  hooks?: Hook[] | null;
  languages?: string[] | null;
  community_type?: "rural" | "small_town" | "suburban" | "urban" | null;
  notes?: string | null;
};

export type Circumstances = {
  disruptions?: string | null;
  responsibilities?: string | null;
  health_learning?: string | null;
  disciplinary?: string | null;
  notes?: string | null;
};

export type Aid = {
  need_aid?: boolean | null;
  budget_per_year?: string | null;
  sai_estimate?: string | null;
  css_complexity?: string | null;
  loan_appetite?: "none" | "limited" | "open" | null;
  merit_priority?: boolean | null;
  applying_for_scholarships?: boolean | null;
  notes?: string | null;
};

export type Interests = {
  intended_majors?: string[] | null;
  major_certainty?: "locked" | "leaning" | "exploring" | null;
  alternate_majors?: string[] | null;
  career_direction?: string | null;
  preprofessional?:
    | (
        | "pre_med"
        | "pre_law"
        | "bs_md"
        | "nursing"
        | "engineering_accreditation"
        | "other"
      )[]
    | null;
  notes?: string | null;
};

export type Preferences = {
  sizes?: ("small" | "medium" | "large")[] | null;
  settings?: ("urban" | "suburban" | "college_town" | "rural")[] | null;
  regions?: string[] | null;
  max_distance_from_home?: string | null;
  climate?: string | null;
  campus_culture?: string | null;
  must_haves?: string[] | null;
  dealbreakers?: string[] | null;
  notes?: string | null;
};

export type Narrative = {
  spike?: string | null;
  defining_experiences?: string | null;
  self_description?: string | null;
  values_motivations?: string | null;
  essay_angles?: string | null;
  notes?: string | null;
};

export type Recommender = {
  name: string;
  role_or_subject?: string | null;
  why_them?: string | null;
  asked?: boolean | null;
};

export type People = {
  recommenders?: Recommender[] | null;
  counselor_context?: string | null;
  family_stance?: string | null;
  other_support?: string | null;
  notes?: string | null;
};

export type Profile = {
  basics?: Basics | null;
  academics?: Academics | null;
  testing?: Testing | null;
  background?: Background | null;
  circumstances?: Circumstances | null;
  aid?: Aid | null;
  interests?: Interests | null;
  preferences?: Preferences | null;
  narrative?: Narrative | null;
  people?: People | null;
};

/** Section-level JSON merge patch: omitted keys are left alone at every
 * nesting level, explicit `null` clears that key. Mirrors the backend's
 * `ProfilePatch` (RFC 7396-style deep merge) exactly — build patches with
 * `buildProfilePatch` rather than spreading a full section object. */
export type ProfilePatch = Profile;

// --- Documents ---------------------------------------------------------------

export type DocumentType =
  | "transcript"
  | "resume"
  | "essay"
  | "recommendation"
  | "award"
  | "school_report"
  | "other";

export type DocumentTextStatus = "extracted" | "unsupported" | "failed";

export type Document = {
  id: string;
  user_id: string;
  title: string;
  doc_type: DocumentType;
  filename: string;
  mime: string;
  size_bytes: number;
  text_status: DocumentTextStatus;
  summary: string | null;
  created_at: string;
  archived_at: string | null;
};

// --- Memories ---------------------------------------------------------------

export type Memory = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};
