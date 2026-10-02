import type {
  AdminScholarship,
  CitizenshipOption,
  EligibilityRule,
  GradeOption,
  ScholarshipDraft,
  ScholarshipView,
} from "@/api/scholarships/types";
import type { ProfileFacts } from "@/features/scholarships/eligibility";
import { daysUntil, isStale, STALE_AFTER_DAYS } from "@/features/scholarships/scholarship-format";
import { US_STATE_CODES } from "@/features/scholarships/us-states";

export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function emptyDraft(): ScholarshipDraft {
  return {
    name: "",
    sponsor: "",
    summary: "",
    apply_url: "",
    source_url: "",
    logo_url: "",
    award: { kind: "fixed", amount: null, min: null, max: null, renewable: false, years: null, awards_count: null },
    deadline: { kind: "fixed", date: null, opens_on: null, recurs_annually: true },
    basis: ["merit"],
    fields: [],
    eligibility: [],
    other_eligibility: [],
    requirements: { essays: [], recommendations: 0, transcript: false, financial_documents: false, interview: false },
    status: "draft",
    last_checked_on: todayIso(),
  };
}

/** The editable fields of a record, listed out so no server-only field leaks into a draft. */
export function toDraft(record: AdminScholarship): ScholarshipDraft {
  return {
    name: record.name,
    sponsor: record.sponsor,
    summary: record.summary,
    apply_url: record.apply_url,
    source_url: record.source_url,
    logo_url: record.logo_url,
    award: record.award,
    deadline: record.deadline,
    basis: record.basis,
    fields: record.fields,
    eligibility: record.eligibility,
    other_eligibility: record.other_eligibility,
    requirements: record.requirements,
    status: record.status,
    last_checked_on: record.last_checked_on,
  };
}

/** What the student-facing preview renders while the draft is unsaved. */
export function previewRecord(draft: ScholarshipDraft, base: Pick<ScholarshipView, "id" | "created_at"> | null): ScholarshipView {
  return {
    ...draft,
    id: base?.id ?? "preview",
    created_at: base?.created_at ?? new Date().toISOString(),
  };
}

export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function sameDraft(a: ScholarshipDraft, b: ScholarshipDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type Check = { key: string; label: string; ok: boolean };

const URL_PATTERN = /^https?:\/\/[^\s.]+\.[^\s]+$/i;

function awardIsSet(draft: ScholarshipDraft): boolean {
  const { award } = draft;
  if (award.kind === "fixed") return (award.amount ?? 0) > 0;
  if (award.kind === "range") return award.min !== null || award.max !== null;
  return true;
}

function deadlineIsLive(draft: ScholarshipDraft): boolean {
  const { deadline } = draft;
  if (deadline.kind === "rolling") return true;
  return deadline.date !== null && daysUntil(deadline.date) >= 0;
}

/** The publish checklist. A published record must pass all of it to save. */
export function publishChecks(draft: ScholarshipDraft): Check[] {
  return [
    { key: "basics", label: "Name and sponsor", ok: draft.name.trim() !== "" && draft.sponsor.trim() !== "" },
    { key: "apply_url", label: "Apply link is a web address", ok: URL_PATTERN.test(draft.apply_url.trim()) },
    { key: "award", label: "Award amount is set", ok: awardIsSet(draft) },
    {
      key: "rules_complete",
      label: "Every eligibility rule has a choice",
      ok: draft.eligibility.every((rule) => !("any_of" in rule) || rule.any_of.length > 0),
    },
    { key: "deadline", label: "Deadline is today or later, or rolling", ok: deadlineIsLive(draft) },
    { key: "source_url", label: "Source link is a web address", ok: URL_PATTERN.test(draft.source_url.trim()) },
    {
      key: "fresh",
      label: `Checked in the last ${STALE_AFTER_DAYS} days`,
      ok: !isStale(draft),
    },
  ];
}

export type PreviewProfile = "fits" | "fails" | "empty";

export const EMPTY_FACTS: ProfileFacts = {
  citizenship: null,
  state: null,
  grade: null,
  gpa: null,
  gpaOffScale: false,
  firstGen: null,
  majors: [],
};

const GPA_CEILING = 4;

/** A sample student who meets every structured rule. */
export function factsThatFit(rules: EligibilityRule[]): ProfileFacts {
  const facts: ProfileFacts = { ...EMPTY_FACTS, citizenship: "us_citizen", state: "CA", grade: "12", gpa: 3.9, firstGen: false, majors: ["Undecided"] };
  for (const rule of rules) {
    if (rule.kind === "citizenship" && rule.any_of[0]) facts.citizenship = rule.any_of[0];
    if (rule.kind === "state" && rule.any_of[0]) facts.state = rule.any_of[0];
    if (rule.kind === "grade" && rule.any_of[0]) facts.grade = rule.any_of[0];
    if (rule.kind === "gpa_min") facts.gpa = Math.min(GPA_CEILING, Math.max(rule.value + 0.2, 3.9));
    if (rule.kind === "first_gen") facts.firstGen = true;
    if (rule.kind === "major" && rule.any_of[0]) facts.majors = [rule.any_of[0]];
  }
  return facts;
}

const CITIZENSHIPS: CitizenshipOption[] = ["us_citizen", "permanent_resident", "daca", "international"];
const GRADES: GradeOption[] = ["9", "10", "11", "12"];

/** A sample student who fits except for the first rule that can rule one out. */
export function factsThatFail(rules: EligibilityRule[]): { facts: ProfileFacts; failed: boolean } {
  const facts = factsThatFit(rules);
  for (const rule of rules) {
    if (rule.kind === "citizenship") {
      const other = CITIZENSHIPS.find((option) => !rule.any_of.includes(option));
      if (other) return { facts: { ...facts, citizenship: other }, failed: true };
    }
    if (rule.kind === "state") {
      const other = US_STATE_CODES.find((code) => !rule.any_of.includes(code));
      if (other) return { facts: { ...facts, state: other }, failed: true };
    }
    if (rule.kind === "grade") {
      const other = GRADES.find((grade) => !rule.any_of.includes(grade));
      if (other) return { facts: { ...facts, grade: other }, failed: true };
    }
    if (rule.kind === "gpa_min" && rule.value > 0) {
      return { facts: { ...facts, gpa: Math.max(0, rule.value - 0.4) }, failed: true };
    }
    if (rule.kind === "first_gen") return { facts: { ...facts, firstGen: false }, failed: true };
  }
  return { facts, failed: false };
}
