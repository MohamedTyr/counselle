import type { OnboardingStep } from "@/api/http/onboarding";

/**
 * sessionStorage persistence for the single active, unfinished onboarding
 * step (plan `02-ui-ux-spec.md` §18). Never localStorage, never the URL.
 * Scoped by user id + onboarding version so a different user or a future
 * schema bump ignores and removes stale drafts instead of hydrating over
 * them.
 */

const DRAFT_VERSION = 1;
const KEY_PREFIX = "counselle.onboarding.draft";

interface StoredDraft {
  userId: string;
  version: number;
  step: OnboardingStep;
  value: unknown;
}

function draftKey(userId: string): string {
  return `${KEY_PREFIX}.${userId}`;
}

export function saveStepDraft(
  userId: string,
  step: OnboardingStep,
  value: unknown,
): void {
  const stored: StoredDraft = { userId, version: DRAFT_VERSION, step, value };
  try {
    window.sessionStorage.setItem(draftKey(userId), JSON.stringify(stored));
  } catch {
    // sessionStorage can throw in private-browsing/storage-full edge cases;
    // losing an autosave draft is not worth crashing the flow over.
  }
}

/** Returns the stored draft only when it matches this user, this draft
 * schema version, and the requested step; otherwise `null` (and any stale
 * entry for another user/version/step is left alone — the caller only ever
 * asks for the step it's about to render). */
export function loadStepDraft<T>(userId: string, step: OnboardingStep): T | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(draftKey(userId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredDraft;
    if (
      parsed.userId !== userId ||
      parsed.version !== DRAFT_VERSION ||
      parsed.step !== step
    ) {
      return null;
    }
    return parsed.value as T;
  } catch {
    return null;
  }
}

export function clearStepDraft(userId: string): void {
  try {
    window.sessionStorage.removeItem(draftKey(userId));
  } catch {
    // Best-effort clear; nothing to recover from here.
  }
}
