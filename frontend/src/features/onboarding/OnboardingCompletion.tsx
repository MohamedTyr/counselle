import { ArrowRightIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import type { Profile } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import { OnboardingAside } from "@/features/onboarding/OnboardingAside";
import { buildOnboardingReceipt } from "@/features/onboarding/onboarding-completion-facts";
import { buildOnboardingPrompts } from "@/features/onboarding/onboarding-prompts";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export interface OnboardingCompletionProps {
  /** The Profile actually returned by the last successful patch write —
   * never an optimistic client-side copy built from form state (README
   * §7.5.4). */
  profile: Profile;
  onAskCounselle: () => void;
  onSelectPrompt: (prompt: string) => void;
  onReviewProfile: () => void;
}

/**
 * The completion/activation view (plan §20.3, §21 Phase 5). Deliberately
 * not a variant of `OnboardingSetup`: that shell's footer is a single
 * Continue/Back pair and its progress bar means "position in a five-step
 * form", neither of which applies once the flow is finished. This keeps
 * the same frame/media-panel visual language for continuity into the next
 * screen while replacing the footer with the completion's own actions. No
 * completion percentage, score, or congratulatory chrome — the tone is a
 * calm, truthful receipt of what was actually saved.
 */
export function OnboardingCompletion({
  profile,
  onAskCounselle,
  onSelectPrompt,
  onReviewProfile,
}: OnboardingCompletionProps) {
  const shouldReduceMotion = useReducedMotion();
  const receipt = buildOnboardingReceipt(profile);
  const hasAnyFact = receipt.length > 0;
  const prompts = buildOnboardingPrompts(profile);

  const frameTransition = shouldReduceMotion
    ? { duration: 0.12 }
    : { duration: 0.24, ease: EASE_OUT };

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--onboarding-page-background)] px-4 py-6 sm:px-6 md:py-10">
      <motion.main
        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={frameTransition}
        className="grid w-full max-w-full grid-cols-1 overflow-hidden rounded-2xl border border-[var(--onboarding-border)] bg-[var(--onboarding-frame-surface)] md:max-w-[680px] lg:max-w-[1120px] lg:grid-cols-[3fr_2fr]"
      >
        <div className="order-2 flex min-h-0 flex-col lg:order-1">
          <div className="m-1.5 flex min-h-0 grow flex-col gap-7 overflow-y-auto rounded-xl bg-[var(--onboarding-form-surface)] px-4 py-6 sm:px-8 sm:py-8">
            <span className="text-sm font-medium text-[var(--onboarding-foreground)]">
              Counselle
            </span>

            <div>
              <h1 className="text-[26px] leading-[1.15] font-semibold tracking-[-0.025em] text-[var(--onboarding-foreground)] text-balance sm:text-[28px]">
                {hasAnyFact ? "Counselle has the essentials" : "You’re ready to start"}
              </h1>
              <p className="mt-1.5 max-w-[60ch] text-[15px] leading-[1.55] text-[var(--onboarding-foreground-soft)] sm:text-base">
                {hasAnyFact
                  ? "Your answers are already part of your Profile, and Counselle can use them in every conversation. You can change or add details anytime."
                  : "Counselle can help without a completed Profile. Add context anytime when you want more tailored answers."}
              </p>
            </div>

            {hasAnyFact ? <OnboardingReceipt groups={receipt} /> : null}

            <div className="flex flex-col gap-4">
              <Button className="w-full sm:w-auto" onClick={onAskCounselle} type="button">
                Ask Counselle
              </Button>

              <div aria-label="Personalized starting prompts" className="flex flex-col gap-1">
                <span className="text-sm text-[var(--onboarding-muted-foreground)]">
                  Or start with what you told us
                </span>
                {prompts.map((entry) => (
                  <button
                    className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-[var(--onboarding-foreground)] transition-colors duration-150 hover:bg-[var(--onboarding-control-hover-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--onboarding-ring)]"
                    key={entry.id}
                    onClick={() => onSelectPrompt(entry.prompt)}
                    type="button"
                  >
                    <span>{entry.prompt}</span>
                    <ArrowRightIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-[var(--onboarding-muted-foreground)] transition-transform duration-150 group-hover:translate-x-0.5"
                    />
                  </button>
                ))}
              </div>

              <button
                className="self-start text-sm text-[var(--onboarding-muted-foreground)] underline-offset-4 transition-colors hover:text-[var(--onboarding-foreground-soft)] hover:underline"
                onClick={onReviewProfile}
                type="button"
              >
                Review your full Profile
              </button>
            </div>
          </div>
        </div>

        <OnboardingAside />
      </motion.main>
    </div>
  );
}

function OnboardingReceipt({
  groups,
}: {
  groups: { label: string; value: string }[];
}) {
  return (
    <dl className="flex flex-col gap-3 border-t border-[var(--onboarding-border-soft)] pt-5">
      {groups.map((group) => (
        <div key={group.label}>
          <dt className="text-[15px] font-medium text-[var(--onboarding-foreground)]">
            {group.label}
          </dt>
          <dd className="mt-0.5 text-sm leading-[1.5] text-[var(--onboarding-foreground-soft)]">
            {group.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
