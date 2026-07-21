import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import type { OnboardingCommand, OnboardingStep } from "@/api/http/onboarding";
import { parseOnboardingProgressResult } from "@/api/http/onboarding";
import { useMe, useUpdateOnboardingProgress } from "@/app/auth";
import type { OnboardingLocationState } from "@/app/auth/OnboardingGate";
import { useProfile, useUpdateProfile } from "@/api/workspace/hooks/profile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import type { OnboardingSaveStatus } from "@/components/ui/onboarding-setup";
import { Spinner } from "@/components/ui/spinner";
import { clearStepDraft, loadStepDraft, saveStepDraft } from "@/features/onboarding/onboarding-draft";
import {
  buildPatchForStep,
  hydrateDraftForStep,
  type OnboardingDraft,
} from "@/features/onboarding/onboarding-profile-patch";
import { ONBOARDING_STEP_ORDER } from "@/features/onboarding/onboarding-steps";
import { validateForStep } from "@/features/onboarding/onboarding-validation";
import { OnboardingStepForm } from "@/features/onboarding/OnboardingStepForm";

interface FieldError {
  fieldId: string;
  message: string;
}

/**
 * Orchestration-only (plan §20.3/§21 Phase 4): loads Profile, hydrates each
 * step from existing values, sequences save (Profile patch write) before
 * progress advance (README §5.10 — a step is never marked complete if its
 * Profile patch failed), and handles Back/Defer/resume. Question content
 * and patch/validation rules live in the step components and the pure
 * `onboarding-profile-patch`/`onboarding-validation` modules.
 */
