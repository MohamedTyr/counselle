import type { Profile, ProfilePatch } from "@/api/workspace/types";
import type { OnboardingStep } from "@/api/http/onboarding";

/**
 * Pure per-step draft shapes, hydration (Profile -> draft), and patch
 * construction (draft -> minimal `ProfilePatch`). Honesty-critical (plan
 * `01-questions-and-data.md` §10): never spread a whole Profile section,
 * omit untouched/skipped fields at every depth, send `null` only for an
 * explicit clear of a pre-existing value, preserve explicit `false`, and
 * never silently drop Profile data the onboarding screens don't fully own
 * (extra majors/must-haves/dealbreakers, non-SAT/ACT planned tests).
 */

// --- shared helpers ---------------------------------------------------------

/** Tri-state UI value for a boolean Profile field with a "Not sure" option.
 * `"unanswered"` means the control has never been touched — distinct from
 * `"unsure"`, which is an explicit choice that only clears an existing
 * saved value (plan §9 Context Q3-5). */
export type TriState = "yes" | "no" | "unsure" | "unanswered";

export function triStateFromBoolean(value: boolean | null | undefined): TriState {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unanswered";
}

/** `undefined` means omit the key entirely; `null` means explicit clear. */
export function triStatePatchValue(
  initial: boolean | null | undefined,
  draft: TriState,
): boolean | null | undefined {
  const hasInitial = initial === true || initial === false;
  if (draft === "unanswered") return undefined;
  if (draft === "unsure") return hasInitial ? null : undefined;
  const nextValue = draft === "yes";
  return !hasInitial || initial !== nextValue ? nextValue : undefined;
}

export function trimmedTextPatchValue(
  initial: string | null | undefined,
  draftText: string,
): string | null | undefined {
  const trimmed = draftText.trim();
  const initialText = initial ?? "";
  if (trimmed === "") {
    return initialText !== "" ? null : undefined;
  }
  return trimmed !== initialText ? trimmed : undefined;
}

/** A single/multi-choice value backed by a plain string (not a boolean tri-state):
 * mirrors `triStatePatchValue`'s hasInitial logic so deselecting a previously-saved
 * choice sends explicit `null` instead of silently omitting the key. */
export function choicePatchValue(
  initial: string | null | undefined,
  draft: string,
): string | null | undefined {
  const hasInitial = initial != null && initial !== "";
  if (draft === "") return hasInitial ? null : undefined;
  return draft !== (initial ?? "") ? draft : undefined;
}

export function decimalPatchValue(
  initial: string | null | undefined,
  draftText: string,
): string | null | undefined {
  const trimmed = draftText.trim();
  if (trimmed === "") {
    return initial ? null : undefined;
  }
  return trimmed !== (initial ?? "") ? trimmed : undefined;
}

/** Case-insensitive dedupe preserving first spelling and order (plan §10.9). */
export function dedupeTags(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of items) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** A full-ownership list field (sizes/settings/preprofessional/regions
 * without the Open-anywhere clear case): included only when it changed,
 * `null` only when a pre-existing list was explicitly emptied. */
export function fullListPatchValue(
  edited: readonly string[],
  initial: readonly string[] | null | undefined,
): string[] | null | undefined {
  const next = dedupeTags(edited);
  const initialList = initial ?? [];
  if (arraysEqual(next, initialList)) return undefined;
  if (next.length === 0) return initialList.length > 0 ? null : undefined;
  return next;
}

/** A partially-owned list field where onboarding only edits the first `cap`
 * entries (majors/must-haves/dealbreakers): the saved tail beyond `cap`
 * survives untouched (plan §10.11). */
export function cappedListPatchValue(
  editedFirst: readonly string[],
  initial: readonly string[] | null | undefined,
  cap: number,
): string[] | null | undefined {
  const initialList = initial ?? [];
  const preservedTail = initialList.slice(cap);
  const combined = dedupeTags([...editedFirst, ...preservedTail]);
  return fullListPatchValue(combined, initialList);
}

// --- Basics ------------------------------------------------------------------

export type GradeLevel = "9" | "10" | "11" | "12" | "gap" | "other" | "";

export interface BasicsDraft {
  preferredName: string;
  gradeLevel: GradeLevel;
  graduationYear: number | null;
}

export function hydrateBasicsDraft(profile: Profile | undefined): BasicsDraft {
  const basics = profile?.basics;
  return {
    preferredName: basics?.preferred_name ?? "",
    gradeLevel: basics?.grade_level ?? "",
    graduationYear: basics?.graduation_year ?? null,
  };
}

