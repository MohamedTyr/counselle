import { describe, expect, test } from "vitest";

import {
  filterSlashCommands,
  findSlashTrigger,
  getActiveSlashQuery,
  removeActiveSlashQuery,
  SLASH_COMMANDS,
  type SlashCommandEntry,
} from "./slash-query";

const catalog: SlashCommandEntry[] = [
  { id: "goal", keyword: "goal", label: "Goal mode" },
];

describe("getActiveSlashQuery", () => {
  test("fires at position 0 with a collapsed caret", () => {
    expect(getActiveSlashQuery("/goal", { start: 5, end: 5 })).toEqual({
      start: 0,
      end: 5,
      query: "goal",
    });
    expect(getActiveSlashQuery("/", { start: 1, end: 1 })).toEqual({
      start: 0,
      end: 1,
      query: "",
    });
  });

  test("does not fire when the slash is not the first character", () => {
    // The defining difference from the skill picker's `@` trigger: a slash
    // appearing mid-word or mid-sentence — e.g. "and/or" — must never open
    // the menu, because the trigger requires position 0.
    expect(getActiveSlashQuery("and/or", { start: 6, end: 6 })).toBeNull();
    expect(getActiveSlashQuery("and/or", { start: 4, end: 4 })).toBeNull();
    expect(
      getActiveSlashQuery("please explain /goal", { start: 21, end: 21 }),
    ).toBeNull();
  });

  test("does not fire on a range selection or on uppercase/invalid tokens", () => {
    expect(getActiveSlashQuery("/goal", { start: 1, end: 5 })).toBeNull();
    expect(getActiveSlashQuery("/Goal", { start: 5, end: 5 })).toBeNull();
    expect(getActiveSlashQuery("/go al", { start: 6, end: 6 })).toBeNull();
  });

  test("stops matching once the caret moves off the leading slash run", () => {
    // Only the run of lowercase-and-hyphen characters immediately after a
    // leading "/" is a valid token; anything else in the text disqualifies it.
    expect(getActiveSlashQuery("/goal now", { start: 9, end: 9 })).toBeNull();
  });
});

describe("findSlashTrigger", () => {
  test("uses the compact caret-only API", () => {
    expect(findSlashTrigger("/go", 3)).toEqual({
      start: 0,
      end: 3,
      query: "go",
    });
    expect(findSlashTrigger("and/or", 6)).toBeNull();
  });
});

describe("removeActiveSlashQuery", () => {
  test("removes the token entirely, leaving no residue and no mention", () => {
    const trigger = findSlashTrigger("/goal", 5);
    expect(trigger).not.toBeNull();
    expect(removeActiveSlashQuery("/goal", trigger!)).toEqual({
      text: "",
      selection: { start: 0, end: 0 },
    });
  });

  test("removes only the matched token when trailing text exists after the caret", () => {
    const text = "/goal and more";
    const trigger = findSlashTrigger(text, 5);
    const result = removeActiveSlashQuery(text, trigger!);
    expect(result.text).toBe(" and more");
    expect(result.selection).toEqual({ start: 0, end: 0 });
  });
});

describe("filterSlashCommands", () => {
  test("returns the full catalog for an empty query", () => {
    expect(filterSlashCommands(catalog, "")).toEqual(catalog);
  });

  test("filters by keyword prefix, case-insensitively", () => {
    expect(filterSlashCommands(catalog, "go")).toEqual(catalog);
    expect(filterSlashCommands(catalog, "GO")).toEqual(catalog);
  });

  test("returns an empty array when nothing matches", () => {
    expect(filterSlashCommands(catalog, "zzz")).toEqual([]);
  });
});

describe("SLASH_COMMANDS", () => {
  test("v1 ships exactly one command", () => {
    expect(SLASH_COMMANDS).toHaveLength(1);
    expect(SLASH_COMMANDS[0]).toEqual({
      id: "goal",
      keyword: "goal",
      label: "Goal mode",
    });
  });
});
