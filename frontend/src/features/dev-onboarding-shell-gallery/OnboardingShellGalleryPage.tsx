import { useState } from "react";

import {
  OnboardingSetup,
  type OnboardingSaveStatus,
} from "@/components/ui/onboarding-setup";

/**
 * Dev-only harness for the Phase 3 shell (never linked from product nav —
 * mirrors the `/dev/tool-calls` gallery convention). Exercises the shell's
 * loading/error/back/defer states with a trivial placeholder body so the
 * composition, tokens, and motion can be verified in a real browser at the
 * required viewports before Phase 4 wires in real question content.
 */
const STATES: ReadonlyArray<Readonly<{ label: string; value: OnboardingSaveStatus }>> = [
  { label: "Idle", value: "idle" },
  { label: "Saving", value: "saving" },
  { label: "Saved", value: "saved" },
  { label: "Error", value: "error" },
];

const TOTAL_STEPS = 5;

export function OnboardingShellGalleryPage() {
  const [step, setStep] = useState(1);
  const [saveStatus, setSaveStatus] = useState<OnboardingSaveStatus>("idle");

  const isSaving = saveStatus === "saving";
  const hasError = saveStatus === "error";

  return (
    <div className="min-h-dvh bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--edge)] bg-background px-4 py-3">
        <span className="text-xs text-muted-foreground">Onboarding shell gallery</span>
        {STATES.map((state) => (
          <button
            className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent"
            key={state.value}
            onClick={() => setSaveStatus(state.value)}
            type="button"
          >
            {state.label}
          </button>
        ))}
      </div>
      <OnboardingSetup
        canGoBack={step > 1}
        continueLabel={step === TOTAL_STEPS ? "Finish" : "Continue"}
        description="This is placeholder copy standing in for the real question body Phase 4 will build. It exercises heading/description length and layout only."
        error={hasError ? "We couldn't save this step. Your answers are still here." : undefined}
        isSaving={isSaving}
        media={{
          alt: "",
          caption:
            "A short, truthful sentence summarizing what was entered so far will render here once real data exists.",
          src: `/onboarding/${STEP_IMAGES[step - 1]}.svg`,
        }}
        onBack={() => setStep((current) => Math.max(1, current - 1))}
        onContinue={() => setStep((current) => Math.min(TOTAL_STEPS, current + 1))}
        onDefer={() => {
          // Dev harness only: no route to leave to.
        }}
        saveStatus={saveStatus}
        step={step}
        title={STEP_TITLES[step - 1]}
        totalSteps={TOTAL_STEPS}
      >
        <p className="text-sm text-[var(--onboarding-muted-foreground)]">
          Step content placeholder — Phase 4 replaces this with the real form fields.
        </p>
      </OnboardingSetup>
    </div>
  );
}

const STEP_TITLES = [
  "What should we call you?",
  "Where are you academically?",
  "What are you drawn to?",
  "What's your context?",
  "What matters in a fit?",
];

const STEP_IMAGES = ["basics", "academic", "direction", "context", "fit"];
