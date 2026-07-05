import type { School } from "@/domain/school"
import {
  filterSchools,
  isDeadlineSoon,
  matchesListTypeFilter,
  matchesViewFilter,
} from "@/features/schools/schools-filters"
import {
  compareProgress,
  getProgressRatio,
  sortSchools,
} from "@/features/schools/schools-sort"

function school(overrides: Partial<School> & Pick<School, "id">): School {
  const { id, ...rest } = overrides

  return {
    id,
    name: `School ${id}`,
    shortName: id.slice(0, 2).toUpperCase(),
    location: "Somewhere, US",
    websiteUrl: "https://example.edu",
    logoUrl: "https://example.edu/favicon.ico",
    status: "Considering",
    listType: "Target",
    round: "RD",
    nextDeadline: "Jan 5, 2027",
    deadlineUrgency: "normal",
    progress: { completed: 0, total: 0 },
    essays: { completed: 0, total: 0 },
    ...rest,
  }
}

describe("school filtering", () => {
  const schools = [
    school({ id: "applying", status: "Applying", listType: "Reach" }),
    school({ id: "submitted", status: "Submitted", listType: "Target" }),
    school({
      id: "close",
      status: "Considering",
      listType: "Safety",
      deadlineUrgency: "close",
    }),
    school({
      id: "upcoming",
      status: "Considering",
      listType: "Safety",
      deadlineUrgency: "upcoming",
    }),
  ]

  it("treats close and upcoming urgency as deadline soon", () => {
    expect(schools.filter(isDeadlineSoon).map((item) => item.id)).toEqual([
      "close",
      "upcoming",
    ])
  })

  it("matches the view filter by status and urgency", () => {
    expect(schools.filter((s) => matchesViewFilter(s, "all"))).toHaveLength(4)
    expect(
      schools.filter((s) => matchesViewFilter(s, "applying")).map((s) => s.id)
    ).toEqual(["applying"])
    expect(
      schools.filter((s) => matchesViewFilter(s, "submitted")).map((s) => s.id)
    ).toEqual(["submitted"])
    expect(
      schools
        .filter((s) => matchesViewFilter(s, "deadlines-soon"))
        .map((s) => s.id)
    ).toEqual(["close", "upcoming"])
  })

  it("matches the list-type filter case-insensitively", () => {
    expect(schools.filter((s) => matchesListTypeFilter(s, "all"))).toHaveLength(
      4
    )
    expect(
      schools.filter((s) => matchesListTypeFilter(s, "reach")).map((s) => s.id)
    ).toEqual(["applying"])
    expect(
      schools.filter((s) => matchesListTypeFilter(s, "safety")).map((s) => s.id)
    ).toEqual(["close", "upcoming"])
  })

  it("combines view and list-type filters", () => {
    expect(
      filterSchools(schools, "deadlines-soon", "safety").map((s) => s.id)
    ).toEqual(["close", "upcoming"])
    expect(filterSchools(schools, "applying", "safety")).toEqual([])
  })
})

describe("school progress derivations", () => {
  it("returns a zero ratio when there is no total", () => {
    expect(getProgressRatio({ completed: 0, total: 0 })).toBe(0)
    expect(getProgressRatio({ completed: 3, total: 6 })).toBe(0.5)
  })

  it("compares progress by ratio then completed then total", () => {
    expect(
      compareProgress({ completed: 1, total: 4 }, { completed: 3, total: 4 })
    ).toBeLessThan(0)
    expect(
      compareProgress({ completed: 2, total: 4 }, { completed: 1, total: 2 })
    ).toBeGreaterThan(0)
    expect(
      compareProgress({ completed: 1, total: 2 }, { completed: 1, total: 2 })
    ).toBe(0)
  })
})

describe("school sorting", () => {
  const schools = [
    school({
      id: "b-late",
      name: "Beta University",
      nextDeadline: "Mar 1, 2027",
      status: "Submitted",
      progress: { completed: 1, total: 4 },
    }),
    school({
      id: "a-early",
      name: "Alpha College",
      nextDeadline: "Jan 5, 2027",
      status: "Applying",
      progress: { completed: 3, total: 4 },
    }),
    school({
      id: "c-mid",
      name: "Gamma Institute",
      nextDeadline: "Feb 1, 2027",
      status: "Considering",
      progress: { completed: 2, total: 4 },
    }),
  ]

  it("sorts by next deadline ascending", () => {
    expect(
      sortSchools(schools, {
        columnId: "nextDeadline",
        direction: "asc",
      }).map((s) => s.id)
    ).toEqual(["a-early", "c-mid", "b-late"])
  })

  it("sorts by school name descending without mutating the input", () => {
    const result = sortSchools(schools, {
      columnId: "school",
      direction: "desc",
    })

    expect(result).not.toBe(schools)
    expect(result.map((s) => s.id)).toEqual(["c-mid", "b-late", "a-early"])
    expect(schools.map((s) => s.id)).toEqual(["b-late", "a-early", "c-mid"])
  })

  it("sorts by progress ratio ascending", () => {
    expect(
      sortSchools(schools, {
        columnId: "progress",
        direction: "asc",
      }).map((s) => s.id)
    ).toEqual(["b-late", "c-mid", "a-early"])
  })

  it("falls back to name order when the column values tie", () => {
    const tied = [
      school({ id: "z", name: "Zeta", status: "Applying" }),
      school({ id: "a", name: "Aria", status: "Applying" }),
    ]

    expect(
      sortSchools(tied, { columnId: "status", direction: "asc" }).map(
        (s) => s.id
      )
    ).toEqual(["a", "z"])
  })
})
