import type {
  AcademicDraft,
  BasicsDraft,
  ContextDraft,
  DirectionDraft,
  FitDraft,
} from "@/features/onboarding/onboarding-profile-patch";

/**
 * Deterministic "after answers" media captions (plan §9): each mentions
 * only values actually entered/loaded, never a missing one, and renders
 * values exactly as entered — no rounding or interpretation. Kept in its
 * own module (not the step components) so every step file exports only a
 * component, per the project's fast-refresh lint rule.
 */

export function basicsCaption(draft: BasicsDraft): string {
  const parts: string[] = [];
  if (draft.preferredName.trim()) parts.push(`call you ${draft.preferredName.trim()}`);
  if (draft.graduationYear) parts.push(`plan around a ${draft.graduationYear} graduation`);
  if (parts.length === 0) return "Your timeline helps Counselle make advice timely.";
  return `Counselle will ${parts.join(" and ")}.`;
}

export function academicCaption(draft: AcademicDraft): string {
  const parts: string[] = [];
  if ((draft.gpaType === "unweighted" || draft.gpaType === "weighted") && draft.gpaValue.trim()) {
    parts.push(`your ${draft.gpaValue.trim()} ${draft.gpaType} GPA`);
  }
  if (draft.satEnabled && draft.satTotal.trim()) parts.push("planned SAT");
  if (draft.actEnabled && draft.actComposite.trim()) parts.push("planned ACT");
  if (parts.length === 0) return "A quick snapshot is enough to begin.";
  return `Counselle will keep ${parts.join(" and ")} in mind.`;
}

export const PREPROFESSIONAL_LABELS: Record<string, string> = {
  pre_med: "Pre-med",
  pre_law: "Pre-law",
  bs_md: "BS/MD",
  nursing: "Nursing",
  engineering_accreditation: "ABET-accredited engineering",
  other: "Other",
};

export function directionCaption(draft: DirectionDraft): string {
  const parts: string[] = [];
  if (draft.majors.length > 0) {
    parts.push(`your interest in ${draft.majors.join(" and ")}`);
  }
  if (parts.length === 0) {
    return "Direction changes which programs and pathways are worth considering.";
  }
  let sentence = `Counselle will keep ${parts.join(", ")}`;
  if (draft.preprofessional.length > 0) {
    const labels = draft.preprofessional
      .map((value) => PREPROFESSIONAL_LABELS[value])
      .filter((label): label is string => Boolean(label));
    if (labels.length > 0) sentence += `, with ${labels.join(", ")} in mind`;
  }
  return `${sentence}.`;
}

export function contextCaption(draft: ContextDraft): string {
  const parts: string[] = [];
  if (draft.country.trim()) parts.push(`your ${draft.country.trim()} residence`);
  if (draft.needAid === "yes") parts.push("financial-aid need");
  if (draft.meritPriority === "yes") parts.push("merit priority");
  if (parts.length === 0) {
    return "These details help Counselle separate attractive options from realistic ones.";
  }
  return `Counselle will consider ${parts.join(", ")}.`;
}

export const SIZE_LABELS: Record<string, string> = { small: "small", medium: "medium", large: "large" };
export const SETTING_LABELS: Record<string, string> = {
  urban: "urban",
  suburban: "suburban",
  college_town: "college town",
  rural: "rural",
};

export function fitCaption(draft: FitDraft): string {
  const parts: string[] = [];
  if (draft.sizes.length > 0 || draft.settings.length > 0) {
    const sizeLabel = draft.sizes.map((size) => SIZE_LABELS[size]).filter(Boolean).join(" or ");
    const settingLabel = draft.settings
      .map((setting) => SETTING_LABELS[setting])
      .filter(Boolean)
      .join(" or ");
    if (sizeLabel && settingLabel) {
      parts.push(`look for ${sizeLabel} schools in ${settingLabel} settings`);
    } else if (sizeLabel) {
      parts.push(`look for ${sizeLabel} schools`);
    } else if (settingLabel) {
      parts.push(`look for schools in ${settingLabel} settings`);
    }
  }
  if (draft.mustHaves.length > 0 || draft.dealbreakers.length > 0) {
    parts.push("protect your non-negotiables");
  }
  if (parts.length === 0) return "Fit is about the life around the degree, not just a ranking.";
  return `Counselle will ${parts.join(" and ")}.`;
}