export function buildBasicsPatch(
  draft: BasicsDraft,
  profile: Profile | undefined,
): ProfilePatch {
  const initial = profile?.basics;
  const patch: Record<string, unknown> = {};

  const preferredName = trimmedTextPatchValue(initial?.preferred_name, draft.preferredName);
  if (preferredName !== undefined) patch.preferred_name = preferredName;

  const gradeLevel = choicePatchValue(initial?.grade_level, draft.gradeLevel);
  if (gradeLevel !== undefined) patch.grade_level = gradeLevel;

  if (draft.graduationYear !== (initial?.graduation_year ?? null) && draft.graduationYear !== null) {
    patch.graduation_year = draft.graduationYear;
  }

  return Object.keys(patch).length > 0 ? { basics: patch } : {};
}

// --- Academic snapshot ---------------------------------------------------------

export type GpaType = "unweighted" | "weighted" | "unsure" | "";

export interface AcademicDraft {
  gpaType: GpaType;
  gpaValue: string;
  gpaScale: string;
  satEnabled: boolean;
  satTotal: string;
  actEnabled: boolean;
  actComposite: string;
  noneYet: boolean;
  plannedSat: boolean;
  plannedSatDate: string;
  plannedAct: boolean;
  plannedActDate: string;
}

export function hydrateAcademicDraft(profile: Profile | undefined): AcademicDraft {
  const academics = profile?.academics;
  const testing = profile?.testing;
  const hasWeighted = academics?.gpa_weighted != null;
  const hasUnweighted = academics?.gpa_unweighted != null;
  const gpaType: GpaType = hasUnweighted ? "unweighted" : hasWeighted ? "weighted" : "";
  const gpaValue = gpaType === "unweighted"
    ? (academics?.gpa_unweighted ?? "")
    : gpaType === "weighted"
      ? (academics?.gpa_weighted ?? "")
      : "";

  const plannedSat = testing?.planned_tests?.find((entry) => entry.test === "SAT");
  const plannedAct = testing?.planned_tests?.find((entry) => entry.test === "ACT");

  return {
    gpaType,
    gpaValue,
    gpaScale: academics?.gpa_scale ?? "",
    satEnabled: testing?.sat?.total != null,
    satTotal: testing?.sat?.total != null ? String(testing.sat.total) : "",
    actEnabled: testing?.act?.composite != null,
    actComposite: testing?.act?.composite != null ? String(testing.act.composite) : "",
    noneYet: false,
    plannedSat: Boolean(plannedSat),
    plannedSatDate: plannedSat?.date ?? "",
    plannedAct: Boolean(plannedAct),
    plannedActDate: plannedAct?.date ?? "",
  };
}

export function buildAcademicPatch(
  draft: AcademicDraft,
  profile: Profile | undefined,
): ProfilePatch {
  const academics = profile?.academics;
  const testing = profile?.testing;
  const academicsPatch: Record<string, unknown> = {};
  const testingPatch: Record<string, unknown> = {};

  if (draft.gpaType === "unweighted" || draft.gpaType === "weighted") {
    const gpaValue = draft.gpaValue.trim();
    const initialValue =
      draft.gpaType === "unweighted" ? academics?.gpa_unweighted : academics?.gpa_weighted;
    const gpaActive = gpaValue !== "";
    if (gpaActive && gpaValue !== (initialValue ?? "")) {
      const key = draft.gpaType === "unweighted" ? "gpa_unweighted" : "gpa_weighted";
      academicsPatch[key] = gpaValue;
    }
    // Scale is written whenever it changed, independent of whether the GPA
    // value itself changed — editing only "Out of" must still persist.
    if (gpaActive) {
      const scale = decimalPatchValue(academics?.gpa_scale, draft.gpaScale);
      if (scale !== undefined) academicsPatch.gpa_scale = scale;
    }
  }

  if (draft.satEnabled) {
    const total = draft.satTotal.trim();
    if (total !== "" && (testing?.sat?.total == null || String(testing.sat.total) !== total)) {
      testingPatch.sat = { total: Number(total) };
    }
  }

  if (draft.actEnabled) {
    const composite = draft.actComposite.trim();
    if (composite !== "" && (testing?.act?.composite == null || String(testing.act.composite) !== composite)) {
      testingPatch.act = { composite: Number(composite) };
    }
  }

  const plannedTests = buildPlannedTestsPatch(draft, testing?.planned_tests);
  if (plannedTests !== undefined) testingPatch.planned_tests = plannedTests;

  const patch: Record<string, unknown> = {};
  if (Object.keys(academicsPatch).length > 0) patch.academics = academicsPatch;
  if (Object.keys(testingPatch).length > 0) patch.testing = testingPatch;
  return patch;
}

