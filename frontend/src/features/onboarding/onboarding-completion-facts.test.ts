import { describe, expect, it } from "vitest";

import { buildOnboardingReceipt } from "@/features/onboarding/onboarding-completion-facts";

describe("buildOnboardingReceipt", () => {
  it("returns no rows for an empty Profile", () => {
    expect(buildOnboardingReceipt({})).toEqual([]);
    expect(buildOnboardingReceipt(undefined)).toEqual([]);
  });

  it("includes only groups with at least one saved fact", () => {
    const receipt = buildOnboardingReceipt({
      basics: { grade_level: "11", graduation_year: 2027 },
    });
    expect(receipt).toEqual([{ label: "Timeline", value: "11th grade · Class of 2027" }]);
  });

  it("never shows a field that was not entered", () => {
    const receipt = buildOnboardingReceipt({
      basics: { grade_level: "12" },
      interests: { intended_majors: ["computer science"] },
    });
    // No GPA/testing entered, so no "Academic snapshot" row at all.
    expect(receipt.find((row) => row.label === "Academic snapshot")).toBeUndefined();
    expect(receipt.find((row) => row.label === "Direction")?.value).toBe("computer science");
  });

  it("renders GPA scale only when the scale was actually saved", () => {
    const withScale = buildOnboardingReceipt({
      academics: { gpa_unweighted: "3.8", gpa_scale: "4.0" },
    });
    expect(withScale.find((row) => row.label === "Academic snapshot")?.value).toBe(
      "3.8 unweighted GPA (out of 4.0)",
    );

    const withoutScale = buildOnboardingReceipt({ academics: { gpa_unweighted: "3.8" } });
    expect(withoutScale.find((row) => row.label === "Academic snapshot")?.value).toBe(
      "3.8 unweighted GPA",
    );
  });

  it("shows an explicit false aid-need fact rather than omitting it", () => {
    const receipt = buildOnboardingReceipt({ aid: { need_aid: false } });
    expect(receipt.find((row) => row.label === "Context")?.value).toBe(
      "Not expecting to need financial aid",
    );
  });

  it("never rounds or reformats a saved decimal budget", () => {
    const receipt = buildOnboardingReceipt({ aid: { budget_per_year: "27500.50" } });
    expect(receipt.find((row) => row.label === "Context")?.value).toContain(
      "Budget around $27500.50/year",
    );
  });

  it("does not show a completion percentage or score anywhere", () => {
    const receipt = buildOnboardingReceipt({
      basics: { grade_level: "9" },
      academics: { gpa_unweighted: "3.5" },
      interests: { intended_majors: ["biology"] },
      background: { citizenship: "U.S. citizen" },
      preferences: { regions: ["Northeast"] },
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toMatch(/%|complete|score/i);
  });
});
