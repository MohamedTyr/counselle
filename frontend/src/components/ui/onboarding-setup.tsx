"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Generic Watermelon-derived onboarding shell (plan `02-ui-ux-spec.md` §11.4).
 * Presentation only: composition, tokens, motion, and focus/loading/error
 * chrome. It never knows about Profile fields — the caller supplies the
 * question content as `children` and the step copy/media as props.
 */
export interface OnboardingMedia {
  src: string;
  alt: "";
  position?: string;
  caption: ReactNode;
}

export type OnboardingSaveStatus = "idle" | "saving" | "saved" | "error";

export interface OnboardingSetupProps {
  step: number;
  totalSteps: number;
  title: string;
  description: string;
  children: ReactNode;
  media: OnboardingMedia;
  canGoBack: boolean;
  continueLabel: string;
  isSaving: boolean;
  saveStatus?: OnboardingSaveStatus;
  error?: string;
  /**
   * Called on Back. Per spec §15.12 ("Rapid double-clicks cannot queue
   * multiple transitions or writes"), the caller must synchronously flip
   * `isSaving` to true when starting work. The shell also guards against
   * duplicate clicks internally as defense in depth.
   */
  onBack: () => void;
  /**
   * Called on Continue. Per spec §15.12 ("Rapid double-clicks cannot queue
   * multiple transitions or writes"), the caller must synchronously flip
   * `isSaving` to true when starting work. The shell also guards against
   * duplicate clicks internally as defense in depth.
   */
  onContinue: () => void;
  onDefer: () => void;
}

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const stepVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction > 0 ? 16 : -16 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction > 0 ? -12 : 12 }),
};

const stepVariantsReduced = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

export function OnboardingSetup({
  step,
  totalSteps,
  title,
  description,
  children,
  media,
  canGoBack,
  continueLabel,
  isSaving,
  saveStatus = "idle",
  error,
  onBack,
  onContinue,
  onDefer,
}: OnboardingSetupProps) {
  const shouldReduceMotion = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorId = useId();
  const statusId = useId();

  // Defense-in-depth guard for spec §15.12 ("Rapid double-clicks cannot
  // queue multiple transitions or writes"). `isSaving` should already
  // disable/loading-gate the Continue button, but that depends on the
  // caller setting it synchronously. This ref blocks re-dispatch of the
  // same submit (via Enter or button click, both route through form
  // submission) until the `isSaving` prop actually flips.
  const submitDispatchedRef = useRef(false);

  useEffect(() => {
    submitDispatchedRef.current = isSaving;
  }, [isSaving]);

  function guardedOnContinue() {
    if (submitDispatchedRef.current) return;
    submitDispatchedRef.current = true;
    onContinue();
  }

  // Derive forward/back motion direction from the previous render's step
  // without reading a ref during render (see React docs on adjusting state
  // during rendering — this is the sanctioned pattern for that).
  const [prevStep, setPrevStep] = useState(step);
  const [direction, setDirection] = useState(1);
  if (step !== prevStep) {
    setDirection(step > prevStep ? 1 : -1);
    setPrevStep(step);
  }

  useEffect(() => {
    // First paint has no entrance transition to wait out; focus immediately.
    headingRef.current?.focus();
  }, []);

  const frameTransition = shouldReduceMotion
    ? { duration: 0.12 }
    : { duration: 0.22, ease: EASE_OUT };

  function focusHeadingOnEnter(definition: string) {
    if (definition === "center") {
      headingRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--onboarding-page-background)] px-4 py-6 sm:px-6 md:py-10">
      <motion.main
        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={frameTransition}
        className="grid w-full max-w-full grid-cols-1 overflow-hidden rounded-2xl border border-[var(--onboarding-border)] bg-[var(--onboarding-frame-surface)] md:max-w-[680px] lg:max-w-[1120px] lg:grid-cols-[3fr_2fr]"
      >
        {/*
         * Step-change announcement (spec §16): announces "Step N of M,
         * <title>" whenever `step` changes. Kept separate from
         * OnboardingStatusRow's live region, which only announces
         * save status and can fire independently.
         */}
        <div aria-live="polite" className="sr-only" role="status">
          {`Step ${step} of ${totalSteps}, ${title}`}
        </div>

        <form
          className="order-2 flex min-h-0 flex-col lg:order-1"
          noValidate
          onSubmit={(event) => {
            // Spec §15.3: Enter submits from a normal text/number field only
            // when no combobox/tag menu is open. Native form submission
            // already gives us that for free — a tag input commits its own
            // Enter (see OnboardingTagInput) and an open Select/Popover
            // listbox consumes Enter itself, so only a plain field's Enter
            // (or a Continue click) reaches here.
            event.preventDefault();
            guardedOnContinue();
          }}
        >
          <div className="m-1.5 flex min-h-0 grow flex-col rounded-xl bg-[var(--onboarding-form-surface)] px-4 pt-5 pb-4 sm:px-8 sm:pt-7 sm:pb-6">
            <OnboardingBrandRow isSaving={isSaving} onDefer={onDefer} />
            <OnboardingProgress step={step} totalSteps={totalSteps} />

            <OnboardingStepContent
              description={description}
              direction={direction}
              headingRef={headingRef}
              media={media}
              onAnimationComplete={focusHeadingOnEnter}
              shouldReduceMotion={Boolean(shouldReduceMotion)}
              step={step}
              title={title}
            >
              {children}
            </OnboardingStepContent>

            <OnboardingStatusRow
              error={error}
              errorId={errorId}
              saveStatus={saveStatus}
              statusId={statusId}
            />
          </div>

          <OnboardingFooter
            canGoBack={canGoBack}
            continueLabel={continueLabel}
            errorId={error ? errorId : undefined}
            isSaving={isSaving}
            onBack={onBack}
          />
        </form>

        <OnboardingMediaPanel
          media={media}
          shouldReduceMotion={Boolean(shouldReduceMotion)}
        />
      </motion.main>
    </div>
  );
}

