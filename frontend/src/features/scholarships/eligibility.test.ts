import { describe, expect, it } from "vitest";

import type { EligibilityRule } from "@/api/scholarships/types";
import type { Profile } from "@/api/workspace/types";

import { evaluateCriteria, readProfileFacts, summarizeFit } from "./eligibility";

const FULL_PROFILE: Profile = {
  basics: { grade_level: "12" },
  academics: { gpa_unweighted: "3.6", gpa_scale: "4.0" },
  background: { citizenship: "US citizen", residence: { state: "California" }, first_gen: true },
  interests: { intended_majors: ["Computer Science"] },
};

function scholarship(eligibility: EligibilityRule[], otherEligibility: string[] = []) {
  return { eligibility, otherEligibility };
}

describe("readProfileFacts", () => {
  it("reads free-text citizenship and a full state name", () => {
    const facts = readProfileFacts(FULL_PROFILE);
    expect(facts.citizenship).toBe("us_citizen");
    expect(facts.state).toBe("CA");
    expect(facts.gpa).toBe(3.6);
  });

  it("reads a permanent resident before the word US", () => {
    const facts = readProfileFacts({ background: { citizenship: "US permanent resident" } });
    expect(facts.citizenship).toBe("permanent_resident");
  });

  it("leaves unreadable citizenship unknown rather than guessing", () => {
    expect(readProfileFacts({ background: { citizenship: "it's complicated" } }).citizenship).toBeNull();
  });
});

describe("evaluateCriteria", () => {
  it("never decides a rule the profile doesn't answer", () => {
    const results = evaluateCriteria(
      scholarship([
        { kind: "citizenship", anyOf: ["us_citizen"] },
        { kind: "state", anyOf: ["TX"] },
        { kind: "gpa_min", value: 3.0 },
        { kind: "first_gen" },
      ]),
      readProfileFacts({}),
    );
    expect(results.map((result) => result.status)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(results[1].profileField).toBe("state");
  });

  it("marks met and unmet only from stated facts", () => {
    const results = evaluateCriteria(
      scholarship([
        { kind: "state", anyOf: ["TX"] },
        { kind: "gpa_min", value: 3.5 },
        { kind: "grade", anyOf: ["11"] },
      ]),
      readProfileFacts(FULL_PROFILE),
    );
    expect(results.map((result) => result.status)).toEqual(["unmet", "met", "unmet"]);
  });

  it("keeps financial need unknown even when the student asks for aid", () => {
    const facts = readProfileFacts({ ...FULL_PROFILE, aid: { need_aid: true } });
    const [result] = evaluateCriteria(scholarship([{ kind: "financial_need" }]), facts);
    expect(result.status).toBe("unknown");
  });

  it("does not rule a student out on a major that isn't listed", () => {
    const [result] = evaluateCriteria(
      scholarship([{ kind: "major", anyOf: ["Engineering"] }]),
      readProfileFacts(FULL_PROFILE),
    );
    expect(result.status).toBe("unknown");
  });

  it("matches a major regardless of case", () => {
    const [result] = evaluateCriteria(
      scholarship([{ kind: "major", anyOf: ["Computer science"] }]),
      readProfileFacts(FULL_PROFILE),
    );
    expect(result.status).toBe("met");
  });

  it("won't compare a GPA from another scale", () => {
    const facts = readProfileFacts({ academics: { gpa_unweighted: "4.6", gpa_scale: "5.0" } });
    const [result] = evaluateCriteria(scholarship([{ kind: "gpa_min", value: 3.0 }]), facts);
    expect(result.status).toBe("unknown");
  });

  it("always shows free-text eligibility as something to check", () => {
    const results = evaluateCriteria(scholarship([], ["Of Hispanic heritage"]), readProfileFacts(FULL_PROFILE));
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("unknown");
  });
});

describe("summarizeFit", () => {
  it("fits only when every rule is met and nothing is free text", () => {
    const facts = readProfileFacts(FULL_PROFILE);
    expect(summarizeFit(scholarship([{ kind: "state", anyOf: ["CA"] }]), facts).kind).toBe("fits");
    expect(summarizeFit(scholarship([{ kind: "state", anyOf: ["CA"] }], ["Leadership"]), facts)).toEqual({
      kind: "check",
      count: 1,
    });
  });

  it("names the rule that rules the student out", () => {
    const fit = summarizeFit(scholarship([{ kind: "state", anyOf: ["TX"] }]), readProfileFacts(FULL_PROFILE));
    expect(fit).toMatchObject({ kind: "ineligible", reason: "For Texas residents" });
  });

  it("stops ruling out on a fact the student chose to ignore", () => {
    const fit = summarizeFit(
      scholarship([{ kind: "state", anyOf: ["TX"] }]),
      readProfileFacts(FULL_PROFILE),
      new Set(["state"]),
    );
    expect(fit.kind).toBe("check");
  });
});
