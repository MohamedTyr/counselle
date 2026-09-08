import { classifyFit } from "@/features/schools/explore/classify-fit";

/*
 * These tests exist because the verdict is an honesty surface, not because
 * every module gets tests (AGENTS.md: a test has to earn its place). The
 * failure they guard against is the expensive one: the agent -- or the
 * card -- telling a student a school is a Safety on evidence that cannot
 * support it.
 */

describe("classifyFit", () => {
  it("declines to classify when no admit rate is published", () => {
    const verdict = classifyFit(null);

    expect(verdict.category).toBe("Unknown");
    expect(verdict.reason).toMatch(/no admit rate/i);
  });

  it("classifies a low admit rate as a Reach", () => {
    expect(classifyFit(8).category).toBe("Reach");
  });

  it("classifies a middling admit rate as a Target", () => {
    expect(classifyFit(35).category).toBe("Target");
  });

  it("classifies a high admit rate as a Safety", () => {
    expect(classifyFit(78).category).toBe("Safety");
  });

  it("never emits a probability or a score-based shift", () => {
    for (const rate of [4, 20, 49.5, 50, 90]) {
      const verdict = classifyFit(rate);

      expect(["Reach", "Target", "Safety"]).toContain(verdict.category);
      expect(verdict).not.toHaveProperty("probability");
      expect(verdict).not.toHaveProperty("usedScore");
    }
  });

  it("names the exact admit rate in the reason, never a rounded guess", () => {
    expect(classifyFit(19.5).reason).toBe("19.5% admit rate.");
    expect(classifyFit(20).reason).toBe("20% admit rate.");
  });
});
