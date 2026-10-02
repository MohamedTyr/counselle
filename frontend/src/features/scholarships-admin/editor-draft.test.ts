import type { PublishCheck, ScholarshipDraft } from "@/api/scholarships/types";

import { emptyDraft, isReady, publishChecks, todayIso } from "./editor-draft";

/* Mirrors `tests/domain/scholarships/test_publish.py`: the editor must fail
 * the same rows as `domain/scholarships/publish.py` for the same drafts. */

/** A local calendar date, like `todayIso`. */
function isoFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function complete(overrides: Partial<ScholarshipDraft> = {}): ScholarshipDraft {
  return {
    ...emptyDraft(),
    name: "Future Leaders Award",
    sponsor: "Acme Foundation",
    apply_url: "https://acme.org/apply",
    source_url: "https://acme.org/scholarship",
    award: { kind: "fixed", amount: 5000, min: null, max: null, renewable: false, years: null, awards_count: null },
    deadline: { kind: "fixed", date: isoFromToday(150), opens_on: null, recurs_annually: false },
    eligibility: [{ kind: "state", any_of: ["TX"] }],
    last_checked_on: todayIso(),
    ...overrides,
  };
}

const award = (partial: Partial<ScholarshipDraft["award"]>): ScholarshipDraft["award"] => ({
  kind: "fixed",
  amount: null,
  min: null,
  max: null,
  renewable: false,
  years: null,
  awards_count: null,
  ...partial,
});

function failing(draft: ScholarshipDraft, server: PublishCheck[] = []): string[] {
  return publishChecks(draft, server)
    .filter((check) => !check.ok && check.severity === "required")
    .map((check) => check.key);
}

describe("publishChecks", () => {
  it("passes a complete draft", () => {
    expect(failing(complete())).toEqual([]);
    expect(isReady(publishChecks(complete()))).toBe(true);
  });

  it.each<[string, Partial<ScholarshipDraft>, PublishCheck]>([
    ["blank name", { name: "" }, "basics"],
    ["blank sponsor", { sponsor: "  " }, "basics"],
    ["no apply link", { apply_url: "" }, "apply_url"],
    ["javascript apply link", { apply_url: "javascript:alert(1)" }, "apply_url"],
    ["fixed with no amount", { award: award({}) }, "award"],
    ["fixed at zero", { award: award({ amount: 0 }) }, "award"],
    ["range with one bound", { award: award({ kind: "range", min: 1000 }) }, "award"],
    ["range at zero", { award: award({ kind: "range", min: 0, max: 0 }) }, "award"],
    ["range inverted", { award: award({ kind: "range", min: 5000, max: 1000 }) }, "award"],
    ["empty major rule", { eligibility: [{ kind: "major", any_of: [] }] }, "rules_complete"],
    ["empty citizenship rule", { eligibility: [{ kind: "citizenship", any_of: [] }] }, "rules_complete"],
    ["fixed deadline without a date", { deadline: { kind: "fixed", date: null, opens_on: null, recurs_annually: false } }, "deadline"],
    ["no source link", { source_url: "" }, "source_url"],
    ["never checked", { last_checked_on: null }, "fresh"],
    ["checked 181 days ago", { last_checked_on: isoFromToday(-181) }, "fresh"],
  ])("fails only its own row: %s", (_name, overrides, expected) => {
    expect(failing(complete(overrides))).toEqual([expected]);
  });

  it.each([
    award({ kind: "range", min: 0, max: 2000 }),
    award({ kind: "range", min: 2000, max: 2000 }),
    award({ kind: "varies" }),
    award({ kind: "full_tuition" }),
    award({ kind: "full_ride" }),
  ])("accepts award %o", (value) => {
    expect(failing(complete({ award: value }))).toEqual([]);
  });

  it("treats a check exactly 180 days ago as fresh", () => {
    expect(failing(complete({ last_checked_on: isoFromToday(-180) }))).toEqual([]);
  });

  it("fails rows in checklist order for an empty draft", () => {
    expect(failing(emptyDraft())).toEqual(["basics", "apply_url", "award", "deadline", "source_url", "fresh"]);
  });

  it("warns about a passed deadline without blocking publish", () => {
    const checks = publishChecks(complete({ deadline: { kind: "fixed", date: isoFromToday(-3), opens_on: null, recurs_annually: true } }));
    expect(checks.find((check) => check.key === "deadline_passed")).toMatchObject({ ok: false, severity: "warning" });
    expect(isReady(checks)).toBe(true);
  });

  it("forces rows the server named to failing", () => {
    expect(failing(complete(), ["award", "fresh"])).toEqual(["award", "fresh"]);
  });

  it("starts a new draft never checked", () => {
    expect(emptyDraft().last_checked_on).toBeNull();
  });
});