export function OnboardingRoute() {
  const meQuery = useMe();
  const profileQuery = useProfile();
  const updateProgress = useUpdateOnboardingProgress();
  const updateProfile = useUpdateProfile();
  const navigate = useNavigate();
  const location = useLocation();

  const hasRequestedStart = useRef(false);
  const [visibleStepIndex, setVisibleStepIndex] = useState<number | null>(null);
  // Paired with the step it was hydrated for, so a render can never apply a
  // stale previous step's draft shape to the step now being displayed (the
  // draft-hydration effect below runs one render after `stepId` changes).
  const [draftState, setDraftState] = useState<{
    step: OnboardingStep;
    value: OnboardingDraft;
  } | null>(null);
  const [fieldError, setFieldError] = useState<FieldError | undefined>(undefined);
  const [saveStatus, setSaveStatus] = useState<OnboardingSaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [pendingProgressRetry, setPendingProgressRetry] = useState<OnboardingCommand | null>(null);

  const result = meQuery.data
    ? parseOnboardingProgressResult(meQuery.data.settings)
    : null;
  const progress = result?.kind === "progress" ? result.progress : null;
  const userId = meQuery.data?.id ?? null;
  const profile = profileQuery.data;

  const needsStart =
    result !== null &&
    (!progress || progress.status === "deferred" || progress.status === "not_started");

  useEffect(() => {
    if (needsStart && !hasRequestedStart.current) {
      hasRequestedStart.current = true;
      updateProgress.mutate({ action: "start" });
    }
  }, [needsStart, updateProgress]);

  // Seed the visible step index once, from the persisted current step, then
  // let Back/Continue own it from there. Back is local-only UI state
  // (README §8): it must never regress `current_step` on the server, so
  // once seeded this pointer stops tracking `progress` entirely. Adjusting
  // state during render (rather than in an effect) is the React-documented
  // pattern for this kind of one-time derivation — see `onboarding-setup.tsx`
  // for the same pattern already used in this feature.
  if (visibleStepIndex === null && progress) {
    setVisibleStepIndex(ONBOARDING_STEP_ORDER.indexOf(progress.current_step));
  }

  const stepId: OnboardingStep | null =
    visibleStepIndex !== null ? ONBOARDING_STEP_ORDER[visibleStepIndex] : null;

  // Hydrate the draft whenever the visible step changes: prefer a same-user
  // session draft over the loaded Profile (plan §18), falling back to the
  // server Profile otherwise. Same render-time-adjustment pattern as above.
  if (stepId && userId && profileQuery.isSuccess && draftState?.step !== stepId) {
    const stored = loadStepDraft<OnboardingDraft>(userId, stepId);
    setDraftState({ step: stepId, value: stored ?? hydrateDraftForStep(stepId, profile) });
    setFieldError(undefined);
    setSaveStatus("idle");
    setSaveError(undefined);
    setPendingProgressRetry(null);
  }

  const draft = draftState?.step === stepId ? draftState.value : null;

  function handleDraftChange(next: OnboardingDraft) {
    if (!stepId) return;
    setDraftState({ step: stepId, value: next });
    setFieldError(undefined);
    if (userId) saveStepDraft(userId, stepId, next);
  }

  function handleDefer() {
    const state = location.state as OnboardingLocationState | null;
    setSaveStatus("saving");
    updateProgress.mutate(
      { action: "defer" },
      {
        onSuccess: () => {
          const returnTo = state?.returnTo;
          navigate(
            returnTo
              ? { pathname: returnTo.pathname, search: returnTo.search, hash: returnTo.hash }
              : "/app/ai",
            { replace: true },
          );
        },
        onError: () => setSaveStatus("idle"),
      },
    );
  }

  function handleBack() {
    setFieldError(undefined);
    setSaveError(undefined);
    setVisibleStepIndex((current) => (current !== null ? Math.max(0, current - 1) : current));
  }

  async function handleContinue() {
    if (!stepId || !draft || !userId) return;

    if (pendingProgressRetry) {
      setSaveStatus("saving");
      try {
        await updateProgress.mutateAsync(pendingProgressRetry);
        finishStepSuccess(userId, stepId);
      } catch {
        setSaveStatus("error");
        setSaveError(
          "Your answers were saved, but we couldn’t move to the next step. Try again.",
        );
      }
      return;
    }

    const validation = validateForStep(stepId, draft);
    if (!validation.valid) {
      setFieldError({ fieldId: validation.fieldId, message: validation.message });
      focusField(validation.fieldId);
      return;
    }

    setSaveStatus("saving");
    setSaveError(undefined);
    const patch = buildPatchForStep(stepId, draft, profile);
    const hasPatch = Object.keys(patch).length > 0;

    if (hasPatch) {
      try {
        await updateProfile.mutateAsync(patch);
      } catch {
        setSaveStatus("error");
        setSaveError("We couldn’t save this step. Your answers are still here.");
        return;
      }
    }

    const isLastStep = stepId === "fit";
    const command: OnboardingCommand = isLastStep
      ? { action: "complete", step: "fit" }
      : { action: "advance", step: stepId };

    try {
      await updateProgress.mutateAsync(command);
      finishStepSuccess(userId, stepId);
    } catch {
      setPendingProgressRetry(command);
      setSaveStatus("error");
      setSaveError(
        "Your answers were saved, but we couldn’t move to the next step. Try again.",
      );
    }
  }

  function finishStepSuccess(currentUserId: string, currentStepId: OnboardingStep) {
    clearStepDraft(currentUserId);
    setPendingProgressRetry(null);
    setSaveStatus("saved");
    if (currentStepId !== "fit") {
      setVisibleStepIndex((current) => (current !== null ? current + 1 : current));
    }
  }

  if (meQuery.isPending || !progress || profileQuery.isPending || !userId) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  if (profileQuery.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle render={<h1 />}>We couldn’t load your Profile</CardTitle>
            <CardDescription>
              Your saved information is still safe. Try again before continuing.
            </CardDescription>
          </CardHeader>
          <CardPanel className="flex gap-2">
            <Button onClick={() => void profileQuery.refetch()} type="button">
              Try again
            </Button>
            <Button onClick={handleDefer} type="button" variant="outline">
              Do this later
            </Button>
          </CardPanel>
        </Card>
      </div>
    );
  }

  const isCompleted = progress.status === "completed";

  if (isCompleted) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle render={<h1 />}>Counselle has the essentials</CardTitle>
            <CardDescription>
              Your answers are already part of your Profile, and Counselle can use them
              in every conversation. You can change or add details anytime.
            </CardDescription>
          </CardHeader>
          <CardPanel className="flex gap-2">
            <Button onClick={() => navigate("/app/ai")} type="button">
              Ask Counselle
            </Button>
          </CardPanel>
        </Card>
      </div>
    );
  }

  if (!stepId || !draft) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  return (
    <OnboardingStepForm
      canGoBack={visibleStepIndex !== null && visibleStepIndex > 0}
      draft={draft}
      error={fieldError}
      isSaving={saveStatus === "saving"}
      onBack={handleBack}
      onContinue={() => void handleContinue()}
      onDefer={handleDefer}
      onDraftChange={handleDraftChange}
      profile={profile}
      saveError={saveError}
      saveStatus={saveStatus}
      stepId={stepId}
    />
  );
}

function focusField(fieldId: string) {
  // Defer to the next frame so the error region has rendered (and the field
  // is on screen) before we try to move focus into it.
  requestAnimationFrame(() => {
    document.getElementById(fieldId)?.focus();
  });
}
