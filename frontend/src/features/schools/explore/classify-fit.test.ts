import {
  caveatSeverity,
  classifyFit,
} from "@/features/schools/explore/classify-fit";
import { exploreFixtures } from "@/features/schools/explore/explore-fixtures";
import type {
  ExploreSchool,
  StudentProfile,
} from "@/features/schools/explore/explore-types";

/*
 * These tests exist because the verdict is an honesty surface, not because
 * every module gets tests (AGENTS.md: a test has to earn its place). The
 * failure they guard against is the expensive one: the agent telling a
 * student a school is a Safety on evidence that cannot support it.
 */

const base = exploreFixtures[0];

function school(overrides: Partial<ExploreSchool>): ExploreSchool {
  return { ...base, ...overrides };
}

const strongStudent: StudentProfile = { homeState: "MA", satScore: 1560 };
const weakStudent: StudentProfile = { homeState: "MA", satScore: 1100 };
const anonymous: StudentProfile = { homeState: null, satScore: null };

describe("classifyFit", () => {
  it("declines to classify when no admit rate is published", () => {
    const verdict = classifyFit(
      school({
        admitRate: null,
        testBand: { p25: 1400, p75: 1500, submittedPercent: 90 },
      }),
      strongStudent,
    );

    expect(verdict.category).toBe("Unknown");
    expect(verdict.usedScore).toBe(false);
    expect(verdict.reason).toMatch(/no admit rate/i);
  });

  it("degrades to admit-rate-only when the test band is missing", () => {
    const verdict = classifyFit(
      school({ admitRate: { basis: "overall", value: 55 }, testBand: null }),
      strongStudent,
    );

    expect(verdict.category).toBe("Safety");
    expect(verdict.usedScore).toBe(false);
    expect(verdict.reason).not.toMatch(/1560/);
  });

  it("refuses to let a band under 50% submitted move the verdict", () => {
    const underHalf = school({
      admitRate: { basis: "overall", value: 8 },
      testBand: { p25: 1200, p75: 1300, submittedPercent: 41 },
    });

    // The student's 1560 is far above this band. With a trustworthy band
    // that would shift Reach -> Target; at 41% submitted it must not.
    const verdict = classifyFit(underHalf, strongStudent);

    expect(verdict.category).toBe("Reach");
    expect(verdict.usedScore).toBe(false);
  });

  it("uses a trustworthy band to shift one rung in each direction", () => {
    const trusted = school({
      admitRate: { basis: "overall", value: 30 },
      testBand: { p25: 1300, p75: 1450, submittedPercent: 85 },
    });

    expect(classifyFit(trusted, strongStudent).category).toBe("Safety");
    expect(classifyFit(trusted, weakStudent).category).toBe("Reach");
    expect(classifyFit(trusted, strongStudent).usedScore).toBe(true);
  });

  it("never shifts past either end of the ladder", () => {
    const wideOpen = school({
      admitRate: { basis: "overall", value: 90 },
      testBand: { p25: 1000, p75: 1100, submittedPercent: 90 },
    });
    const brutal = school({
      admitRate: { basis: "overall", value: 4 },
      testBand: { p25: 1500, p75: 1570, submittedPercent: 90 },
    });

    expect(classifyFit(wideOpen, strongStudent).category).toBe("Safety");
    expect(classifyFit(brutal, weakStudent).category).toBe("Reach");
  });

  it("degrades to admit-rate-only when the student has no score", () => {
    const verdict = classifyFit(
      school({
        admitRate: { basis: "overall", value: 30 },
        testBand: { p25: 1300, p75: 1450, submittedPercent: 85 },
      }),
      anonymous,
    );

    expect(verdict.category).toBe("Target");
    expect(verdict.usedScore).toBe(false);
  });

  it("never emits a probability", () => {
    for (const fixture of exploreFixtures) {
      const verdict = classifyFit(fixture, strongStudent);

      expect(["Reach", "Target", "Safety", "Unknown"]).toContain(
        verdict.category,
      );
      expect(verdict).not.toHaveProperty("probability");
    }
  });
});

describe("caveatSeverity", () => {
  it("promotes a band under 50% submitted to severe", () => {
    expect(
      caveatSeverity(
        school({ testBand: { p25: 1400, p75: 1500, submittedPercent: 41 } }),
      ),
    ).toBe("severe");
  });

  it("keeps a 50–80% band inline as mild", () => {
    expect(
      caveatSeverity(
        school({ testBand: { p25: 1400, p75: 1500, submittedPercent: 62 } }),
      ),
    ).toBe("mild");
  });

  it("stays quiet above 80% and when there is nothing to caveat", () => {
    expect(
      caveatSeverity(
        school({ testBand: { p25: 1400, p75: 1500, submittedPercent: 88 } }),
      ),
    ).toBe("none");
    expect(caveatSeverity(school({ testBand: null }))).toBe("none");
    expect(
      caveatSeverity(
        school({ testBand: { p25: 1400, p75: 1500, submittedPercent: null } }),
      ),
    ).toBe("none");
  });
});
