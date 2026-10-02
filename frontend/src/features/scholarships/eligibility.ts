import type {
  CitizenshipOption,
  EligibilityKind,
  EligibilityRule,
  GradeOption,
  Scholarship,
} from "@/api/scholarships/types";
import type { Profile } from "@/api/workspace/types";
import { toStateCode, US_STATE_NAMES } from "@/features/scholarships/us-states";

/*
 * Checks a scholarship's structured rules against the student's profile.
 *
 * The honesty rule: a criterion is `met` or `unmet` only when the profile
 * states the fact outright. Missing, ambiguous or unverifiable facts are
 * `unknown` and say what would settle them. Nothing here ever says a student
 * is eligible — the strongest claim is "fits what's in your profile".
 */

export type CriterionStatus = "met" | "unmet" | "unknown";

export type CriterionResult = {
  key: string;
  label: string;
  status: CriterionStatus;
  /** What we know, or what would settle it. */
  detail: string;
  /** Present when adding a profile fact would settle an unknown. */
  profileField?: ProfileFactKey;
};

export type Fit =
  | { kind: "fits" }
  | { kind: "check"; count: number }
  | { kind: "ineligible"; reason: string; ruleKind: EligibilityKind };

export type ProfileFactKey = "citizenship" | "state" | "grade" | "gpa" | "firstGen" | "majors";

export type ProfileFacts = {
  citizenship: CitizenshipOption | null;
  state: string | null;
  grade: GradeOption | null;
  gpa: number | null;
  /** True when a GPA is given on a scale other than 4.0. */
  gpaOffScale: boolean;
  firstGen: boolean | null;
  majors: string[];
};

export const CITIZENSHIP_LABELS: Record<CitizenshipOption, string> = {
  us_citizen: "US citizen",
  permanent_resident: "permanent resident",
  daca: "DACA recipient",
  international: "international student",
};

export const GRADE_LABELS: Record<GradeOption, string> = {
  "9": "9th grade",
  "10": "10th grade",
  "11": "11th grade",
  "12": "12th grade",
};

function parseCitizenship(...values: (string | null | undefined)[]): CitizenshipOption | null {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;
  if (/daca/.test(text)) return "daca";
  if (/permanent|green card|lpr/.test(text)) return "permanent_resident";
  if (/international|f-1|student visa|non-us|not a us/.test(text)) return "international";
  if (/\bus\b|u\.s\.|usa|united states|american/.test(text)) return "us_citizen";
  return null;
}

function parseGpa(value: string | null | undefined, scale: string | null | undefined) {
  const gpa = value ? Number.parseFloat(value) : Number.NaN;
  const scaleValue = scale ? Number.parseFloat(scale) : 4;
  if (!Number.isFinite(gpa)) return { gpa: null, offScale: false };
  return { gpa, offScale: Number.isFinite(scaleValue) && scaleValue !== 4 };
}

export function readProfileFacts(profile: Profile | null | undefined): ProfileFacts {
  const background = profile?.background;
  const grade = profile?.basics?.grade_level;
  const { gpa, offScale } = parseGpa(
    profile?.academics?.gpa_unweighted,
    profile?.academics?.gpa_scale,
  );
  return {
    citizenship: parseCitizenship(background?.citizenship, background?.visa_status),
    state: toStateCode(background?.residence?.state),
    grade: grade && grade in GRADE_LABELS ? (grade as GradeOption) : null,
    gpa,
    gpaOffScale: offScale,
    firstGen: background?.first_gen ?? null,
    majors: (profile?.interests?.intended_majors ?? []).filter(Boolean),
  };
}

export function joinOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function stateName(code: string): string {
  return US_STATE_NAMES[code] ?? code;
}

