import { describe, expect, it } from "vitest";

import {
  hydrateAcademicDraft,
  hydrateContextDraft,
} from "@/features/onboarding/onboarding-profile-patch";
import { validateAcademicDraft, validateContextDraft } from "@/features/onboarding/onboarding-validation";

describe("validateAcademicDraft", () => {
  it("passes a blank screen (every question is optional)", () => {
    expect(validateAcademicDraft(hydrateAcademicDraft(undefined))).toEqual({ valid: true });
  });

  it("rejects a non-numeric GPA", () => {
    const draft = hydrateAcademicDraft(undefined);
    draft.gpaType = "weighted";
    draft.gpaValue = "not a number";
    expect(validateAcademicDraft(draft)).toEqual({
      valid: false,
      fieldId: "onboarding-academic-gpa-value",
      message: "Enter a GPA using numbers, such as 3.8.",
    });
  });

  it("requires a scale once a GPA value is entered", () => {
    const draft = hydrateAcademicDraft(undefined);
    draft.gpaType = "weighted";
    draft.gpaValue = "3.8";
    expect(validateAcademicDraft(draft)).toEqual({
      valid: false,
      fieldId: "onboarding-academic-gpa-scale",
      message: "Add the scale so Counselle reads this GPA correctly.",
    });
  });

  it("rejects an unweighted GPA above its scale", () => {
    const draft = hydrateAcademicDraft(undefined);
    draft.gpaType = "unweighted";
    draft.gpaValue = "4.5";
    draft.gpaScale = "4.0";
    expect(validateAcademicDraft(draft)).toEqual({
      valid: false,
      fieldId: "onboarding-academic-gpa-value",
      message: "An unweighted GPA can’t be higher than its scale.",
    });
  });

  it("allows a weighted GPA above its scale", () => {
    const draft = hydrateAcademicDraft(undefined);
    draft.gpaType = "weighted";
    draft.gpaValue = "4.5";
    draft.gpaScale = "4.0";
    expect(validateAcademicDraft(draft)).toEqual({ valid: true });
  });

  it("rejects an SAT total out of range", () => {
    const draft = hydrateAcademicDraft(undefined);
    draft.satEnabled = true;
    draft.satTotal = "300";
    expect(validateAcademicDraft(draft)).toEqual({
      valid: false,
      fieldId: "onboarding-academic-sat-total",
      message: "Enter an SAT total from 400 to 1600.",
    });
  });

  it("rejects an ACT composite out of range", () => {
    const draft = hydrateAcademicDraft(undefined);
    draft.actEnabled = true;
    draft.actComposite = "40";
    expect(validateAcademicDraft(draft)).toEqual({
      valid: false,
      fieldId: "onboarding-academic-act-composite",
      message: "Enter an ACT composite from 1 to 36.",
    });
  });
});

describe("validateContextDraft", () => {
  it("passes a blank screen", () => {
    expect(validateContextDraft(hydrateContextDraft(undefined))).toEqual({ valid: true });
  });

  it("rejects a negative budget", () => {
    const draft = hydrateContextDraft(undefined);
    draft.needAid = "yes";
    draft.budgetPerYear = "-100";
    expect(validateContextDraft(draft)).toEqual({
      valid: false,
      fieldId: "onboarding-context-budget",
      message: "Enter a yearly budget of 0 or more.",
    });
  });

  it("ignores the budget field when aid need isn't Yes", () => {
    const draft = hydrateContextDraft(undefined);
    draft.needAid = "no";
    draft.budgetPerYear = "not a number";
    expect(validateContextDraft(draft)).toEqual({ valid: true });
  });
});
