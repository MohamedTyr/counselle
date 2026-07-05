import type { EssayLibraryCardData } from "@/domain/essay"
import {
  countWords,
  estimateInitialWordCount,
  getInitialEssayContent,
  getSchoolFallback,
} from "@/features/essays/essay-content"
import {
  countEssaysByFilter,
  filterEssays,
  getEssaySearchText,
  matchesFilter,
} from "@/features/essays/essay-filters"

function essay(
  overrides: Partial<EssayLibraryCardData> & Pick<EssayLibraryCardData, "id">
): EssayLibraryCardData {
  const { id, ...rest } = overrides

  return {
    id,
    title: "Untitled",
    school: "Common App",
    schoolLocation: "All schools",
    logoUrl: "",
    type: "Supplement",
    status: "Drafting",
    wordCount: 0,
    wordLimit: 500,
    deadline: "Jan 1, 2027",
    updatedAt: "1h ago",
    version: "v1",
    comments: 0,
    suggestions: 0,
    previewTitle: "Untitled",
    previewLines: [],
    ...rest,
  }
}

describe("essay filter matching", () => {
  const personal = essay({ id: "personal", type: "Personal statement" })
  const supplement = essay({ id: "supplement", type: "Supplement" })
  const needsReview = essay({ id: "needs-review", status: "Needs review" })
  const hasSuggestions = essay({ id: "suggestions", suggestions: 3 })
  const dueSoon = essay({ id: "due-soon", dueSoon: true })

  it("matches every essay for the all filter", () => {
    expect(matchesFilter(personal, "all")).toBe(true)
    expect(matchesFilter(supplement, "all")).toBe(true)
    expect(matchesFilter(dueSoon, "all")).toBe(true)
  })

  it("matches personal statements only for the personal filter", () => {
    expect(matchesFilter(personal, "personal")).toBe(true)
    expect(matchesFilter(supplement, "personal")).toBe(false)
  })

  it("matches supplements only for the supplements filter", () => {
    expect(matchesFilter(supplement, "supplements")).toBe(true)
    expect(matchesFilter(personal, "supplements")).toBe(false)
  })

  it("matches needs-review status or open suggestions for the review filter", () => {
    expect(matchesFilter(needsReview, "review")).toBe(true)
    expect(matchesFilter(hasSuggestions, "review")).toBe(true)
    expect(matchesFilter(supplement, "review")).toBe(false)
  })

  it("matches only flagged essays for the due-soon filter", () => {
    expect(matchesFilter(dueSoon, "due-soon")).toBe(true)
    expect(matchesFilter(supplement, "due-soon")).toBe(false)
  })
})

describe("essay list filtering", () => {
  const essays = [
    essay({
      id: "common-app",
      title: "Common App Personal Statement",
      school: "Common App",
      type: "Personal statement",
    }),
    essay({
      id: "stanford",
      title: "Stanford Roommate Note",
      school: "Stanford",
      status: "Needs review",
      type: "Supplement",
    }),
    essay({
      id: "berkeley",
      title: "UC PIQ Leadership",
      school: "UC Berkeley",
      dueSoon: true,
      type: "Supplement",
    }),
  ]

  it("builds searchable text from title, school, and type", () => {
    expect(getEssaySearchText(essays[0])).toBe(
      "common app personal statement common app personal statement"
    )
  })

  it("matches search query across title, school, and type", () => {
    expect(
      filterEssays(essays, "all", "stanford").map((item) => item.id)
    ).toEqual(["stanford"])
    expect(
      filterEssays(essays, "all", "supplement").map((item) => item.id)
    ).toEqual(["stanford", "berkeley"])
  })

  it("returns every essay for an empty query", () => {
    expect(filterEssays(essays, "all", "   ").map((item) => item.id)).toEqual([
      "common-app",
      "stanford",
      "berkeley",
    ])
  })

  it("combines filter and search", () => {
    expect(
      filterEssays(essays, "due-soon", "leadership").map((item) => item.id)
    ).toEqual(["berkeley"])
    expect(filterEssays(essays, "personal", "stanford")).toEqual([])
  })

  it("counts essays matching a filter", () => {
    expect(countEssaysByFilter(essays, "all")).toBe(3)
    expect(countEssaysByFilter(essays, "supplements")).toBe(2)
    expect(countEssaysByFilter(essays, "due-soon")).toBe(1)
  })
})

describe("essay editor content derivations", () => {
  it("counts words while ignoring extra whitespace", () => {
    expect(countWords("  hello   world  ")).toBe(2)
    expect(countWords("")).toBe(0)
  })

  it("estimates the initial word count from html content", () => {
    const content = getInitialEssayContent(
      essay({
        id: "sample",
        previewTitle: "My Title",
        previewLines: ["One two three.", "Four five."],
      })
    )

    expect(estimateInitialWordCount(content)).toBe(7)
  })

  it("falls back to a drafting prompt when no preview lines exist", () => {
    const content = getInitialEssayContent(
      essay({ id: "empty", previewTitle: "Untitled", previewLines: [] })
    )

    expect(content).toContain("Start with the most specific moment")
  })

  it("derives an uppercase school fallback from initials", () => {
    expect(getSchoolFallback("UC Berkeley")).toBe("UB")
    expect(getSchoolFallback("Stanford")).toBe("ST")
  })
})
