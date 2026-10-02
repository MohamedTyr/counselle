import { describe, expect, it } from "vitest";

import {
  formatRangeTitle,
  monthMatrix,
  shiftAnchor,
  weekDays,
} from "@/features/calendar/calendar-grid";
import { addDays, getDateKey } from "@/features/tasks/task-dates";

describe("monthMatrix", () => {
  it("draws Feb 2026 in four rows, because Feb 1 is a Sunday", () => {
    const weeks = monthMatrix(new Date(2026, 1, 14));
    expect(weeks).toHaveLength(4);
    expect(getDateKey(weeks[0][0])).toBe("2026-02-01");
    expect(getDateKey(weeks[3][6])).toBe("2026-02-28");
  });

  it("draws Aug 2026 in six rows, because Aug 1 is a Saturday", () => {
    const weeks = monthMatrix(new Date(2026, 7, 1));
    expect(weeks).toHaveLength(6);
    expect(getDateKey(weeks[0][6])).toBe("2026-08-01");
  });

  it("draws Oct 2026 in five rows starting Sep 27", () => {
    const weeks = monthMatrix(new Date(2026, 9, 1));
    expect(weeks).toHaveLength(5);
    expect(getDateKey(weeks[0][0])).toBe("2026-09-27");
    expect(getDateKey(weeks[4][6])).toBe("2026-10-31");
  });

  it.each([
    [2, 8],
    [10, 1],
  ])(
    "keeps day keys unique and consecutive across the DST week of %i/%i 2026",
    (month, day) => {
      const keys = weekDays(new Date(2026, month, day)).map(getDateKey);
      expect(new Set(keys).size).toBe(7);
      keys.slice(1).forEach((key, index) => {
        expect(key).toBe(
          getDateKey(addDays(new Date(`${keys[index]}T12:00`), 1)),
        );
      });
    },
  );
});

describe("shiftAnchor", () => {
  it("pages Jan 31 to February, not into March", () => {
    expect(getDateKey(shiftAnchor(new Date(2026, 0, 31), "month", 1))).toBe(
      "2026-02-28",
    );
  });

  it("moves a week by seven days and Schedule by its window", () => {
    expect(getDateKey(shiftAnchor(new Date(2026, 9, 1), "week", -1))).toBe(
      "2026-09-24",
    );
    expect(getDateKey(shiftAnchor(new Date(2026, 9, 1), "schedule", 1))).toBe(
      "2026-11-26",
    );
  });
});

describe("formatRangeTitle", () => {
  it("names the month, the week's span and Schedule's start", () => {
    const anchor = new Date(2026, 9, 1);
    expect(formatRangeTitle(anchor, "month")).toEqual({
      primary: "October",
      secondary: "2026",
    });
    expect(formatRangeTitle(anchor, "week").primary).toBe("Sep 27 – Oct 3");
    expect(formatRangeTitle(anchor, "schedule").primary).toBe("From Oct 1");
  });
});
