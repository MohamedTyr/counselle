/*
 * Hand-maintained mirror of `app/scholarships/models.py` and
 * `domain/scholarships/types.py`. Wire shapes are snake_case like every
 * other counselle API.
 */

export type ScholarshipStatus = "draft" | "published" | "archived";

export type AwardKind = "fixed" | "range" | "varies" | "full_tuition" | "full_ride";

export type Award = {
  kind: AwardKind;
  /** Whole dollars. `fixed` reads `amount`; `range` reads `min`/`max`. */
  amount: number | null;
  min: number | null;
  max: number | null;
  renewable: boolean;
  /** Years the award renews for, including the first. Only when renewable. */
  years: number | null;
  /** How many are given each cycle; null when the sponsor doesn't say. */
  awards_count: number | null;
};

export type DeadlineKind = "fixed" | "rolling";

export type Deadline = {
  kind: DeadlineKind;
  /** ISO date (yyyy-mm-dd). Required for `fixed`. */
  date: string | null;
  /** ISO date the application opens, when the sponsor publishes one. */
  opens_on: string | null;
  recurs_annually: boolean;
};

export type Basis = "merit" | "need";

export type CitizenshipOption =
  | "us_citizen"
  | "permanent_resident"
  | "daca"
  | "international";

export type GradeOption = "9" | "10" | "11" | "12";

/**
 * Only criteria the student profile can actually answer are structured.
 * Anything else — including ethnicity, gender, or religion restrictions —
 * goes in `other_eligibility` and is always shown as "Check this yourself".
 */
export type EligibilityRule =
  | { kind: "citizenship"; any_of: CitizenshipOption[] }
  | { kind: "state"; any_of: string[] }
  | { kind: "grade"; any_of: GradeOption[] }
  | { kind: "gpa_min"; value: number }
  | { kind: "first_gen" }
  | { kind: "financial_need" }
  | { kind: "major"; any_of: string[] };

export type EligibilityKind = EligibilityRule["kind"];

export type EssayRequirement = {
  prompt: string;
  /** Word limit; null when the sponsor gives none. */
  words: number | null;
};

export type Requirements = {
  essays: EssayRequirement[];
  recommendations: number;
  transcript: boolean;
  financial_documents: boolean;
  interview: boolean;
};

/** The editable fields of a record, plus its status. */
export type ScholarshipDraft = {
  name: string;
  sponsor: string;
  summary: string;
  apply_url: string;
  source_url: string;
  /** An image URL for the sponsor's logo; empty uses the source site's icon. */
  logo_url: string;
  award: Award;
  deadline: Deadline;
  basis: Basis[];
  /** Empty means any field of study. */
  fields: string[];
  eligibility: EligibilityRule[];
  other_eligibility: string[];
  requirements: Requirements;
  status: ScholarshipStatus;
  /** ISO date the record was last checked against its source; null = never. */
  last_checked_on: string | null;
};

/** What students get. A published record always has `last_checked_on`. */
export type ScholarshipPublic = Omit<ScholarshipDraft, "status" | "last_checked_on"> & {
  id: string;
  created_at: string;
  last_checked_on: string;
};

/** What the student detail view renders; admin previews may be never-checked. */
export type ScholarshipView = Omit<ScholarshipPublic, "last_checked_on"> & {
  last_checked_on: string | null;
};

export type AdminScholarship = ScholarshipView & {
  status: ScholarshipStatus;
  version: number;
  updated_at: string;
  updated_by_email: string | null;
};

export type ScholarshipList = { items: ScholarshipPublic[] };

export type SavedIds = { ids: string[] };

export type PublishCheck =
  | "basics"
  | "apply_url"
  | "award"
  | "rules_complete"
  | "deadline"
  | "source_url"
  | "fresh";

export type RevisionAction =
  | "create"
  | "update"
  | "publish"
  | "unpublish"
  | "archive"
  | "restore"
  | "checked";

export type RevisionOut = {
  version: number;
  action: RevisionAction;
  actor_email: string | null;
  created_at: string;
  /** Top-level snapshot keys that differ from the previous revision. */
  changed: string[];
  /** The draft fields plus status after the change, as plain JSON. */
  snapshot: Record<string, unknown>;
};
