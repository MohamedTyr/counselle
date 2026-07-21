import { jsonRequestInit, requestJson } from "@/api/http/client";
import type { MeData, UserSettings } from "@/api/http/auth";

/**
 * Onboarding progress: typed state and safe parsing for `settings.onboarding`.
 *
 * Mirrors `app/onboarding.py` exactly (plan `plans/user-onboarding/README.md`
 * §8, `03-implementation.md` §20.1). Progress is UI flow state, never a copy
 * of Profile answers — see `app/onboarding.py`'s module docstring.
 */

export type OnboardingStatus =
  | "not_started"
  | "in_progress"
  | "deferred"
  | "completed";

export type OnboardingStep =
  | "basics"
  | "academics"
  | "direction"
  | "context"
  | "fit";

export type OnboardingAction = "start" | "advance" | "defer" | "complete";

export interface OnboardingProgress {
  version: number;
  status: OnboardingStatus;
  current_step: OnboardingStep;
  updated_at: string;
  completed_at: string | null;
}

export interface OnboardingCommand {
  action: OnboardingAction;
  step?: OnboardingStep;
}

const ONBOARDING_STATUSES: readonly OnboardingStatus[] = [
  "not_started",
  "in_progress",
  "deferred",
  "completed",
];

const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "basics",
  "academics",
  "direction",
  "context",
  "fit",
];

function parseOnboardingProgressValue(raw: unknown): OnboardingProgress | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const { status, current_step, updated_at, version } = candidate;
  if (
    typeof status !== "string" ||
    !ONBOARDING_STATUSES.includes(status as OnboardingStatus) ||
    typeof current_step !== "string" ||
    !ONBOARDING_STEPS.includes(current_step as OnboardingStep) ||
    typeof updated_at !== "string" ||
    typeof version !== "number"
  ) {
    return null;
  }
  const completedAt = candidate.completed_at;
  if (completedAt !== null && typeof completedAt !== "string") {
    return null;
  }
  return {
    version,
    status: status as OnboardingStatus,
    current_step: current_step as OnboardingStep,
    updated_at,
    completed_at: completedAt,
  };
}

/**
 * Parse `settings.onboarding`. Absent/null and malformed both return `null`
 * — a convenience for call sites (e.g. Profile's "Guided setup" visibility)
 * that only care whether a resumable/complete state exists. This never
 * throws: untrusted server JSON must never crash the app shell.
 */
export function parseOnboardingProgress(
  settings: UserSettings | null | undefined,
): OnboardingProgress | null {
  return parseOnboardingProgressValue(settings?.onboarding);
}

export function getOnboardingProgress(
  me: MeData | null | undefined,
): OnboardingProgress | null {
  return parseOnboardingProgress(me?.settings);
}

/**
 * Discriminated parse used by `OnboardingGate`, which must tell an absent
 * key (a pre-feature "grandfathered" account, README §7.3) apart from a
 * malformed one (a recoverable error, README §20.2) — `parseOnboardingProgress`
 * collapses both to `null` on purpose for simpler call sites that don't
 * need the distinction.
 */
export type OnboardingProgressResult =
  | { kind: "grandfathered" }
  | { kind: "malformed" }
  | { kind: "progress"; progress: OnboardingProgress };

export function parseOnboardingProgressResult(
  settings: UserSettings | null | undefined,
): OnboardingProgressResult {
  const raw = settings?.onboarding;
  if (raw === undefined || raw === null) {
    return { kind: "grandfathered" };
  }
  const progress = parseOnboardingProgressValue(raw);
  return progress ? { kind: "progress", progress } : { kind: "malformed" };
}

export function patchOnboarding(
  command: OnboardingCommand,
): Promise<OnboardingProgress> {
  return requestJson<OnboardingProgress>(
    "/onboarding",
    jsonRequestInit("PATCH", command),
  );
}
