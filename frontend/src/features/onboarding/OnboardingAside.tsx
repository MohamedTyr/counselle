/**
 * Completion-adjacent visual panel (plan `03-implementation.md` §20.3,
 * `02-ui-ux-spec.md` §12.6). Mirrors the step shell's media panel
 * composition for visual continuity into the very next screen, but carries
 * no step transition, no per-step image swap, and no profile-derived
 * copy of its own — the receipt in `OnboardingCompletion` is the only
 * place Profile facts are shown, so this stays a single static, honest
 * caption about what already happened rather than restating any data.
 */
export function OnboardingAside() {
  return (
    <div className="order-1 hidden lg:order-2 lg:flex lg:h-full lg:flex-col">
      <div className="relative flex-[0_0_72%] overflow-hidden bg-[var(--onboarding-caption-surface)]">
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          src="/onboarding/fit.svg"
        />
      </div>
      <div className="flex flex-[0_0_28%] flex-col justify-center gap-1.5 bg-[var(--onboarding-caption-surface)] px-6 py-5">
        <span className="text-sm font-medium text-[var(--onboarding-foreground)]">
          Ready for your first conversation
        </span>
        <p className="text-sm leading-[1.45] text-[var(--onboarding-foreground-soft)]">
          Counselle already has this context for what you ask next — no need to repeat
          yourself.
        </p>
      </div>
    </div>
  );
}