function majorsLabel(fields: string[]): string {
  const shown = fields.slice(0, 3);
  const rest = fields.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} or ${rest} more fields` : joinOr(shown);
}

/** The requirement in words, as a student reads it. */
export function ruleLabel(rule: EligibilityRule): string {
  switch (rule.kind) {
    case "citizenship":
      return capitalize(joinOr(rule.anyOf.map((option) => CITIZENSHIP_LABELS[option])));
    case "state":
      return `Lives in ${joinOr(rule.anyOf.map(stateName))}`;
    case "grade":
      return `In ${joinOr(rule.anyOf.map((grade) => GRADE_LABELS[grade]))}`;
    case "gpa_min":
      return `Unweighted GPA of ${rule.value.toFixed(1)} or higher`;
    case "first_gen":
      return "First in your family to go to college";
    case "financial_need":
      return "Demonstrated financial need";
    case "major":
      return `Plans to study ${majorsLabel(rule.anyOf)}`;
  }
}

/** The one-line reason shown on a row the student doesn't fit. */
function unmetReason(rule: EligibilityRule): string {
  switch (rule.kind) {
    case "citizenship":
      return `For ${joinOr(rule.anyOf.map((option) => `${CITIZENSHIP_LABELS[option]}s`))} only`;
    case "state":
      return `For ${joinOr(rule.anyOf.map(stateName))} residents`;
    case "grade":
      return `For students in ${joinOr(rule.anyOf.map((grade) => GRADE_LABELS[grade]))}`;
    case "gpa_min":
      return `Needs a ${rule.value.toFixed(1)}+ GPA`;
    case "first_gen":
      return "For first-generation students";
    case "financial_need":
    case "major":
      return ruleLabel(rule);
  }
}

type Verdict = Pick<CriterionResult, "status" | "detail" | "profileField">;

const ASK = (what: string, field: ProfileFactKey): Verdict => ({
  status: "unknown",
  detail: `Add your ${what} to check`,
  profileField: field,
});

function judgeCitizenship(anyOf: CitizenshipOption[], facts: ProfileFacts): Verdict {
  if (!facts.citizenship) return ASK("citizenship", "citizenship");
  const you = `You: ${CITIZENSHIP_LABELS[facts.citizenship]}`;
  return { status: anyOf.includes(facts.citizenship) ? "met" : "unmet", detail: you };
}

function judgeState(anyOf: string[], facts: ProfileFacts): Verdict {
  if (!facts.state) return ASK("state", "state");
  return {
    status: anyOf.includes(facts.state) ? "met" : "unmet",
    detail: `You: ${stateName(facts.state)}`,
  };
}

function judgeGrade(anyOf: GradeOption[], facts: ProfileFacts): Verdict {
  if (!facts.grade) return ASK("grade", "grade");
  return {
    status: anyOf.includes(facts.grade) ? "met" : "unmet",
    detail: `You: ${GRADE_LABELS[facts.grade]}`,
  };
}

function judgeGpa(min: number, facts: ProfileFacts): Verdict {
  if (facts.gpa === null) return ASK("unweighted GPA", "gpa");
  if (facts.gpaOffScale) {
    return { status: "unknown", detail: "Your GPA isn't on a 4.0 scale — check the sponsor's rules" };
  }
  return {
    status: facts.gpa >= min ? "met" : "unmet",
    detail: `Your GPA: ${facts.gpa.toFixed(2).replace(/0$/, "")}`,
  };
}

function judgeFirstGen(facts: ProfileFacts): Verdict {
  if (facts.firstGen === null) return ASK("family's college history", "firstGen");
  return facts.firstGen
    ? { status: "met", detail: "You said you're first-generation" }
    : { status: "unmet", detail: "You said you're not first-generation" };
}

function judgeMajor(anyOf: string[], facts: ProfileFacts): Verdict {
  if (facts.majors.length === 0) return ASK("intended major", "majors");
  const wanted = anyOf.map((field) => field.toLowerCase());
  const match = facts.majors.find((major) => {
    const value = major.toLowerCase();
    return wanted.some((field) => value.includes(field) || field.includes(value));
  });
  // A non-match stays unknown: majors are free text and the sponsor may
  // count a related field.
  return match
    ? { status: "met", detail: `You plan to study ${match}` }
    : { status: "unknown", detail: "Your planned majors aren't on this list — check with the sponsor" };
}

function judge(rule: EligibilityRule, facts: ProfileFacts): Verdict {
  switch (rule.kind) {
    case "citizenship":
      return judgeCitizenship(rule.anyOf, facts);
    case "state":
      return judgeState(rule.anyOf, facts);
    case "grade":
      return judgeGrade(rule.anyOf, facts);
    case "gpa_min":
      return judgeGpa(rule.value, facts);
    case "first_gen":
      return judgeFirstGen(facts);
    case "financial_need":
      return { status: "unknown", detail: "The sponsor decides this from your financial documents" };
    case "major":
      return judgeMajor(rule.anyOf, facts);
  }
}

export function evaluateCriteria(
  scholarship: Pick<Scholarship, "eligibility" | "otherEligibility">,
  facts: ProfileFacts,
): CriterionResult[] {
  const structured = scholarship.eligibility.map((rule, index) => ({
    key: `${rule.kind}-${index}`,
    label: ruleLabel(rule),
    ...judge(rule, facts),
  }));
  const other = scholarship.otherEligibility
    .filter((text) => text.trim().length > 0)
    .map((text, index) => ({
      key: `other-${index}`,
      label: text,
      status: "unknown" as const,
      detail: "Check this yourself",
    }));
  return [...structured, ...other];
}

/**
 * `ignored` lets the student drop one of their profile facts from matching
 * ("don't filter by my state"); an ignored rule never makes a row ineligible.
 */
export function summarizeFit(
  scholarship: Pick<Scholarship, "eligibility" | "otherEligibility">,
  facts: ProfileFacts,
  ignored: ReadonlySet<EligibilityKind> = new Set(),
): Fit {
  const results = evaluateCriteria(scholarship, facts);
  const firstUnmet = scholarship.eligibility.find(
    (rule, index) => results[index].status === "unmet" && !ignored.has(rule.kind),
  );
  if (firstUnmet) {
    return { kind: "ineligible", reason: unmetReason(firstUnmet), ruleKind: firstUnmet.kind };
  }
  const count = results.filter((result) => result.status !== "met").length;
  return count === 0 ? { kind: "fits" } : { kind: "check", count };
}

export const PROFILE_FACT_RULE: Record<ProfileFactKey, EligibilityKind> = {
  citizenship: "citizenship",
  state: "state",
  grade: "grade",
  gpa: "gpa_min",
  firstGen: "first_gen",
  majors: "major",
};
