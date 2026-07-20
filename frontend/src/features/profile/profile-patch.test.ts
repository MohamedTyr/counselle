import {
  buildPatchAtPath,
  formatStringList,
  getAtPath,
  parseStringList,
} from "@/features/profile/profile-patch";

describe("buildPatchAtPath", () => {
  it("nests the value only at the given path, leaving siblings omitted", () => {
    const patch = buildPatchAtPath(["basics", "preferred_name"], "Sam");

    expect(patch).toEqual({ basics: { preferred_name: "Sam" } });
    // No sibling keys (e.g. pronouns, grade_level) appear anywhere in the
    // patch — the backend's RFC 7396-style merge treats an omitted key as
    // "leave alone", so an untouched field must never show up here.
    expect(Object.keys(patch.basics as object)).toEqual(["preferred_name"]);
  });

  it("sends an explicit null to clear a field rather than omitting it", () => {
    const patch = buildPatchAtPath(["academics", "class_rank"], null);

    expect(patch).toEqual({ academics: { class_rank: null } });
  });

  it("nests three levels deep for a sub-object leaf", () => {
    const patch = buildPatchAtPath(["basics", "high_school", "city"], "Austin");

    expect(patch).toEqual({ basics: { high_school: { city: "Austin" } } });
  });

  it("throws on an empty path", () => {
    expect(() => buildPatchAtPath([], "x")).toThrow();
  });
});

describe("getAtPath", () => {
  it("reads a nested value", () => {
    const profile = { basics: { high_school: { city: "Austin" } } };

    expect(getAtPath(profile, ["basics", "high_school", "city"])).toBe(
      "Austin",
    );
  });

  it("returns undefined past a missing branch instead of throwing", () => {
    expect(getAtPath({ basics: null }, ["basics", "high_school", "city"])).toBe(
      undefined,
    );
    expect(getAtPath(undefined, ["basics"])).toBe(undefined);
  });
});

describe("string-list round trip", () => {
  it("parses comma-separated text into a trimmed array", () => {
    expect(parseStringList("AP Bio,  AP Calc BC ,")).toEqual([
      "AP Bio",
      "AP Calc BC",
    ]);
  });

  it("parses blank input as null (a clear), not an empty array", () => {
    expect(parseStringList("   ")).toBeNull();
  });

  it("formats an array back into comma-separated text", () => {
    expect(formatStringList(["AP Bio", "AP Calc BC"])).toBe(
      "AP Bio, AP Calc BC",
    );
  });

  it("formats a non-array value as empty text", () => {
    expect(formatStringList(null)).toBe("");
    expect(formatStringList(undefined)).toBe("");
  });
});
