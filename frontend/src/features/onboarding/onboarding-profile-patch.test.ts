import { describe, expect, it } from "vitest";

import type { Profile } from "@/api/workspace/types";
import {
  buildAcademicPatch,
  buildBasicsPatch,
  buildContextPatch,
  buildDirectionPatch,
  buildFitPatch,
  hydrateAcademicDraft,
  hydrateBasicsDraft,
  hydrateContextDraft,
  hydrateDirectionDraft,
  hydrateFitDraft,
  triStatePatchValue,
} from "@/features/onboarding/onboarding-profile-patch";

describe("buildBasicsPatch", () => {
  it("omits untouched fields and only sends what was entered", () => {
    const draft = hydrateBasicsDraft(undefined);
    draft.preferredName = "Maya";
    expect(buildBasicsPatch(draft, undefined)).toEqual({
      basics: { preferred_name: "Maya" },
    });
  });

  it("trims the preferred name before comparing/saving", () => {
    const draft = hydrateBasicsDraft(undefined);
    draft.preferredName = "  Maya  ";
    expect(buildBasicsPatch(draft, undefined)).toEqual({
      basics: { preferred_name: "Maya" },
    });
  });

  it("sends null only when explicitly clearing a pre-existing value", () => {
    const profile: Profile = { basics: { preferred_name: "Maya" } };
    const draft = hydrateBasicsDraft(profile);
    draft.preferredName = "";
    expect(buildBasicsPatch(draft, profile)).toEqual({
      basics: { preferred_name: null },
    });
  });

  it("omits a blank untouched field instead of sending null", () => {
    const draft = hydrateBasicsDraft(undefined);
    expect(buildBasicsPatch(draft, undefined)).toEqual({});
  });

  it("never sends a whole section for one changed field, and a second unrelated field survives", () => {
    const profile: Profile = {
      basics: { preferred_name: "Maya", grade_level: "11" },
    };
    const draft = hydrateBasicsDraft(profile);
    draft.graduationYear = 2028;
    const patch = buildBasicsPatch(draft, profile);
    expect(patch).toEqual({ basics: { graduation_year: 2028 } });
    // grade_level is omitted from the patch, so the merge-patch contract
    // leaves the server's existing "11" untouched — it must not appear here.
    expect(patch.basics).not.toHaveProperty("grade_level");
    expect(patch.basics).not.toHaveProperty("preferred_name");
  });

  it("sends grade_level: null when a previously-saved grade level is deselected", () => {
    const profile: Profile = { basics: { grade_level: "11" } };
    const draft = hydrateBasicsDraft(profile);
    draft.gradeLevel = "";
    const patch = buildBasicsPatch(draft, profile);
    expect(patch).toEqual({ basics: { grade_level: null } });
  });
});

describe("buildAcademicPatch", () => {
  it("writes only the selected GPA path and never clears the other variant", () => {
    const profile: Profile = { academics: { gpa_weighted: "4.31", gpa_scale: "5.0" } };
    const draft = hydrateAcademicDraft(profile);
    draft.gpaType = "weighted";
    draft.gpaValue = "4.5";
    const patch = buildAcademicPatch(draft, profile);
    expect(patch).toEqual({ academics: { gpa_weighted: "4.5" } });
    expect(patch.academics).not.toHaveProperty("gpa_unweighted");
  });

  it("keeps GPA and budget decimals as trimmed strings, never floats", () => {
    const draft = hydrateAcademicDraft(undefined);
    draft.gpaType = "unweighted";
    draft.gpaValue = "3.80";
    draft.gpaScale = "4.0";
    const patch = buildAcademicPatch(draft, undefined);
    expect(patch.academics?.gpa_unweighted).toBe("3.80");
    expect(typeof patch.academics?.gpa_unweighted).toBe("string");
  });

  it("sends SAT/ACT scores as integers", () => {
    const draft = hydrateAcademicDraft(undefined);
    draft.satEnabled = true;
    draft.satTotal = "1450";
    const patch = buildAcademicPatch(draft, undefined);
    expect(patch.testing?.sat).toEqual({ total: 1450 });
  });

  it("preserves unrelated planned-test entries when editing SAT/ACT plans", () => {
    const profile: Profile = {
      testing: {
        planned_tests: [
          { test: "TOEFL", date: "2026-09-01" },
          { test: "SAT", date: "2026-10-03" },
        ],
      },
    };
    const draft = hydrateAcademicDraft(profile);
    draft.plannedSatDate = "2026-11-01";
    const patch = buildAcademicPatch(draft, profile);
    expect(patch.testing?.planned_tests).toEqual([
      { test: "TOEFL", date: "2026-09-01" },
      { test: "SAT", date: "2026-11-01" },
    ]);
  });

  it("clears planned tests only when every onboarding-owned entry is removed and none remain", () => {
    const profile: Profile = { testing: { planned_tests: [{ test: "SAT" }] } };
    const draft = hydrateAcademicDraft(profile);
    draft.plannedSat = false;
    const patch = buildAcademicPatch(draft, profile);
    expect(patch.testing?.planned_tests).toBeNull();
  });

  it("omits planned tests when nothing was ever touched", () => {
    const draft = hydrateAcademicDraft(undefined);
    const patch = buildAcademicPatch(draft, undefined);
    expect(patch).toEqual({});
  });

  it("writes an edited GPA scale even when the GPA value itself is unchanged", () => {
    const profile: Profile = { academics: { gpa_unweighted: "3.8", gpa_scale: "4.0" } };
    const draft = hydrateAcademicDraft(profile);
    draft.gpaScale = "5.0";
    const patch = buildAcademicPatch(draft, profile);
    expect(patch).toEqual({ academics: { gpa_scale: "5.0" } });
    expect(patch.academics).not.toHaveProperty("gpa_unweighted");
  });
});

