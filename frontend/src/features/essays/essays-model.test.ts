import type { Essay } from "@/domain/essay";
import {
  commonAppPrompt,
  countWords,
  escapeHtml,
  estimateInitialWordCount,
  getEssayPrompt,
  getInitialEssayContent,
  getSchoolFallback,
} from "@/features/essays/essay-content";
import {
  countEssaysByFilter,
  filterEssays,
  getEssaySearchText,
  matchesFilter,
} from "@/features/essays/essay-filters";

function essay(overrides: Partial<Essay> & Pick<Essay, "id">): Essay {
  const { id, ...rest } = overrides;

  return {
    comments: 0,
    deadline: "Jan 1, 2027",
    id,
    logoUrl: "",
    previewLines: ["First line"],
    previewTitle: "Title",
    school: "Common App",
    schoolLocation: "All schools",
    status: "Drafting",
    suggestions: 0,
    title: "Common App",
    type: "Supplement",
    updatedAt: "1h ago",
    version: "v1",
    wordCount: 10,
    wordLimit: 250,
    ...rest,
  };
}

describe("essay filter matching", () => {
  const personal = essay({ id: "personal", type: "Personal statement" });
  const supplement = essay({ id: "supplement", type: "Supplement" });
  const needsReview = essay({ id: "needs-review", status: "Needs review" });
  const hasSuggestions = essay({ id: "suggestions", suggestions: 3 });
  const dueSoon = essay({ id: "due-soon", dueSoon: true });

  it("matches every essay for all", () => {
    expect(matchesFilter(personal, "all")).toBe(true);
    expect(matchesFilter(supplement, "all")).toBe(true);
  });

  it("matches personal statements", () => {
    expect(matchesFilter(personal, "personal")).toBe(true);
    expect(matchesFilter(supplement, "personal")).toBe(false);
  });

  it("matches supplements", () => {
    expect(matchesFilter(supplement, "supplements")).toBe(true);
    expect(matchesFilter(personal, "supplements")).toBe(false);
  });

  it("matches essays needing review", () => {
    expect(matchesFilter(needsReview, "review")).toBe(true);
    expect(matchesFilter(hasSuggestions, "review")).toBe(true);
    expect(matchesFilter(supplement, "review")).toBe(false);
  });

  it("matches due-soon essays", () => {
    expect(matchesFilter(dueSoon, "due-soon")).toBe(true);
    expect(matchesFilter(supplement, "due-soon")).toBe(false);
  });
});

describe("essay list filtering", () => {
  const essays = [
    essay({
      id: "common",
      school: "Common App",
      title: "Personal statement",
      type: "Personal statement",
    }),
    essay({
      id: "stanford",
      school: "Stanford",
      status: "Needs review",
      title: "Roommate note",
      type: "Supplement",
    }),
    essay({
      dueSoon: true,
      id: "berkeley",
      school: "UC Berkeley",
      title: "Leadership PIQ",
      type: "Supplement",
    }),
  ];

  it("builds searchable text from title, school, and type", () => {
    expect(getEssaySearchText(essays[0]!)).toBe(
      "personal statement common app personal statement",
    );
  });

  it("filters by query", () => {
    expect(
      filterEssays(essays, "all", "stanford").map((item) => item.id),
    ).toEqual(["stanford"]);
    expect(
      filterEssays(essays, "all", "supplement").map((item) => item.id),
    ).toEqual(["stanford", "berkeley"]);
  });

  it("returns every essay for an empty query", () => {
    expect(filterEssays(essays, "all", "   ").map((item) => item.id)).toEqual([
      "common",
      "stanford",
      "berkeley",
    ]);
  });

  it("combines query and filter", () => {
    expect(
      filterEssays(essays, "due-soon", "leadership").map((item) => item.id),
    ).toEqual(["berkeley"]);
    expect(filterEssays(essays, "personal", "stanford")).toEqual([]);
  });

  it("counts essays by filter", () => {
    expect(countEssaysByFilter(essays, "all")).toBe(3);
    expect(countEssaysByFilter(essays, "supplements")).toBe(2);
    expect(countEssaysByFilter(essays, "due-soon")).toBe(1);
  });
});

describe("essay editor content derivations", () => {
  it("counts words robustly", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("one   two\nthree")).toBe(3);
  });

  it("escapes html-sensitive characters", () => {
    expect(escapeHtml(`A&B <tag> "quote" 'apostrophe'`)).toBe(
      "A&amp;B &lt;tag&gt; &quot;quote&quot; &#39;apostrophe&#39;",
    );
  });

  it("escapes initial essay content", () => {
    const content = getInitialEssayContent(
      essay({
        id: "unsafe",
        previewLines: [`Line with <script> & "quotes"`],
        previewTitle: `Title & <tag>`,
      }),
    );

    expect(content).toContain("Title &amp; &lt;tag&gt;");
    expect(content).toContain(
      "Line with &lt;script&gt; &amp; &quot;quotes&quot;",
    );
  });

  it("creates fallback content for blank essays", () => {
    const content = getInitialEssayContent(
      essay({ id: "empty", previewLines: [], previewTitle: "Untitled" }),
    );

    expect(content).toContain("<h1>Untitled</h1>");
    expect(content).toContain("Start with the most specific moment");
  });

  it("estimates initial word count from html content", () => {
    expect(
      estimateInitialWordCount("<h1>Hello there</h1><p>General Kenobi</p>"),
    ).toBe(4);
  });

  it("builds school fallback initials", () => {
    expect(getSchoolFallback("UC Berkeley")).toBe("UB");
    expect(getSchoolFallback("NYU")).toBe("NY");
  });

  it("returns prompt text for essay kinds", () => {
    expect(getEssayPrompt(essay({ id: "common-app-main" }))).toBe(
      commonAppPrompt,
    );
    expect(
      getEssayPrompt(essay({ id: "personal", type: "Personal statement" })),
    ).toContain("personal statement");
    expect(
      getEssayPrompt(essay({ id: "stanford", school: "Stanford" })),
    ).toContain("Stanford supplement");
  });
});
