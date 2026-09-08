import { controlOptions, testPolicyOptions } from "@/features/schools/explore/explore-config";

/*
 * Two closed-enum option lists the plan calls out by name as hard exit
 * tests (§7 Phase 2 row): the three-way `control` split must never fold
 * back into a bare "Private", and `test_policy`'s fourth member must read
 * as a claim about us ("No policy on file"), never "not reported" or
 * "no test policy" (which would claim the school published nothing, when
 * our crawler may simply have failed).
 */

describe("controlOptions", () => {
  it("offers three real options plus Any, and no option is a bare 'Private'", () => {
    const labels = controlOptions.map((option) => option.label);

    expect(controlOptions).toHaveLength(4);
    expect(labels).not.toContain("Private");
    expect(labels).toEqual(["Any", "Public", "Private (nonprofit)", "Private (for-profit)"]);
  });

  it("names the three real values exactly the wire's Control union", () => {
    expect(controlOptions.map((option) => option.value)).toEqual([
      "any",
      "public",
      "private",
      "private_for_profit",
    ]);
  });
});

describe("testPolicyOptions", () => {
  it("reads 'No policy on file' for the not_reported member, never 'not reported' or 'no test policy'", () => {
    const notReported = testPolicyOptions.find((option) => option.value === "not_reported");

    expect(notReported?.label).toBe("No policy on file");
    expect(
      testPolicyOptions.some((option) => /not reported|no test policy/i.test(option.label)),
    ).toBe(false);
  });
});
