import { beforeEach, describe, expect, it } from "vitest";

import { clearStepDraft, loadStepDraft, saveStepDraft } from "@/features/onboarding/onboarding-draft";

describe("onboarding step draft persistence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("round-trips a draft for the same user and step", () => {
    saveStepDraft("user-1", "basics", { preferredName: "Maya" });
    expect(loadStepDraft("user-1", "basics")).toEqual({ preferredName: "Maya" });
  });

  it("ignores a draft saved under a different user id", () => {
    saveStepDraft("user-1", "basics", { preferredName: "Maya" });
    expect(loadStepDraft("user-2", "basics")).toBeNull();
  });

  it("ignores a draft saved for a different step", () => {
    saveStepDraft("user-1", "basics", { preferredName: "Maya" });
    expect(loadStepDraft("user-1", "academics")).toBeNull();
  });

  it("returns null once the draft is cleared", () => {
    saveStepDraft("user-1", "basics", { preferredName: "Maya" });
    clearStepDraft("user-1");
    expect(loadStepDraft("user-1", "basics")).toBeNull();
  });

  it("returns null for a malformed stored value instead of throwing", () => {
    window.sessionStorage.setItem("counselle.onboarding.draft.user-1", "not json");
    expect(loadStepDraft("user-1", "basics")).toBeNull();
  });
});
