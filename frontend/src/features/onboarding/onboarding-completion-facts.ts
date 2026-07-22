import type { Profile } from "@/api/workspace/types";
import {
  PREPROFESSIONAL_LABELS,
  SETTING_LABELS,
  SIZE_LABELS,
} from "@/features/onboarding/onboarding-captions";

/**
 * Pure receipt-row construction for `OnboardingCompletion` (plan
 * `01-questions-and-data.md` §9 Fit "Completion state"). Reads only the
 * returned Profile — never a draft or an optimistic copy — and includes a
 * row only when at least one of its fields is actually present. Never
 * invents, rounds, or interprets a value; every string either restates a
 * saved fact verbatim or is a fixed label for a saved enum value.
 */
export interface OnboardingReceiptGroup {
  label: string;
  value: string;
}

const GRADE_LABELS: Record<string, string> = {
  "9": "9th grade",
  "10": "10th grade",
  "11": "11th grade",
  "12": "12th grade",
  gap: "Gap year",
  other: "Other grade level",
};

function timelineFacts(profile: Profile | undefined): string | null {
  const basics = profile?.basics;
  const parts: string[] = [];
  if (basics?.grade_level) parts.push(GRADE_LABELS[basics.grade_level] ?? basics.grade_level);
  if (basics?.graduation_year != null) parts.push(`Class of ${basics.graduation_year}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function academicFacts(profile: Profile | undefined): string | null {
  const academics = profile?.academics;
  const testing = profile?.testing;
  const parts: string[] = [];

  if (academics?.gpa_unweighted) {
    const scale = academics.gpa_scale ? ` (out of ${academics.gpa_scale})` : "";
    parts.push(`${academics.gpa_unweighted} unweighted GPA${scale}`);
  } else if (academics?.gpa_weighted) {
    const scale = academics.gpa_scale ? ` (out of ${academics.gpa_scale})` : "";
    parts.push(`${academics.gpa_weighted} weighted GPA${scale}`);
  }
  if (testing?.sat?.total != null) parts.push(`SAT ${testing.sat.total}`);
  if (testing?.act?.composite != null) parts.push(`ACT ${testing.act.composite}`);

  return parts.length > 0 ? parts.join(" · ") : null;
}

function directionFacts(profile: Profile | undefined): string | null {
  const interests = profile?.interests;
  const majors = interests?.intended_majors ?? [];
  const parts: string[] = [];
  if (majors.length > 0) parts.push(majors.join(", "));
  const preprofessional = (interests?.preprofessional ?? [])
    .map((value) => PREPROFESSIONAL_LABELS[value])
    .filter((label): label is string => Boolean(label));
  if (preprofessional.length > 0) parts.push(preprofessional.join(", "));

  return parts.length > 0 ? parts.join(" · ") : null;
}

function contextFacts(profile: Profile | undefined): string | null {
  const background = profile?.background;
  const aid = profile?.aid;
  const parts: string[] = [];

  const location = [background?.residence?.state, background?.residence?.country]
    .filter((value): value is string => Boolean(value))
    .join(", ");
  if (location) parts.push(location);
  if (background?.citizenship) parts.push(background.citizenship);

  if (aid?.need_aid === true) parts.push("Likely needs financial aid");
  else if (aid?.need_aid === false) parts.push("Not expecting to need financial aid");
  if (aid?.budget_per_year) parts.push(`Budget around $${aid.budget_per_year}/year`);
  if (aid?.merit_priority === true) parts.push("Merit aid is a priority");

  return parts.length > 0 ? parts.join(" · ") : null;
}

function fitFacts(profile: Profile | undefined): string | null {
  const preferences = profile?.preferences;
  const parts: string[] = [];

  const regions = preferences?.regions ?? [];
  if (regions.length > 0) parts.push(regions.join(", "));

  const sizes = (preferences?.sizes ?? []).map((size) => SIZE_LABELS[size]).filter(Boolean);
  const settings = (preferences?.settings ?? [])
    .map((setting) => SETTING_LABELS[setting])
    .filter(Boolean);
  if (sizes.length > 0) parts.push(`${sizes.join(" or ")} schools`);
  if (settings.length > 0) parts.push(`${settings.join(" or ")} settings`);

  const mustHaves = preferences?.must_haves ?? [];
  if (mustHaves.length > 0) parts.push(`must-have: ${mustHaves.join(", ")}`);
  const dealbreakers = preferences?.dealbreakers ?? [];
  if (dealbreakers.length > 0) parts.push(`dealbreaker: ${dealbreakers.join(", ")}`);

  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Only rows with at least one saved fact are included — never an empty
 * "Timeline" row implying something was asked and left blank. */
export function buildOnboardingReceipt(profile: Profile | undefined): OnboardingReceiptGroup[] {
  const candidates: [string, string | null][] = [
    ["Timeline", timelineFacts(profile)],
    ["Academic snapshot", academicFacts(profile)],
    ["Direction", directionFacts(profile)],
    ["Context", contextFacts(profile)],
    ["Fit", fitFacts(profile)],
  ];
  return candidates
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([label, value]) => ({ label, value }));
}
