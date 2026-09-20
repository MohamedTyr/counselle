/**
 * Hand-maintained mirror of `app/sat/models.py` and the taxonomy shapes of
 * `domain/sat/taxonomy.py` (plan §4.2, §5.2). The repo has no codegen — a
 * field renamed or added on the backend must be renamed or added here too.
 * Every wire shape stays snake_case, matching the backend, **except
 * `SatStatsResponse`** (and its nested types): the plan calls for "UserStats
 * (liprep's exact shape)", so those declare their fields camelCase to match
 * upstream's own field names one-for-one.
 */

// --- shared literals ---------------------------------------------------

export type SatModule = "reading" | "math";
export type SatItemType = "mcq" | "spr";
export type SatDifficulty = "E" | "M" | "H";
export type SatSource = "qbank" | "disclosed";
export type SatSolvedStatus = "all" | "unsolved" | "incorrect" | "bookmarked";

// --- GET /taxonomy -------------------------------------------------------

export type SatDifficultyTier = "Easy" | "Medium" | "Hard";

export interface SatSkillDef {
  code: string;
  name: string;
  order: number;
}

export interface SatDomainDef {
  code: string;
  name: string;
  order: number;
  skills: SatSkillDef[];
}

export interface SatBandTier {
  name: SatDifficultyTier;
  bands: number[];
}

export interface SatModuleDef {
  code: SatModule;
  short_label: string;
  long_label: string;
  order: number;
  domains: SatDomainDef[];
}

export interface SatTaxonomy {
  modules: SatModuleDef[];
  band_tiers: SatBandTier[];
}

// --- GET /counts ---------------------------------------------------------

export type SatCounts = Record<string, number>;

// --- GET /session, GET /session?question= ---------------------------------

export interface SatSessionRow {
  id: string;
  score_band: number;
  content_sha: string;
  bookmarked: boolean;
  ever_correct: boolean;
  ever_incorrect: boolean;
}

// --- GET /questions/{id} --------------------------------------------------

export interface SatAnswerOption {
  label: string;
  content: string;
}

export interface SatQuestionPublic {
  question_id: string;
  external_id: string | null;
  ibn: string | null;
  u_id: string;
  source: SatSource;
  module: SatModule;
  domain_cd: string;
  skill_cd: string;
  score_band: number;
  difficulty: SatDifficulty;
  program: string;
  item_type: SatItemType;
  in_bluebook: boolean;
  cb_created_at: string | null;
  cb_updated_at: string | null;
  content_sha256: string;
  retired_at: string | null;
  stimulus: string | null;
  stem: string;
  answer_options: SatAnswerOption[];
}

// --- POST /questions/{id}/attempts, GET /questions/{id}/attempts ----------

export interface SatAttemptSubmit {
  client_attempt_id: string;
  answer: string;
  time_spent_seconds: number;
  local_date: string;
}

export interface SatAttemptOut {
  id: number;
  question_id: string;
  module: string;
  domain_cd: string;
  skill_cd: string;
  score_band: number;
  user_answer: string;
  is_correct: boolean;
  time_spent_seconds: number;
  solved_at: string;
  local_date: string;
}

export interface SatSubmitResult {
  is_correct: boolean;
  correct_answers: string[];
  rationale: string;
  attempts: SatAttemptOut[];
}

// --- PUT /progress ---------------------------------------------------------

export interface SatImportResult {
  attempts_imported: number;
  bookmarks_imported: number;
}

// --- GET /stats — camelCase, liprep's exact shape (see module docstring) --

export interface SatDifficultyBandStat {
  attempted: number;
  correct: number;
  accuracyPct: number;
  avgTimeSeconds: number;
}

export interface SatSkillPerformance {
  code: string;
  name: string;
  domainCode: string;
  module: string;
  totalAttempts: number;
  uniqueQuestions: number;
  firstTryCorrect: number;
  firstTryAccuracyPct: number;
  overallAccuracyPct: number;
  avgTimeSeconds: number;
}

export interface SatDomainPerformance {
  code: string;
  name: string;
  module: string;
  totalAttempts: number;
  uniqueQuestions: number;
  firstTryCorrect: number;
  firstTryAccuracyPct: number;
  overallAccuracyPct: number;
  avgTimeSeconds: number;
}

export interface SatModuleSectionStats {
  uniqueAttempted: number;
  uniqueCorrect: number;
  uniqueIncorrect: number;
  upsolvedCount: number;
  firstTryAccuracyPct: number;
  overallAccuracyPct: number;
  avgTimeSeconds: number;
  totalTimeSeconds: number;
  domains: Record<string, SatDomainPerformance>;
  difficultyStats: Record<number, SatDifficultyBandStat>;
}

export interface SatTodayStats {
  ebrwSolved: number;
  mathSolved: number;
  totalTimeSeconds: number;
}

export interface SatSkillRanking {
  code: string;
  name: string;
  module: string;
  accuracyPct: number;
  attempted: number;
  avgTime: number;
}

export interface SatStatsResponse {
  totalAttemptsCount: number;
  uniqueQuestionsAttempted: number;
  uniqueCorrect: number;
  uniqueIncorrect: number;
  totalUpsolvedCount: number;
  firstTryOverallAccuracyPct: number;
  overallAccuracyPct: number;
  avgTimeSeconds: number;
  currentStreakDays: number;
  today: SatTodayStats;
  ebrw: SatModuleSectionStats;
  math: SatModuleSectionStats;
  difficultyStats: Record<number, SatDifficultyBandStat>;
  domainStats: Record<string, SatDomainPerformance>;
  skillStats: Record<string, SatSkillPerformance>;
  weakestSkills: SatSkillRanking[];
  strongestSkills: SatSkillRanking[];
  heatmap: Record<string, number>;
}

// --- shared filter shape (plan §4.2, §4.5) ----------------------------

/** The parameters shared by `GET /counts` and `GET /session` (plan §4.5).
 * An empty `skills`/`bands` list means "all" — see `sat-filters.ts`'s
 * `FilterState`, which this is built from. */
export interface SatFilterQuery {
  skills?: readonly string[];
  bands?: readonly number[];
  status?: SatSolvedStatus;
  excludeBluebook?: boolean;
}
