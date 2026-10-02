/*
 * The scholarship record as the frontend reads it. The backend does not exist
 * yet: `mock-db.ts` serves these from memory with the same async shape a real
 * `/v1/scholarships` client would have, so swapping it for `requestJson` calls
 * touches only `hooks.ts`.
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
  awardsCount: number | null;
};

export type DeadlineKind = "fixed" | "rolling";

export type Deadline = {
  kind: DeadlineKind;
  /** ISO date (yyyy-mm-dd). Required for `fixed`. */
  date: string | null;
  /** ISO date the application opens, when the sponsor publishes one. */
  opensOn: string | null;
  recursAnnually: boolean;
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
 * goes in `otherEligibility` and is always shown as "Check this yourself".
 */
export type EligibilityRule =
  | { kind: "citizenship"; anyOf: CitizenshipOption[] }
  | { kind: "state"; anyOf: string[] }
  | { kind: "grade"; anyOf: GradeOption[] }
  | { kind: "gpa_min"; value: number }
  | { kind: "first_gen" }
  | { kind: "financial_need" }
  | { kind: "major"; anyOf: string[] };

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
  financialDocuments: boolean;
  interview: boolean;
};

export type Scholarship = {
  id: string;
  name: string;
  sponsor: string;
  summary: string;
  applyUrl: string;
  sourceUrl: string;
  /** An image URL for the sponsor's logo; empty uses the source site's icon. */
  logoUrl: string;
  award: Award;
  deadline: Deadline;
  basis: Basis[];
  /** Empty means any field of study. */
  fields: string[];
  eligibility: EligibilityRule[];
  otherEligibility: string[];
  requirements: Requirements;
  status: ScholarshipStatus;
  /** ISO date the record was last checked against its source. */
  lastCheckedOn: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type ScholarshipDraft = Omit<
  Scholarship,
  "id" | "createdAt" | "updatedAt" | "updatedBy"
>;
