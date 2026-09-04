import { describe, expect, it } from "vitest";

import { parseQuickAdd, type QuickAddContext } from "./task-parse";

// Pin the clock the same way TasksRoute.test.tsx does, but locally — this module
// takes `referenceDate` as an explicit parameter rather than reading `@/lib/time`,
// so no `vi.mock` is needed.
const REFERENCE_DATE = new Date(2026, 8, 4, 12, 0, 0); // Friday, Sep 4 2026, local noon

const ctx: QuickAddContext = {
  applications: [
    { id: "app-mit", school_name: "Massachusetts Institute of Technology" },
    { id: "app-berkeley", school_name: "UC Berkeley" },
  ],
  essays: [
    { id: "essay-supplement", application_id: "app-mit", title: "Why MIT supplement" },
    { id: "essay-personal", application_id: "app-berkeley", title: "Personal statement" },
  ],
};

describe("parseQuickAdd", () => {
  it("parses a relative day into when_on", () => {
    const result = parseQuickAdd("Berkeley CSS Profile fri", ctx, undefined, REFERENCE_DATE);
    expect(result.when_on).toBe("2026-09-04");
    expect(result.deadline_on).toBeUndefined();
    expect(result.title).toBe("Berkeley CSS Profile");
    expect(result.tokens).toEqual([{ start: 21, end: 24, kind: "when" }]);
  });

  it("parses trailing ! into flagged", () => {
    const result = parseQuickAdd("Call financial aid office!", ctx, undefined, REFERENCE_DATE);
    expect(result.flagged).toBe(true);
    expect(result.title).toBe("Call financial aid office");
  });

  it("parses trailing !! into flagged", () => {
    const result = parseQuickAdd("Submit FAFSA!!", ctx, undefined, REFERENCE_DATE);
    expect(result.flagged).toBe(true);
    expect(result.title).toBe("Submit FAFSA");
  });

  it("parses @school into application_id via fuzzy initials match", () => {
    const result = parseQuickAdd("Ask counselor @mit about deadline", ctx, undefined, REFERENCE_DATE);
    expect(result.application_id).toBe("app-mit");
    expect(result.title).toBe("Ask counselor about deadline");
  });

  it("parses #essay into essay_id, scoped to the matched school", () => {
    const result = parseQuickAdd(
      "Finish @mit #why-mit-supplement draft",
      ctx,
      undefined,
      REFERENCE_DATE,
    );
    expect(result.application_id).toBe("app-mit");
    expect(result.essay_id).toBe("essay-supplement");
    expect(result.title).toBe("Finish draft");
  });

  it("prefers by/due dates as deadline_on, not when_on", () => {
    const result = parseQuickAdd("Submit CSS Profile by nov 1", ctx, undefined, REFERENCE_DATE);
    expect(result.deadline_on).toBe("2026-11-01");
    expect(result.when_on).toBeUndefined();
    expect(result.title).toBe("Submit CSS Profile");
    expect(result.tokens).toEqual([{ start: 19, end: 27, kind: "deadline" }]);
  });

  it("does not re-parse a substring the user has un-parsed", () => {
    const ignored = new Set(["fri"]);
    const result = parseQuickAdd(
      "Review the fri report with the team",
      ctx,
      ignored,
      REFERENCE_DATE,
    );
    expect(result.when_on).toBeUndefined();
    expect(result.tokens).toEqual([]);
    expect(result.title).toBe("Review the fri report with the team");
  });

  it("triggers the waiting-on check-in hint when no date parsed", () => {
    const result = parseQuickAdd("waiting on Ms. Lee's rec letter", ctx, undefined, REFERENCE_DATE);
    expect(result.needsCheckIn).toBe(true);
    expect(result.when_on).toBeUndefined();
    expect(result.deadline_on).toBeUndefined();
  });

  it("does not trigger the waiting-on hint when a date was parsed", () => {
    const result = parseQuickAdd(
      "waiting on Ms. Lee's rec letter fri",
      ctx,
      undefined,
      REFERENCE_DATE,
    );
    expect(result.needsCheckIn).toBe(false);
    expect(result.when_on).toBe("2026-09-04");
  });

  it("returns no tokens and the title unchanged for plain text", () => {
    const result = parseQuickAdd("Monthly report", ctx, undefined, REFERENCE_DATE);
    expect(result.tokens).toEqual([]);
    expect(result.title).toBe("Monthly report");
    expect(result.when_on).toBeUndefined();
    expect(result.deadline_on).toBeUndefined();
    expect(result.flagged).toBeUndefined();
    expect(result.application_id).toBeUndefined();
    expect(result.essay_id).toBeUndefined();
    expect(result.needsCheckIn).toBe(false);
  });
});
