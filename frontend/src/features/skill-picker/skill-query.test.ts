import { describe, expect, test } from "vitest";

import {
  filterSkillCatalog,
  findSkillTrigger,
  getActiveSkillQuery,
  insertSkillTrigger,
  insertSkillTriggerAtSelection,
  removeActiveSkillQuery,
  removeSkillTrigger,
  removeSelectedSkill,
  rankSkills,
  selectSkill,
  type SkillCatalogEntryLike,
} from "./skill-query";

const catalog = [
  {
    name: "school-comparison",
    displayName: "School comparison",
    description: "Compare colleges across cost and fit.",
  },
  {
    name: "dossier-assembly",
    displayName: "College dossier",
    description: "Build a detailed profile for one school.",
  },
  {
    name: "admissions-notes",
    displayName: "Admissions notes",
    description: "Find school admissions trends.",
  },
] satisfies SkillCatalogEntryLike[];

describe("getActiveSkillQuery", () => {
  test("recognizes a token at the start or after whitespace", () => {
    expect(getActiveSkillQuery("@school", { start: 7, end: 7 })).toEqual({
      start: 0,
      end: 7,
      query: "school",
    });
    expect(getActiveSkillQuery("Compare @SCH", { start: 12, end: 12 })).toEqual(
      {
        start: 8,
        end: 12,
        query: "SCH",
      },
    );
  });

  test("does not treat email addresses, invalid tokens, or selected text as a trigger", () => {
    expect(
      getActiveSkillQuery("hello@example.com", { start: 17, end: 17 }),
    ).toBeNull();
    expect(
      getActiveSkillQuery("use @school_name", { start: 16, end: 16 }),
    ).toBeNull();
    expect(getActiveSkillQuery("@school", { start: 1, end: 7 })).toBeNull();
  });

  test("uses the caret and leaves text after an earlier token untouched", () => {
    const text = "Compare @school with Duke";
    expect(getActiveSkillQuery(text, { start: 15, end: 15 })).toEqual({
      start: 8,
      end: 15,
      query: "school",
    });
    expect(
      getActiveSkillQuery(text, { start: text.length, end: text.length }),
    ).toBeNull();
  });
});

describe("findSkillTrigger", () => {
  test("uses the compact controller API", () => {
    expect(findSkillTrigger("Compare @school", 15)).toEqual({
      start: 8,
      end: 15,
      query: "school",
    });
  });
});

describe("filterSkillCatalog", () => {
  test("preserves catalog order for an empty query", () => {
    expect(filterSkillCatalog(catalog, "")).toEqual(catalog);
  });

  test("ranks name/display prefixes before substrings and description-only matches", () => {
    expect(
      filterSkillCatalog(catalog, "school").map((skill) => skill.name),
    ).toEqual(["school-comparison", "dossier-assembly", "admissions-notes"]);
  });

  test("matches case-insensitively and returns an empty result when nothing matches", () => {
    expect(
      filterSkillCatalog(catalog, "DOS").map((skill) => skill.name),
    ).toEqual(["dossier-assembly"]);
    expect(filterSkillCatalog(catalog, "nothing")).toEqual([]);
  });

  test("offers the API catalog wrapper used by the hook", () => {
    expect(rankSkills(catalog, "college").map((skill) => skill.name)).toEqual([
      "dossier-assembly",
      "school-comparison",
    ]);
  });
});

describe("text edits", () => {
  test("removes only the active query and restores the caret at its @", () => {
    const text = "Compare @school with Duke";
    const active = getActiveSkillQuery(text, { start: 15, end: 15 });

    expect(active).not.toBeNull();
    expect(removeActiveSkillQuery(text, active!)).toEqual({
      text: "Compare  with Duke",
      selection: { start: 8, end: 8 },
    });
    expect(removeSkillTrigger(text, active!)).toEqual({
      text: "Compare  with Duke",
      caret: 8,
    });
  });

  test("inserts at a middle selection while preserving text on both sides", () => {
    expect(insertSkillTrigger("Compare Duke and Northwestern", 8, 12)).toEqual({
      text: "Compare @ and Northwestern",
      caret: 9,
    });
  });

  test("replaces an already active query instead of duplicating it", () => {
    expect(insertSkillTrigger("Compare @school with Duke", 15, 15)).toEqual({
      text: "Compare @ with Duke",
      caret: 9,
    });
  });

  test("also exposes a structured selection variant for non-DOM callers", () => {
    expect(insertSkillTriggerAtSelection("Duke", { start: 2, end: 2 })).toEqual(
      {
        text: "Du @ke",
        selection: { start: 4, end: 4 },
      },
    );
  });

  test("creates a valid token boundary when a toolbar trigger starts after a word", () => {
    const insertion = insertSkillTrigger("Compare Duke", 12, 12);

    expect(insertion).toEqual({ text: "Compare Duke @", caret: 14 });
    expect(findSkillTrigger(insertion.text, insertion.caret)).toEqual({
      start: 13,
      end: 14,
      query: "",
    });
  });
});

describe("selected skill helpers", () => {
  test("prevents duplicate and over-limit selections without mutating the input", () => {
    const original = ["school-comparison"];

    expect(selectSkill(original, "school-comparison", 3)).toEqual({
      selected: ["school-comparison"],
      outcome: "already-selected",
    });
    expect(selectSkill(original, "dossier-assembly", 1)).toEqual({
      selected: ["school-comparison"],
      outcome: "limit-reached",
    });
    expect(original).toEqual(["school-comparison"]);
  });

  test("adds and removes immutable selected names", () => {
    const selected = selectSkill(["school-comparison"], "dossier-assembly", 3);

    expect(selected).toEqual({
      selected: ["school-comparison", "dossier-assembly"],
      outcome: "added",
    });
    expect(removeSelectedSkill(selected.selected, "school-comparison")).toEqual(
      ["dossier-assembly"],
    );
  });
});
