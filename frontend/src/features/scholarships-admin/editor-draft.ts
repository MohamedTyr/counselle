import type {
  CitizenshipOption,
  EligibilityRule,
  GradeOption,
  Scholarship,
  ScholarshipDraft,
} from "@/api/scholarships/types";
import type { ProfileFacts } from "@/features/scholarships/eligibility";
import { daysSince, daysUntil, STALE_AFTER_DAYS } from "@/features/scholarships/scholarship-format";
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
    applyUrl: "",
    sourceUrl: "",
    logoUrl: "",
    award: { kind: "fixed", amount: null, min: null, max: null, renewable: false, years: null, awardsCount: null },
    deadline: { kind: "fixed", date: null, opensOn: null, recursAnnually: true },
    basis: ["merit"],
    fields: [],
    eligibility: [],
    otherEligibility: [],
    requirements: { essays: [], recommendations: 0, transcript: false, financialDocuments: false, interview: false },
    status: "draft",
    lastCheckedOn: todayIso(),
  };
}

export function toDraft(scholarship: Scholarship): ScholarshipDraft {
  const draft: Partial<Scholarship> = { ...scholarship };
  delete draft.id;
  delete draft.createdAt;
  delete draft.updatedAt;
  delete draft.updatedBy;
  return draft as ScholarshipDraft;
}

/** What the student-facing preview renders while the draft is unsaved. */
export function previewRecord(draft: ScholarshipDraft, base: Scholarship | null): Scholarship {
  const now = new Date().toISOString();
  return {
    ...draft,
    id: base?.id ?? "preview",
    createdAt: base?.createdAt ?? now,
    updatedAt: base?.updatedAt ?? now,
    updatedBy: base?.updatedBy ?? "You",
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
    { key: "name", label: "Name and sponsor", ok: draft.name.trim() !== "" && draft.sponsor.trim() !== "" },
    { key: "apply", label: "Apply link is a web address", ok: URL_PATTERN.test(draft.applyUrl.trim()) },
    { key: "award", label: "Award amount is set", ok: awardIsSet(draft) },
    {
      key: "rules",
      label: "Every eligibility rule has a choice",
      ok: draft.eligibility.every((rule) => !("anyOf" in rule) || rule.anyOf.length > 0),
    },
    { key: "deadline", label: "Deadline is today or later, or rolling", ok: deadlineIsLive(draft) },
    { key: "source", label: "Source link is a web address", ok: URL_PATTERN.test(draft.sourceUrl.trim()) },
    {
      key: "checked",
      label: `Checked in the last ${STALE_AFTER_DAYS} days`,
      ok: daysSince(draft.lastCheckedOn) <= STALE_AFTER_DAYS,
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
    if (rule.kind === "citizenship" && rule.anyOf[0]) facts.citizenship = rule.anyOf[0];
    if (rule.kind === "state" && rule.anyOf[0]) facts.state = rule.anyOf[0];
    if (rule.kind === "grade" && rule.anyOf[0]) facts.grade = rule.anyOf[0];
    if (rule.kind === "gpa_min") facts.gpa = Math.min(GPA_CEILING, Math.max(rule.value + 0.2, 3.9));
    if (rule.kind === "first_gen") facts.firstGen = true;
    if (rule.kind === "major" && rule.anyOf[0]) facts.majors = [rule.anyOf[0]];
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
      const other = CITIZENSHIPS.find((option) => !rule.anyOf.includes(option));
      if (other) return { facts: { ...facts, citizenship: other }, failed: true };
    }
    if (rule.kind === "state") {
      const other = US_STATE_CODES.find((code) => !rule.anyOf.includes(code));
      if (other) return { facts: { ...facts, state: other }, failed: true };
    }
    if (rule.kind === "grade") {
      const other = GRADES.find((grade) => !rule.anyOf.includes(grade));
      if (other) return { facts: { ...facts, grade: other }, failed: true };
    }
    if (rule.kind === "gpa_min" && rule.value > 0) {
      return { facts: { ...facts, gpa: Math.max(0, rule.value - 0.4) }, failed: true };
    }
    if (rule.kind === "first_gen") return { facts: { ...facts, firstGen: false }, failed: true };
  }
  return { facts, failed: false };
}
