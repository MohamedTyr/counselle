import type { EssaySummary } from "@/api/workspace/types";
import { essayFromSummary, isEssayDueSoon } from "@/domain/essay";
import {
  commonAppPrompt,
  countWords,
  getEssayPrompt,
  getPreviewLines,
  getSchoolFallback,
} from "@/features/essays/essay-content";
import {
  countEssaysByFilter,
  filterEssays,
  getEssaySearchText,
  matchesFilter,
} from "@/features/essays/essay-filters";
import { workspaceEssayFixture } from "@/test/render-app";

function summary(overrides: Partial<EssaySummary> = {}): EssaySummary {
  return {
    ...workspaceEssayFixture,
    ...overrides,
  };
}

function essay(overrides: Partial<EssaySummary> = {}) {
  return essayFromSummary(summary(overrides));
}

describe("essay API mapping", () => {
  it("maps server summary fields without fake version or risk data", () => {
    expect(
      essay({
        application_id: null,
        comment_count: 2,
        deadline: null,
        essay_type: "Personal statement",
        school_city: null,
        school_name: null,
        school_state: null,
        suggestion_count: 3,
      }),
    ).toEqual(
      expect.objectContaining({
        applicationId: null,
        comments: 2,
        deadline: null,
        dueSoon: false,
        schoolLocation: "All schools",
        schoolName: "Personal statement",
        suggestions: 3,
        type: "Personal statement",
      }),
    );
  });

  it("does not label school-linked essays with missing school metadata as personal statements", () => {
    expect(
      essay({
        application_id: "application-1",
        essay_type: "Supplement",
        school_city: null,
        school_name: null,
        school_state: null,
      }),
    ).toEqual(
      expect.objectContaining({
        applicationId: "application-1",
        schoolLocation: "School-linked essay",
        schoolName: "School unavailable",
        type: "Supplement",
      }),
    );
  });

  it("uses neutral metadata for unlinked non-personal essays", () => {
    expect(
      essay({
        application_id: null,
        essay_type: "Supplement",
        school_city: null,
        school_name: null,
        school_state: null,
      }),
    ).toEqual(
      expect.objectContaining({
        applicationId: null,
        schoolLocation: "No linked school",
        schoolName: "Unlinked essay",
        type: "Supplement",
      }),
    );
  });

  it("uses neutral metadata for linked personal statements without school data", () => {
    expect(
      essay({
        application_id: "application-1",
        essay_type: "Personal statement",
        school_city: null,
        school_name: null,
        school_state: null,
      }),
    ).toEqual(
      expect.objectContaining({
        applicationId: "application-1",
        schoolLocation: "School-linked essay",
        schoolName: "School unavailable",
        type: "Personal statement",
      }),
    );
  });

  it("keeps actual personal statements labeled as personal statements without school metadata", () => {
    expect(
      essay({
        application_id: null,
        essay_type: "Personal statement",
        school_city: null,
        school_name: null,
        school_state: null,
      }),
    ).toEqual(
      expect.objectContaining({
        applicationId: null,
        schoolLocation: "All schools",
        schoolName: "Personal statement",
        type: "Personal statement",
      }),
    );
  });

  it("derives due-soon from the linked application deadline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00Z"));

    expect(isEssayDueSoon("2026-07-20")).toBe(true);
    expect(isEssayDueSoon("2026-08-01")).toBe(false);
    expect(essay({ deadline: "2026-07-12" }).dueSoon).toBe(true);

    vi.useRealTimers();
  });
});

describe("essay filter matching", () => {
  const personal = essay({ essay_type: "Personal statement" });
  const supplement = essay({ essay_type: "Supplement" });
  const needsReview = essay({ status: "Needs review" });
  const hasSuggestions = essay({ suggestion_count: 3 });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches every essay for all", () => {
    expect(matchesFilter(personal, "all")).toBe(true);
    expect(matchesFilter(supplement, "all")).toBe(true);
  });

  it("matches personal statements and supplements", () => {
    expect(matchesFilter(personal, "personal")).toBe(true);
    expect(matchesFilter(supplement, "personal")).toBe(false);
    expect(matchesFilter(supplement, "supplements")).toBe(true);
    expect(matchesFilter(personal, "supplements")).toBe(false);
  });

  it("matches essays needing review", () => {
    expect(matchesFilter(needsReview, "review")).toBe(true);
    expect(matchesFilter(hasSuggestions, "review")).toBe(true);
    expect(matchesFilter(supplement, "review")).toBe(false);
  });

  it("matches due-soon essays", () => {
    expect(matchesFilter(essay({ deadline: "2026-07-12" }), "due-soon")).toBe(
      true,
    );
    expect(matchesFilter(supplement, "due-soon")).toBe(false);
  });
});

describe("essay list filtering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function essays() {
    return [
      essay({
        application_id: null,
        essay_type: "Personal statement",
        school_city: null,
        school_name: null,
        school_state: null,
        title: "Personal statement",
      }),
      essay({
        id: "stanford",
        school_name: "Stanford University",
        status: "Needs review",
        title: "Roommate note",
      }),
      essay({
        deadline: "2026-07-12",
        id: "berkeley",
        school_name: "UC Berkeley",
        title: "Leadership PIQ",
      }),
    ];
  }

  it("builds searchable text from title, school display, location, and type", () => {
    expect(getEssaySearchText(essays()[0]!)).toContain(
      "personal statement personal statement",
    );
  });

  it("filters by query", () => {
    expect(
      filterEssays(essays(), "all", "stanford").map((item) => item.id),
    ).toEqual(["stanford"]);
    expect(
      filterEssays(essays(), "all", "supplement").map((item) => item.id),
    ).toEqual(["stanford", "berkeley"]);
  });

  it("combines query and filter", () => {
    expect(
      filterEssays(essays(), "due-soon", "leadership").map((item) => item.id),
    ).toEqual(["berkeley"]);
    expect(filterEssays(essays(), "personal", "stanford")).toEqual([]);
  });

  it("counts essays by filter", () => {
    expect(countEssaysByFilter(essays(), "all")).toBe(3);
    expect(countEssaysByFilter(essays(), "supplements")).toBe(2);
    expect(countEssaysByFilter(essays(), "due-soon")).toBe(1);
  });
});

describe("essay editor content derivations", () => {
  it("counts words robustly", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("one   two\nthree")).toBe(3);
  });

  it("builds school fallback initials", () => {
    expect(getSchoolFallback("UC Berkeley")).toBe("UB");
    expect(getSchoolFallback("NYU")).toBe("NY");
  });

  it("splits server preview into preview lines", () => {
    expect(getPreviewLines("One\n\nTwo\nThree")).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  it("returns prompt text for essay kinds", () => {
    expect(getEssayPrompt(essay({ essay_type: "Personal statement" }))).toBe(
      commonAppPrompt,
    );
    expect(getEssayPrompt(essay({ prompt: "Custom prompt" }))).toBe(
      "Custom prompt",
    );
    expect(
      getEssayPrompt(essay({ school_name: "Stanford University" })),
    ).toContain("Stanford University supplement");
  });
});
