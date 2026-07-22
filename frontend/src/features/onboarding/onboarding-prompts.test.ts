import { describe, expect, it } from "vitest";

import type { Profile } from "@/api/workspace/types";
import { buildOnboardingPrompts } from "@/features/onboarding/onboarding-prompts";

describe("buildOnboardingPrompts", () => {
  it("always returns exactly three prompts in a fixed order", () => {
    const prompts = buildOnboardingPrompts(undefined);
    expect(prompts.map((entry) => entry.id)).toEqual(["timeline", "direction", "affordability"]);
  });

  it("is deterministic for the same Profile input", () => {
    const profile: Profile = { basics: { grade_level: "11" } };
    expect(buildOnboardingPrompts(profile)).toEqual(buildOnboardingPrompts(profile));
  });

  it("falls back to generic phrasing for every prompt when the Profile is empty", () => {
    const prompts = buildOnboardingPrompts({});
    expect(prompts.find((entry) => entry.id === "timeline")?.prompt).toBe(
      "Help me figure out the best place to start.",
    );
    expect(prompts.find((entry) => entry.id === "direction")?.prompt).toBe(
      "Help me build a starting school list around what I want to study.",
    );
    expect(prompts.find((entry) => entry.id === "affordability")?.prompt).toBe(
      "Help me find schools that match the environment I want.",
    );
  });

  it("uses the timeline prompt when only a graduation year is set", () => {
    const prompts = buildOnboardingPrompts({ basics: { graduation_year: 2027 } });
    expect(prompts.find((entry) => entry.id === "timeline")?.prompt).toBe(
      "What should I focus on next for my application timeline?",
    );
  });

  it("never invents a major that was not entered", () => {
    const prompts = buildOnboardingPrompts({ interests: { intended_majors: [] } });
    expect(prompts.find((entry) => entry.id === "direction")?.prompt).toBe(
      "Help me build a starting school list around what I want to study.",
    );
  });

  it("names the actual entered major(s), joined naturally, never a placeholder", () => {
    const single = buildOnboardingPrompts({
      interests: { intended_majors: ["biochemistry"] },
    });
    expect(single.find((entry) => entry.id === "direction")?.prompt).toBe(
      "Help me build a starting school list around biochemistry.",
    );

    const multiple = buildOnboardingPrompts({
      interests: { intended_majors: ["biochemistry", "economics"] },
    });
    expect(multiple.find((entry) => entry.id === "direction")?.prompt).toBe(
      "Help me build a starting school list around biochemistry and economics.",
    );
  });

  it("distinguishes aid+budget from aid-only from neither", () => {
    const both = buildOnboardingPrompts({ aid: { need_aid: true, budget_per_year: "35000" } });
    expect(both.find((entry) => entry.id === "affordability")?.prompt).toBe(
      "Help me find schools where my budget and aid needs are realistic.",
    );

    const aidOnly = buildOnboardingPrompts({ aid: { need_aid: true } });
    expect(aidOnly.find((entry) => entry.id === "affordability")?.prompt).toBe(
      "Help me find schools where financial aid could make attendance realistic.",
    );

    const neither = buildOnboardingPrompts({ aid: { need_aid: false } });
    expect(neither.find((entry) => entry.id === "affordability")?.prompt).toBe(
      "Help me find schools that match the environment I want.",
    );
  });
});