describe("buildDirectionPatch", () => {
  it("preserves existing majors beyond the onboarding's first three", () => {
    const profile: Profile = {
      interests: {
        intended_majors: ["Computer science", "Economics", "Physics", "History", "Art"],
      },
    };
    const draft = hydrateDirectionDraft(profile);
    expect(draft.majors).toEqual(["Computer science", "Economics", "Physics"]);
    draft.majors = ["Computer science", "Economics", "Mathematics"];
    const patch = buildDirectionPatch(draft, profile);
    expect(patch.interests?.intended_majors).toEqual([
      "Computer science",
      "Economics",
      "Mathematics",
      "History",
      "Art",
    ]);
  });

  it("deduplicates majors case-insensitively while preserving first spelling and order", () => {
    const draft = hydrateDirectionDraft(undefined);
    draft.majors = ["Computer Science", "computer science", "Economics"];
    const patch = buildDirectionPatch(draft, undefined);
    expect(patch.interests?.intended_majors).toEqual(["Computer Science", "Economics"]);
  });

  it("omits an empty untouched preprofessional selection", () => {
    const profile: Profile = { interests: { preprofessional: ["pre_law"] } };
    const draft = hydrateDirectionDraft(profile);
    const patch = buildDirectionPatch(draft, profile);
    expect(patch).toEqual({});
  });

  it("sends major_certainty: null when a previously-saved certainty is deselected", () => {
    const profile: Profile = { interests: { major_certainty: "leaning" } };
    const draft = hydrateDirectionDraft(profile);
    draft.certainty = "";
    const patch = buildDirectionPatch(draft, profile);
    expect(patch).toEqual({ interests: { major_certainty: null } });
  });

  it("sends preprofessional: null when all previously-saved chips are deselected", () => {
    const profile: Profile = { interests: { preprofessional: ["pre_law"] } };
    const draft = hydrateDirectionDraft(profile);
    draft.preprofessional = [];
    const patch = buildDirectionPatch(draft, profile);
    expect(patch).toEqual({ interests: { preprofessional: null } });
  });
});

describe("buildContextPatch", () => {
  it("preserves explicit false instead of dropping it via truthiness filtering", () => {
    const draft = hydrateContextDraft(undefined);
    draft.firstGen = "no";
    const patch = buildContextPatch(draft, undefined);
    expect(patch.background?.first_gen).toBe(false);
  });

  it("clears a prefilled boolean only when actively changed to Not sure", () => {
    const profile: Profile = { background: { first_gen: true } };
    const draft = hydrateContextDraft(profile);
    draft.firstGen = "unsure";
    const patch = buildContextPatch(draft, profile);
    expect(patch.background?.first_gen).toBeNull();
  });

  it("never sends a boolean for an untouched Not-sure selection with no prior value", () => {
    const draft = hydrateContextDraft(undefined);
    draft.firstGen = "unsure";
    const patch = buildContextPatch(draft, undefined);
    expect(patch).toEqual({});
  });

  it("never clears a saved budget merely because aid need becomes false", () => {
    const profile: Profile = { aid: { need_aid: true, budget_per_year: "25000" } };
    const draft = hydrateContextDraft(profile);
    draft.needAid = "no";
    const patch = buildContextPatch(draft, profile);
    expect(patch.aid).toEqual({ need_aid: false });
    expect(patch.aid).not.toHaveProperty("budget_per_year");
  });

  it("writes the budget only while aid need is Yes", () => {
    const draft = hydrateContextDraft(undefined);
    draft.needAid = "yes";
    draft.budgetPerYear = "25000";
    const patch = buildContextPatch(draft, undefined);
    expect(patch.aid).toEqual({ need_aid: true, budget_per_year: "25000" });
  });
});

describe("buildFitPatch", () => {
  it("writes nothing for Open anywhere on a new untouched profile", () => {
    const draft = hydrateFitDraft(undefined);
    draft.openAnywhere = true;
    const patch = buildFitPatch(draft, undefined);
    expect(patch).toEqual({});
  });

  it("sends null for regions when Open anywhere deliberately replaces saved regions", () => {
    const profile: Profile = { preferences: { regions: ["Midwest"] } };
    const draft = hydrateFitDraft(profile);
    draft.openAnywhere = true;
    const patch = buildFitPatch(draft, profile);
    expect(patch.preferences?.regions).toBeNull();
  });

  it("preserves must-haves beyond the first three exposed in onboarding", () => {
    const profile: Profile = {
      preferences: { must_haves: ["Co-op", "Research", "Clubs", "Study abroad"] },
    };
    const draft = hydrateFitDraft(profile);
    draft.mustHaves = ["Co-op", "Research", "Greek life"];
    const patch = buildFitPatch(draft, profile);
    expect(patch.preferences?.must_haves).toEqual([
      "Co-op",
      "Research",
      "Greek life",
      "Study abroad",
    ]);
  });
});

describe("triStatePatchValue", () => {
  it("omits when the control was never touched", () => {
    expect(triStatePatchValue(undefined, "unanswered")).toBeUndefined();
  });

  it("omits Not sure when there was no prior value", () => {
    expect(triStatePatchValue(undefined, "unsure")).toBeUndefined();
  });

  it("clears an existing value when explicitly changed to Not sure", () => {
    expect(triStatePatchValue(true, "unsure")).toBeNull();
  });

  it("omits an unchanged Yes/No answer", () => {
    expect(triStatePatchValue(false, "no")).toBeUndefined();
  });

  it("includes a changed Yes/No answer, preserving explicit false", () => {
    expect(triStatePatchValue(true, "no")).toBe(false);
  });
});
