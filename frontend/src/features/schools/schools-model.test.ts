import type { School } from "@/domain/school";
import {
  formatDeadline,
  getDeadlineUrgency,
  getDeadlineTime,
} from "@/features/schools/schools-deadline";
import {
  filterSchools,
  isDeadlineSoon,
  matchesListTypeFilter,
  matchesViewFilter,
} from "@/features/schools/schools-filters";
import {
  compareProgress,
  getProgressRatio,
  sortSchools,
} from "@/features/schools/schools-sort";

function school(overrides: Partial<School> & Pick<School, "id">): School {
  const { id, ...rest } = overrides;

  return {
    id,
    unitid: 1,
    schoolName: `School ${id}`,
    location: "Somewhere, US",
    websiteUrl: "https://example.edu",
    status: "Considering",
    listType: "Target",
    round: "RD",
    deadline: "2027-01-05",
    aidDeadline: null,
    scholarshipDeadline: null,
    notes: null,
    intendedMajor: null,
    testPlan: null,
    progress: { completed: 0, total: 0 },
    essays: { completed: 0, total: 0 },
    ...rest,
  };
}

function dateDaysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("school filtering", () => {
  const schools = [
    school({ id: "applying", status: "Applying", listType: "Reach" }),
    school({ id: "submitted", status: "Submitted", listType: "Target" }),
    school({
      id: "close",
      status: "Considering",
      listType: "Safety",
      deadline: dateDaysFromNow(5),
    }),
    school({
      id: "upcoming",
      status: "Considering",
      listType: "Safety",
      deadline: dateDaysFromNow(30),
    }),
  ];

  it("treats close and upcoming urgency as deadline soon", () => {
    expect(schools.filter(isDeadlineSoon).map((item) => item.id)).toEqual([
      "close",
      "upcoming",
    ]);
  });

  it("matches the view filter by status and urgency", () => {
    expect(schools.filter((s) => matchesViewFilter(s, "all"))).toHaveLength(4);
    expect(
      schools.filter((s) => matchesViewFilter(s, "applying")).map((s) => s.id),
    ).toEqual(["applying"]);
    expect(
      schools.filter((s) => matchesViewFilter(s, "submitted")).map((s) => s.id),
    ).toEqual(["submitted"]);
    expect(
      schools
        .filter((s) => matchesViewFilter(s, "deadlines-soon"))
        .map((s) => s.id),
    ).toEqual(["close", "upcoming"]);
  });

  it("matches the list-type filter case-insensitively", () => {
    expect(schools.filter((s) => matchesListTypeFilter(s, "all"))).toHaveLength(
      4,
    );
    expect(
      schools.filter((s) => matchesListTypeFilter(s, "reach")).map((s) => s.id),
    ).toEqual(["applying"]);
    expect(
      schools
        .filter((s) => matchesListTypeFilter(s, "safety"))
        .map((s) => s.id),
    ).toEqual(["close", "upcoming"]);
  });

  it("combines view and list-type filters", () => {
    expect(
      filterSchools(schools, "deadlines-soon", "safety").map((s) => s.id),
    ).toEqual(["close", "upcoming"]);
    expect(filterSchools(schools, "applying", "safety")).toEqual([]);
  });
});

describe("school deadline derivations", () => {
  const referenceDate = new Date("2026-07-06T12:00:00Z");

  it("formats missing and present deadlines", () => {
    expect(formatDeadline(null)).toBe("No deadline");
    expect(formatDeadline("2027-01-05")).toContain("2027");
  });

  it("derives urgency from deadline distance", () => {
    expect(getDeadlineUrgency("2026-07-12", referenceDate)).toBe("close");
    expect(getDeadlineUrgency("2026-08-12", referenceDate)).toBe("upcoming");
    expect(getDeadlineUrgency("2027-01-05", referenceDate)).toBe("normal");
    expect(getDeadlineUrgency(null, referenceDate)).toBe("normal");
  });

  it("sorts missing deadlines last", () => {
    expect(getDeadlineTime(null)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("school progress derivations", () => {
  it("returns a zero ratio when there is no total", () => {
    expect(getProgressRatio({ completed: 0, total: 0 })).toBe(0);
    expect(getProgressRatio({ completed: 3, total: 6 })).toBe(0.5);
  });

  it("compares progress by ratio then completed then total", () => {
    expect(
      compareProgress({ completed: 1, total: 4 }, { completed: 3, total: 4 }),
    ).toBeLessThan(0);
    expect(
      compareProgress({ completed: 2, total: 4 }, { completed: 1, total: 2 }),
    ).toBeGreaterThan(0);
    expect(
      compareProgress({ completed: 1, total: 2 }, { completed: 1, total: 2 }),
    ).toBe(0);
  });
});

describe("school sorting", () => {
  const schools = [
    school({
      id: "b-late",
      schoolName: "Beta University",
      deadline: "2027-03-01",
      status: "Submitted",
      progress: { completed: 1, total: 4 },
    }),
    school({
      id: "a-early",
      schoolName: "Alpha College",
      deadline: "2027-01-05",
      status: "Applying",
      progress: { completed: 3, total: 4 },
    }),
    school({
      id: "c-mid",
      schoolName: "Gamma Institute",
      deadline: "2027-02-01",
      status: "Considering",
      progress: { completed: 2, total: 4 },
    }),
  ];

  it("sorts by next deadline ascending", () => {
    expect(
      sortSchools(schools, {
        columnId: "nextDeadline",
        direction: "asc",
      }).map((s) => s.id),
    ).toEqual(["a-early", "c-mid", "b-late"]);
  });

  it("sorts by school name descending without mutating the input", () => {
    const result = sortSchools(schools, {
      columnId: "school",
      direction: "desc",
    });

    expect(result).not.toBe(schools);
    expect(result.map((s) => s.id)).toEqual(["c-mid", "b-late", "a-early"]);
    expect(schools.map((s) => s.id)).toEqual(["b-late", "a-early", "c-mid"]);
  });

  it("sorts by progress ratio ascending", () => {
    expect(
      sortSchools(schools, {
        columnId: "progress",
        direction: "asc",
      }).map((s) => s.id),
    ).toEqual(["b-late", "c-mid", "a-early"]);
  });

  it("falls back to name order when the column values tie", () => {
    const tied = [
      school({ id: "z", schoolName: "Zeta", status: "Applying" }),
      school({ id: "a", schoolName: "Aria", status: "Applying" }),
    ];

    expect(
      sortSchools(tied, { columnId: "status", direction: "asc" }).map(
        (s) => s.id,
      ),
    ).toEqual(["a", "z"]);
  });
});
