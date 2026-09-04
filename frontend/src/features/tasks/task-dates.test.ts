import { afterEach, describe, expect, it, vi } from "vitest";

import { formatWhenChip, getDeadlineState } from "@/features/tasks/task-dates";

// THE CORRECTNESS RULE (plans/tasks-redesign-plan.md P5.1): all task dates are
// YYYY-MM-DD strings end to end. Parsing one with `new Date("2026-09-04")`
// reads as UTC midnight, which renders as the *previous* local day in any
// negative-offset timezone. These tests pin the runtime's local timezone via
// TZ to two extremes — a negative offset (UTC-5) and a positive one past the
// international date line (UTC+13) — so a regression back to a naive
// `new Date(dateKey)` parse fails here before it ships.
//
// Node/V8 re-resolve the local timezone from `process.env.TZ` on each `Date`
// local-time access, so stubbing it per test is sufficient; no module
// re-import is needed.
const TIMEZONES = ["Etc/GMT+5", "Etc/GMT-13"] as const;

// referenceDate is always constructed as a *local* midnight for the day under
// test — exactly how `getNowDate()` behaves in production — so it is
// consistent with whichever TZ is currently stubbed.
function localMidnight(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(TIMEZONES)("formatWhenChip under TZ=%s", (tz) => {
  it("returns \"Today\" when when_on is the reference date", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);

    expect(formatWhenChip("2026-09-04", referenceDate)).toBe("Today");
  });

  it("returns \"Tomorrow\" for the next calendar day", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);

    expect(formatWhenChip("2026-09-05", referenceDate)).toBe("Tomorrow");
  });

  it("returns a bare weekday for a date 2-6 days out", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);
    const expectedWeekday = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
    }).format(localMidnight(2026, 9, 8));

    expect(formatWhenChip("2026-09-08", referenceDate)).toBe(expectedWeekday);
  });

  it("returns weekday + day + month for a date beyond 7 days in the same year", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);
    const target = localMidnight(2026, 12, 25);
    const expectedWeekday = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
    }).format(target);
    const expectedMonth = new Intl.DateTimeFormat("en-US", {
      month: "short",
    }).format(target);

    expect(formatWhenChip("2026-12-25", referenceDate)).toBe(
      `${expectedWeekday} 25 ${expectedMonth}`,
    );
  });

  it("returns day + month + year for a date in a different year", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);

    expect(formatWhenChip("2027-01-15", referenceDate)).toBe("15 Jan 2027");
  });
});

describe.each(TIMEZONES)("getDeadlineState under TZ=%s", (tz) => {
  it("is hidden when deadline_on is undefined", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);

    expect(getDeadlineState(undefined, referenceDate)).toBe("hidden");
  });

  it("is overdue the calendar day after the deadline has passed", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);

    expect(getDeadlineState("2026-09-03", referenceDate)).toBe("overdue");
  });

  it("is due-soon exactly at the today+2 boundary", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);

    expect(getDeadlineState("2026-09-04", referenceDate)).toBe("due-soon");
    expect(getDeadlineState("2026-09-06", referenceDate)).toBe("due-soon");
  });

  it("is normal between today+3 and today+7", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);

    expect(getDeadlineState("2026-09-07", referenceDate)).toBe("normal");
    expect(getDeadlineState("2026-09-11", referenceDate)).toBe("normal");
  });

  it("is hidden beyond today+7", () => {
    vi.stubEnv("TZ", tz);
    const referenceDate = localMidnight(2026, 9, 4);

    expect(getDeadlineState("2026-09-12", referenceDate)).toBe("hidden");
  });
});
