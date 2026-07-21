import type { OnboardingStep } from "@/api/http/onboarding";
import type {
  AcademicDraft,
  ContextDraft,
  OnboardingDraft,
} from "@/features/onboarding/onboarding-profile-patch";

/**
 * Pure, conditional coherence validation only (plan §5.3: no required-field
 * asterisks — every question is optional). A field is invalid only when it
 * was actually entered and is malformed, or when a dependent field is
 * missing (e.g. a GPA scale once a GPA value is entered).
 */
export type OnboardingStepValidation =
  | { valid: true }
  | { valid: false; fieldId: string; message: string };

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

function isNonEmpty(text: string): boolean {
  return text.trim().length > 0;
}

export function isValidDecimalString(text: string): boolean {
  return DECIMAL_PATTERN.test(text.trim());
}

function isValidIntegerInRange(text: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(text.trim())) return false;
  const parsed = Number.parseInt(text.trim(), 10);
  return parsed >= min && parsed <= max;
}

export function validateAcademicDraft(draft: AcademicDraft): OnboardingStepValidation {
  const gpaActive = draft.gpaType === "unweighted" || draft.gpaType === "weighted";
  if (gpaActive && isNonEmpty(draft.gpaValue)) {
    if (!isValidDecimalString(draft.gpaValue) || Number(draft.gpaValue) < 0) {
      return {
        valid: false,
        fieldId: "onboarding-academic-gpa-value",
        message: "Enter a GPA using numbers, such as 3.8.",
      };
    }
    if (!isNonEmpty(draft.gpaScale)) {
      return {
        valid: false,
        fieldId: "onboarding-academic-gpa-scale",
        message: "Add the scale so Counselle reads this GPA correctly.",
      };
    }
    if (!isValidDecimalString(draft.gpaScale) || Number(draft.gpaScale) <= 0) {
      return {
        valid: false,
        fieldId: "onboarding-academic-gpa-scale",
        message: "Enter a scale greater than 0.",
      };
    }
    if (draft.gpaType === "unweighted" && Number(draft.gpaValue) > Number(draft.gpaScale)) {
      return {
        valid: false,
        fieldId: "onboarding-academic-gpa-value",
        message: "An unweighted GPA can’t be higher than its scale.",
      };
    }
  }

  if (draft.satEnabled && isNonEmpty(draft.satTotal) && !isValidIntegerInRange(draft.satTotal, 400, 1600)) {
    return {
      valid: false,
      fieldId: "onboarding-academic-sat-total",
      message: "Enter an SAT total from 400 to 1600.",
    };
  }

  if (draft.actEnabled && isNonEmpty(draft.actComposite) && !isValidIntegerInRange(draft.actComposite, 1, 36)) {
    return {
      valid: false,
      fieldId: "onboarding-academic-act-composite",
      message: "Enter an ACT composite from 1 to 36.",
    };
  }

  return { valid: true };
}

/** Single dispatch point: Basics/Direction/Fit have no coherence checks
 * (plan §5.3), so they always pass. */
export function validateForStep(
  step: OnboardingStep,
  draft: OnboardingDraft,
): OnboardingStepValidation {
  switch (step) {
    case "academics":
      return validateAcademicDraft(draft as AcademicDraft);
    case "context":
      return validateContextDraft(draft as ContextDraft);
    default:
      return { valid: true };
  }
}

export function validateContextDraft(draft: ContextDraft): OnboardingStepValidation {
  if (
    draft.needAid === "yes" &&
    isNonEmpty(draft.budgetPerYear) &&
    (!isValidDecimalString(draft.budgetPerYear) || Number(draft.budgetPerYear) < 0)
  ) {
    return {
      valid: false,
      fieldId: "onboarding-context-budget",
      message: "Enter a yearly budget of 0 or more.",
    };
  }
  return { valid: true };
}