function OnboardingStepContent({
  children,
  description,
  direction,
  headingRef,
  media,
  onAnimationComplete,
  shouldReduceMotion,
  step,
  title,
}: {
  children: ReactNode;
  description: string;
  direction: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  media: OnboardingMedia;
  onAnimationComplete: (definition: string) => void;
  shouldReduceMotion: boolean;
  step: number;
  title: string;
}) {
  return (
    <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
      <AnimatePresence custom={direction} initial={false} mode="wait">
        <motion.div
          key={step}
          custom={direction}
          variants={shouldReduceMotion ? stepVariantsReduced : stepVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            duration: shouldReduceMotion ? 0.1 : 0.21,
            ease: EASE_OUT,
          }}
          onAnimationComplete={onAnimationComplete}
        >
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-[26px] leading-[1.15] font-semibold tracking-[-0.025em] text-[var(--onboarding-foreground)] outline-none sm:text-[28px]"
          >
            {title}
          </h1>
          <p className="mt-1.5 max-w-[60ch] text-[15px] leading-[1.55] text-[var(--onboarding-foreground-soft)] sm:text-base">
            {description}
          </p>

          {media.caption ? (
            <p className="mt-4 text-sm leading-[1.5] text-[var(--onboarding-foreground-soft)] lg:hidden">
              {media.caption}
            </p>
          ) : null}

          <div className="mt-6">{children}</div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function OnboardingBrandRow({
  isSaving,
  onDefer,
}: {
  isSaving: boolean;
  onDefer: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-[var(--onboarding-foreground)]">
        Counselle
      </span>
      <button
        className="text-sm text-[var(--onboarding-muted-foreground)] underline-offset-4 transition-colors hover:text-[var(--onboarding-foreground-soft)] hover:underline disabled:pointer-events-none disabled:opacity-50"
        disabled={isSaving}
        onClick={onDefer}
        type="button"
      >
        Do this later
      </button>
    </div>
  );
}

function OnboardingProgress({
  step,
  totalSteps,
}: {
  step: number;
  totalSteps: number;
}) {
  const segments = Array.from({ length: totalSteps });

  return (
    <div className="mt-5 flex items-center gap-3">
      <div
        aria-label={`Step ${step} of ${totalSteps}`}
        aria-valuemax={totalSteps}
        aria-valuemin={1}
        aria-valuenow={step}
        className="flex flex-1 gap-1.5"
        role="progressbar"
      >
        {segments.map((_, index) => (
          <span
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-150",
              index < step
                ? "bg-[var(--onboarding-primary)]"
                : "bg-[var(--onboarding-border)]",
            )}
            key={index}
          />
        ))}
      </div>
      <span className="shrink-0 text-sm whitespace-nowrap text-[var(--onboarding-muted-foreground)]">
        Step {step} of {totalSteps}
      </span>
    </div>
  );
}

