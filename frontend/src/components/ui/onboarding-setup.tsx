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

  // Mirrors the latest `isSaving` prop unconditionally on every render (not
  // gated behind a dependency-array effect below), so it is always accurate
  // even on a render where `isSaving` didn't change value. `guardedOnContinue`
  // needs that: the caller (`OnboardingRoute.handleContinue`) can validate
  // the draft and return *before* ever flipping `isSaving` to `true` (e.g.
  // client-side validation failure). In that case the `[isSaving]` effect
  // below never reruns — the value never changed — so it alone can't be
  // trusted to release the guard.
  const isSavingRef = useRef(isSaving);
  isSavingRef.current = isSaving;

  useEffect(() => {
    submitDispatchedRef.current = isSaving;
  }, [isSaving]);

  function guardedOnContinue() {
    if (submitDispatchedRef.current) return;
    submitDispatchedRef.current = true;
    onContinue();
    // If `onContinue` returned without ever entering a saving state (e.g.
    // a validation failure short-circuits before the caller sets
    // `isSaving`), release the guard so the next Continue click (with
    // corrected input) isn't silently swallowed. `requestAnimationFrame`
    // (not `queueMicrotask`) is required here: `isSavingRef.current` is
    // only guaranteed current once React has committed the render(s)
    // triggered synchronously by this click and flushed their passive
    // effects, and passive effects are scheduled on a macrotask, not a
    // microtask — a `queueMicrotask` callback can run before that flush
    // completes. `requestAnimationFrame` fires after the browser's
    // per-frame work (which includes that effect flush), matching the
    // same assumption `OnboardingRoute.focusField` already relies on
    // elsewhere in this feature.
    requestAnimationFrame(() => {
      if (!isSavingRef.current) {
        submitDispatchedRef.current = false;
      }
    });
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
    <div className="flex min-h-dvh w-full items-center justify-center bg-[var(--onboarding-page-background)] px-4 py-8 sm:px-6 md:py-14">
      <motion.main
        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={frameTransition}
        className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-[var(--onboarding-border)] bg-[var(--onboarding-frame-surface)] shadow-[var(--elevation-1)]"
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
          className="flex min-h-0 flex-col"
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
          <div className="m-1.5 flex min-h-0 grow flex-col rounded-xl bg-[var(--onboarding-form-surface)] px-6 pt-6 pb-5 sm:px-10 sm:pt-9 sm:pb-7">
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
            <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-[var(--onboarding-caption-surface)] px-3.5 py-3">
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-[var(--onboarding-primary)]"
              />
              <p className="text-[13px] leading-[1.5] text-[var(--onboarding-foreground-soft)]">
                {media.caption}
              </p>
            </div>
          ) : null}

          <div className="mt-7">{children}</div>
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
    <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[var(--onboarding-border-soft)] bg-[var(--onboarding-form-surface)] px-6 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:static sm:border-t-0 sm:bg-transparent sm:px-10 sm:py-5">
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

