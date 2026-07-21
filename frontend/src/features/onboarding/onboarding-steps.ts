import type { OnboardingStep } from "@/api/http/onboarding";

/**
 * Static per-step copy and media (plan `01-questions-and-data.md` §9,
 * `02-ui-ux-spec.md` §12.6). The dynamic "after answers" caption sentence is
 * computed per step from the current draft — see each step's `*Caption`
 * export in `steps/*Step.tsx` — because it depends on values entered, not on
 * anything static.
 */
export const ONBOARDING_STEP_ORDER: readonly OnboardingStep[] = [
  "basics",
  "academics",
  "direction",
  "context",
  "fit",
];

export interface OnboardingStepMeta {
  stepNumber: number;
  title: string;
  description: string;
  mediaSrc: string;
  mediaCaptionBeforeAnswers: string;
  continueLabel: string;
}

export const ONBOARDING_STEP_META: Record<OnboardingStep, OnboardingStepMeta> = {
  basics: {
    stepNumber: 1,
    title: "Let’s make Counselle yours",
    description:
      "A few details make every answer more useful. This takes about 3 minutes, and everything is optional and editable from Profile.",
    mediaSrc: "/onboarding/basics.svg",
    mediaCaptionBeforeAnswers: "Your timeline helps Counselle make advice timely.",
    continueLabel: "Continue",
  },
  academics: {
    stepNumber: 2,
    title: "Your academic snapshot",
    description:
      "Add only the headline numbers you know today. The full academic record belongs in Profile or your documents.",
    mediaSrc: "/onboarding/academic.svg",
    mediaCaptionBeforeAnswers: "A quick snapshot is enough to begin.",
    continueLabel: "Continue",
  },
  direction: {
    stepNumber: 3,
    title: "What are you drawn to?",
    description:
      "A direction helps Counselle evaluate programs without locking you into a decision.",
    mediaSrc: "/onboarding/direction.svg",
    mediaCaptionBeforeAnswers:
      "Direction changes which programs and pathways are worth considering.",
    continueLabel: "Continue",
  },
  context: {
    stepNumber: 4,
    title: "Context that changes the advice",
    description:
      "Location, citizenship, and cost can change which options are realistic. Share only what you’re comfortable sharing.",
    mediaSrc: "/onboarding/context.svg",
    mediaCaptionBeforeAnswers:
      "These details help Counselle separate attractive options from realistic ones.",
    continueLabel: "Continue",
  },
  fit: {
    stepNumber: 5,
    title: "What feels like a fit?",
    description:
      "Only choose preferences that genuinely matter. Leaving something blank keeps your options open.",
    mediaSrc: "/onboarding/fit.svg",
    mediaCaptionBeforeAnswers: "Fit is about the life around the degree, not just a ranking.",
    continueLabel: "Finish setup",
  },
};

export const ONBOARDING_TOTAL_STEPS = ONBOARDING_STEP_ORDER.length;
