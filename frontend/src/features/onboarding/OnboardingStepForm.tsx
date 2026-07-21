import type { Profile } from "@/api/workspace/types";
import type { OnboardingStep } from "@/api/http/onboarding";
import {
  OnboardingSetup,
  type OnboardingSaveStatus,
} from "@/components/ui/onboarding-setup";
import type {
  AcademicDraft,
  BasicsDraft,
  ContextDraft,
  DirectionDraft,
  FitDraft,
  OnboardingDraft,
} from "@/features/onboarding/onboarding-profile-patch";
import {
  academicCaption,
  basicsCaption,
  contextCaption,
  directionCaption,
  fitCaption,
} from "@/features/onboarding/onboarding-captions";
import { ONBOARDING_STEP_META, ONBOARDING_TOTAL_STEPS } from "@/features/onboarding/onboarding-steps";
import { AcademicStep } from "@/features/onboarding/steps/AcademicStep";
import { BasicsStep } from "@/features/onboarding/steps/BasicsStep";
import { ContextStep } from "@/features/onboarding/steps/ContextStep";
import { DirectionStep } from "@/features/onboarding/steps/DirectionStep";
import { FitStep } from "@/features/onboarding/steps/FitStep";

interface FieldError {
  fieldId: string;
  message: string;
}

interface OnboardingStepFormProps {
  canGoBack: boolean;
  draft: OnboardingDraft;
  error?: FieldError;
  isSaving: boolean;
  onBack: () => void;
  onContinue: () => void;
  onDefer: () => void;
  onDraftChange: (next: OnboardingDraft) => void;
  profile: Profile | undefined;
  saveError?: string;
  saveStatus: OnboardingSaveStatus;
  stepId: OnboardingStep;
}

/** Common shell wrapper (plan §20.3): dispatches to the right step's form
 * body and caption, and wires the shared save/focus/error chrome that every
 * step needs identically. Save/progress sequencing itself lives in
 * `OnboardingRoute`, which owns the Profile and progress mutations. */
export function OnboardingStepForm({
  canGoBack,
  draft,
  error,
  isSaving,
  onBack,
  onContinue,
  onDefer,
  onDraftChange,
  profile,
  saveError,
  saveStatus,
  stepId,
}: OnboardingStepFormProps) {
  const meta = ONBOARDING_STEP_META[stepId];

  return (
    <OnboardingSetup
      canGoBack={canGoBack}
      continueLabel={meta.continueLabel}
      description={meta.description}
      error={saveError}
      isSaving={isSaving}
      media={{
        alt: "",
        caption: captionFor(stepId, draft),
        src: meta.mediaSrc,
      }}
      onBack={onBack}
      onContinue={onContinue}
      onDefer={onDefer}
      saveStatus={saveStatus}
      step={meta.stepNumber}
      title={meta.title}
      totalSteps={ONBOARDING_TOTAL_STEPS}
    >
      {renderStep(stepId, draft, onDraftChange, profile, error)}
    </OnboardingSetup>
  );
}

function captionFor(stepId: OnboardingStep, draft: OnboardingDraft): string {
  switch (stepId) {
    case "basics":
      return basicsCaption(draft as BasicsDraft);
    case "academics":
      return academicCaption(draft as AcademicDraft);
    case "direction":
      return directionCaption(draft as DirectionDraft);
    case "context":
      return contextCaption(draft as ContextDraft);
    case "fit":
      return fitCaption(draft as FitDraft);
  }
}

function renderStep(
  stepId: OnboardingStep,
  draft: OnboardingDraft,
  onDraftChange: (next: OnboardingDraft) => void,
  profile: Profile | undefined,
  error: FieldError | undefined,
) {
  switch (stepId) {
    case "basics":
      return (
        <BasicsStep
          onChange={onDraftChange as (next: BasicsDraft) => void}
          value={draft as BasicsDraft}
        />
      );
    case "academics":
      return (
        <AcademicStep
          error={error}
          onChange={onDraftChange as (next: AcademicDraft) => void}
          profile={profile}
          value={draft as AcademicDraft}
        />
      );
    case "direction":
      return (
        <DirectionStep
          onChange={onDraftChange as (next: DirectionDraft) => void}
          value={draft as DirectionDraft}
        />
      );
    case "context":
      return (
        <ContextStep
          error={error}
          onChange={onDraftChange as (next: ContextDraft) => void}
          value={draft as ContextDraft}
        />
      );
    case "fit":
      return (
        <FitStep
          onChange={onDraftChange as (next: FitDraft) => void}
          value={draft as FitDraft}
        />
      );
  }
}