function buildPlannedTestsPatch(
  draft: AcademicDraft,
  initialPlannedTests: readonly { test: string; date?: string | null }[] | null | undefined,
): { test: string; date?: string }[] | null | undefined {
  const others = (initialPlannedTests ?? []).filter(
    (entry) => entry.test !== "SAT" && entry.test !== "ACT",
  );
  const owned: { test: string; date?: string }[] = [];
  if (draft.plannedSat) {
    owned.push(
      draft.plannedSatDate.trim() ? { test: "SAT", date: draft.plannedSatDate.trim() } : { test: "SAT" },
    );
  }
  if (draft.plannedAct) {
    owned.push(
      draft.plannedActDate.trim() ? { test: "ACT", date: draft.plannedActDate.trim() } : { test: "ACT" },
    );
  }
  const combined = [...others, ...owned];
  const initialNormalized = (initialPlannedTests ?? []).map((entry) =>
    entry.date ? { test: entry.test, date: entry.date } : { test: entry.test },
  );
  if (JSON.stringify(combined) === JSON.stringify(initialNormalized)) return undefined;
  if (combined.length === 0) return initialNormalized.length > 0 ? null : undefined;
  return combined;
}

// --- Academic direction ---------------------------------------------------------

export type MajorCertainty = "locked" | "leaning" | "exploring" | "";

export interface DirectionDraft {
  majors: string[];
  certainty: MajorCertainty;
  preprofessional: string[];
}

export function hydrateDirectionDraft(profile: Profile | undefined): DirectionDraft {
  const interests = profile?.interests;
  return {
    majors: (interests?.intended_majors ?? []).slice(0, 3),
    certainty: interests?.major_certainty ?? "",
    preprofessional: interests?.preprofessional ?? [],
  };
}

export function buildDirectionPatch(
  draft: DirectionDraft,
  profile: Profile | undefined,
): ProfilePatch {
  const interests = profile?.interests;
  const patch: Record<string, unknown> = {};

  const majors = cappedListPatchValue(draft.majors, interests?.intended_majors, 3);
  if (majors !== undefined) patch.intended_majors = majors;

  const certainty = choicePatchValue(interests?.major_certainty, draft.certainty);
  if (certainty !== undefined) patch.major_certainty = certainty;

  const preprofessional = fullListPatchValue(draft.preprofessional, interests?.preprofessional);
  if (preprofessional !== undefined) patch.preprofessional = preprofessional;

  return Object.keys(patch).length > 0 ? { interests: patch } : {};
}

// --- Context ------------------------------------------------------------------

export interface ContextDraft {
  country: string;
  state: string;
  citizenship: string;
  visaStatus: string;
  visaOpen: boolean;
  firstGen: TriState;
  needAid: TriState;
  budgetPerYear: string;
  meritPriority: TriState;
}

export function hydrateContextDraft(profile: Profile | undefined): ContextDraft {
  const background = profile?.background;
  const aid = profile?.aid;
  const hasVisa = Boolean(background?.visa_status);
  return {
    country: background?.residence?.country ?? "",
    state: background?.residence?.state ?? "",
    citizenship: background?.citizenship ?? "",
    visaStatus: background?.visa_status ?? "",
    visaOpen: hasVisa,
    firstGen: triStateFromBoolean(background?.first_gen),
    needAid: triStateFromBoolean(aid?.need_aid),
    budgetPerYear: aid?.budget_per_year ?? "",
    meritPriority: triStateFromBoolean(aid?.merit_priority),
  };
}

