import type { Profile } from "@/api/workspace/types";

/**
 * Deterministic completion starting-prompt selection (plan
 * `01-questions-and-data.md` §9 Fit "Completion state" / README §7.5.5).
 * Pure function of the returned Profile — never a model call, never
 * invented facts. Always returns exactly three prompts; each one either
 * references a fact actually present on the Profile or falls back to the
 * documented generic phrasing when that fact is absent.
 */
export interface OnboardingPrompt {
  id: "timeline" | "direction" | "affordability";
  prompt: string;
}

function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function timelinePrompt(profile: Profile | undefined): OnboardingPrompt {
  const basics = profile?.basics;
  const hasTimeline = Boolean(basics?.grade_level) || basics?.graduation_year != null;
  return {
    id: "timeline",
    prompt: hasTimeline
      ? "What should I focus on next for my application timeline?"
      : "Help me figure out the best place to start.",
  };
}

function directionPrompt(profile: Profile | undefined): OnboardingPrompt {
  const majors = profile?.interests?.intended_majors ?? [];
  return {
    id: "direction",
    prompt:
      majors.length > 0
        ? `Help me build a starting school list around ${joinWithAnd(majors)}.`
        : "Help me build a starting school list around what I want to study.",
  };
}

function affordabilityPrompt(profile: Profile | undefined): OnboardingPrompt {
  const aid = profile?.aid;
  const needsAid = aid?.need_aid === true;
  const hasBudget = Boolean(aid?.budget_per_year);

  let prompt: string;
  if (needsAid && hasBudget) {
    prompt = "Help me find schools where my budget and aid needs are realistic.";
  } else if (needsAid) {
    prompt = "Help me find schools where financial aid could make attendance realistic.";
  } else {
    prompt = "Help me find schools that match the environment I want.";
  }

  return { id: "affordability", prompt };
}

/** Always returns exactly three prompts, in a fixed order, so the
 * completion view's layout never depends on how much was entered. */
export function buildOnboardingPrompts(profile: Profile | undefined): OnboardingPrompt[] {
  return [timelinePrompt(profile), directionPrompt(profile), affordabilityPrompt(profile)];
}
