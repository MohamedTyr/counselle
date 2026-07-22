/**
 * Onboarding-completion AI handoff (plan `03-implementation.md` §20.7).
 * A student picking a personalized starting prompt on the onboarding
 * completion view opens `/app/ai` with `{ draftPrompt }` in router state;
 * this only ever prefills the composer's editable value. It never submits
 * anything — that happens exclusively through the composer's own Send
 * action.
 */
const MAX_DRAFT_PROMPT_LENGTH = 2000;

/** Returns a trimmed, non-empty, length-bounded draft prompt from router
 * state, or `null` for anything else (missing, wrong type, empty after
 * trimming, or implausibly long). */
export function parseDraftPromptState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as { draftPrompt?: unknown }).draftPrompt;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DRAFT_PROMPT_LENGTH) return null;
  return trimmed;
}