export function buildContextPatch(
  draft: ContextDraft,
  profile: Profile | undefined,
): ProfilePatch {
  const background = profile?.background;
  const aid = profile?.aid;
  const backgroundPatch: Record<string, unknown> = {};
  const residencePatch: Record<string, unknown> = {};
  const aidPatch: Record<string, unknown> = {};

  const country = trimmedTextPatchValue(background?.residence?.country, draft.country);
  if (country !== undefined) residencePatch.country = country;
  const state = trimmedTextPatchValue(background?.residence?.state, draft.state);
  if (state !== undefined) residencePatch.state = state;
  if (Object.keys(residencePatch).length > 0) backgroundPatch.residence = residencePatch;

  const citizenship = trimmedTextPatchValue(background?.citizenship, draft.citizenship);
  if (citizenship !== undefined) backgroundPatch.citizenship = citizenship;

  const visaStatus = trimmedTextPatchValue(background?.visa_status, draft.visaStatus);
  if (visaStatus !== undefined) backgroundPatch.visa_status = visaStatus;

  const firstGen = triStatePatchValue(background?.first_gen, draft.firstGen);
  if (firstGen !== undefined) backgroundPatch.first_gen = firstGen;

  const needAid = triStatePatchValue(aid?.need_aid, draft.needAid);
  if (needAid !== undefined) aidPatch.need_aid = needAid;

  // Budget is only ever touched while aid need is actively "Yes" — changing
  // aid need away from Yes must never silently clear a saved budget (§10.13).
  if (draft.needAid === "yes") {
    const budget = decimalPatchValue(aid?.budget_per_year, draft.budgetPerYear);
    if (budget !== undefined) aidPatch.budget_per_year = budget;
  }

  const meritPriority = triStatePatchValue(aid?.merit_priority, draft.meritPriority);
  if (meritPriority !== undefined) aidPatch.merit_priority = meritPriority;

  const patch: Record<string, unknown> = {};
  if (Object.keys(backgroundPatch).length > 0) patch.background = backgroundPatch;
  if (Object.keys(aidPatch).length > 0) patch.aid = aidPatch;
  return patch;
}

// --- Fit ------------------------------------------------------------------

export interface FitDraft {
  regions: string[];
  openAnywhere: boolean;
  sizes: string[];
  settings: string[];
  mustHaves: string[];
  dealbreakers: string[];
}

export function hydrateFitDraft(profile: Profile | undefined): FitDraft {
  const preferences = profile?.preferences;
  return {
    regions: preferences?.regions ?? [],
    openAnywhere: false,
    sizes: preferences?.sizes ?? [],
    settings: preferences?.settings ?? [],
    mustHaves: (preferences?.must_haves ?? []).slice(0, 3),
    dealbreakers: (preferences?.dealbreakers ?? []).slice(0, 3),
  };
}

export function buildFitPatch(draft: FitDraft, profile: Profile | undefined): ProfilePatch {
  const preferences = profile?.preferences;
  const patch: Record<string, unknown> = {};

  if (draft.openAnywhere) {
    if ((preferences?.regions ?? []).length > 0) patch.regions = null;
    // else: a new/untouched profile writes nothing (§9 Fit Q1).
  } else {
    const regions = fullListPatchValue(draft.regions, preferences?.regions);
    if (regions !== undefined) patch.regions = regions;
  }

  const sizes = fullListPatchValue(draft.sizes, preferences?.sizes);
  if (sizes !== undefined) patch.sizes = sizes;

  const settings = fullListPatchValue(draft.settings, preferences?.settings);
  if (settings !== undefined) patch.settings = settings;

  const mustHaves = cappedListPatchValue(draft.mustHaves, preferences?.must_haves, 3);
  if (mustHaves !== undefined) patch.must_haves = mustHaves;

  const dealbreakers = cappedListPatchValue(draft.dealbreakers, preferences?.dealbreakers, 3);
  if (dealbreakers !== undefined) patch.dealbreakers = dealbreakers;

  return Object.keys(patch).length > 0 ? { preferences: patch } : {};
}

// --- step dispatch ---------------------------------------------------------

export type OnboardingDraft =
  | BasicsDraft
  | AcademicDraft
  | DirectionDraft
  | ContextDraft
  | FitDraft;

/** Single dispatch point `OnboardingStepForm` and its tests use instead of a
 * switch duplicated at every call site. */
export function hydrateDraftForStep(
  step: OnboardingStep,
  profile: Profile | undefined,
): OnboardingDraft {
  switch (step) {
    case "basics":
      return hydrateBasicsDraft(profile);
    case "academics":
      return hydrateAcademicDraft(profile);
    case "direction":
      return hydrateDirectionDraft(profile);
    case "context":
      return hydrateContextDraft(profile);
    case "fit":
      return hydrateFitDraft(profile);
  }
}

export function buildPatchForStep(
  step: OnboardingStep,
  draft: OnboardingDraft,
  profile: Profile | undefined,
): ProfilePatch {
  switch (step) {
    case "basics":
      return buildBasicsPatch(draft as BasicsDraft, profile);
    case "academics":
      return buildAcademicPatch(draft as AcademicDraft, profile);
    case "direction":
      return buildDirectionPatch(draft as DirectionDraft, profile);
    case "context":
      return buildContextPatch(draft as ContextDraft, profile);
    case "fit":
      return buildFitPatch(draft as FitDraft, profile);
  }
}