function OnboardingStatusRow({
  error,
  errorId,
  saveStatus,
  statusId,
}: {
  error?: string;
  errorId: string;
  saveStatus: OnboardingSaveStatus;
  statusId: string;
}) {
  const statusText =
    saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "";

  return (
    <>
      <div className="sr-only" id={statusId} role="status">
        {statusText}
      </div>
      {error ? (
        <div
          className="mt-4 rounded-lg bg-[var(--onboarding-error-surface)] px-4 py-3 text-sm text-[var(--onboarding-error-foreground)]"
          id={errorId}
          role="alert"
        >
          {error}
        </div>
      ) : null}
    </>
  );
}

function OnboardingFooter({
  canGoBack,
  continueLabel,
  errorId,
  isSaving,
  onBack,
}: {
  canGoBack: boolean;
  continueLabel: string;
  errorId?: string;
  isSaving: boolean;
  onBack: () => void;
}) {
  // Defense-in-depth guard for spec §15.12 ("Rapid double-clicks cannot
  // queue multiple transitions or writes"). Back's handler is a synchronous,
  // local-only step decrement (it never flips `isSaving`), so the guard
  // can't wait on `isSaving` resetting it — that never happens, which would
  // otherwise permanently disable the button after its first use. Reset
  // immediately after the synchronous call instead; the JS event loop can't
  // deliver a second click event "inside" this one, so this still collapses
  // a genuine double-fire without wedging the button shut.
  const dispatchedRef = useRef(false);

  function guardedOnBack() {
    if (dispatchedRef.current) return;
    dispatchedRef.current = true;
    onBack();
    dispatchedRef.current = false;
  }

  return (
    <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[var(--onboarding-border-soft)] bg-[var(--onboarding-form-surface)] px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:static sm:border-t-0 sm:bg-transparent sm:px-8 sm:pt-0 sm:pb-6">
      {canGoBack ? (
        <Button
          disabled={isSaving}
          onClick={guardedOnBack}
          type="button"
          variant="outline"
        >
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button
        aria-describedby={errorId}
        className="w-full sm:w-auto"
        loading={isSaving}
        type="submit"
      >
        {continueLabel}
      </Button>
    </div>
  );
}

function OnboardingMediaPanel({
  media,
  shouldReduceMotion,
}: {
  media: OnboardingMedia;
  shouldReduceMotion: boolean;
}) {
  const transition = shouldReduceMotion
    ? { duration: 0.1 }
    : { duration: 0.26, ease: EASE_OUT };

  return (
    <div className="order-1 hidden lg:order-2 lg:flex lg:h-full lg:flex-col">
      <div className="relative flex-[0_0_72%] overflow-hidden bg-[var(--onboarding-caption-surface)]">
        <AnimatePresence mode="popLayout">
          <motion.img
            alt={media.alt}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 h-full w-full object-cover"
            exit={{ opacity: 0 }}
            initial={
              shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.015 }
            }
            key={media.src}
            src={media.src}
            style={media.position ? { objectPosition: media.position } : undefined}
            transition={transition}
          />
        </AnimatePresence>
      </div>
      <div className="flex flex-[0_0_28%] flex-col justify-center gap-1.5 bg-[var(--onboarding-caption-surface)] px-6 py-5">
        <span className="text-sm font-medium text-[var(--onboarding-foreground)]">
          What Counselle will keep in mind
        </span>
        <p className="text-sm leading-[1.45] text-[var(--onboarding-foreground-soft)]">
          {media.caption}
        </p>
      </div>
    </div>
  );
}
