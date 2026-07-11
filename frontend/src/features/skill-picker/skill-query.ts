import type { SkillCatalogEntry } from "@/api/chat/types";

/**
 * Pure text and catalog helpers for the composer-owned skill picker.
 *
 * These helpers deliberately know nothing about React or the DOM.  Keeping the
 * selection arithmetic here makes it possible for the home and session
 * composers to have precisely the same mention behavior.
 */

export type SkillCatalogEntryLike = Readonly<{
  name: string;
  displayName: string;
  description: string;
}>;

export type TextSelection = Readonly<{
  start: number;
  end: number;
}>;

export type ActiveSkillQuery = Readonly<{
  /** Index of the `@` that began the active token. */
  start: number;
  /** Caret position, immediately after the current query. */
  end: number;
  query: string;
}>;

/** Backwards-compatible name used by the picker controller. */
export type SkillTrigger = ActiveSkillQuery;

export type TextEdit = Readonly<{
  text: string;
  selection: TextSelection;
}>;

export type SelectSkillResult = Readonly<{
  selected: readonly string[];
  outcome: "added" | "already-selected" | "limit-reached";
}>;

const SKILL_TOKEN_AT_CARET = /(?:^|\s)@([A-Za-z0-9-]*)$/;

function clampSelectionIndex(value: number, textLength: number): number {
  return Math.max(0, Math.min(value, textLength));
}

function normalizedSelection(
  text: string,
  selection: TextSelection,
): TextSelection {
  const start = clampSelectionIndex(selection.start, text.length);
  const end = clampSelectionIndex(selection.end, text.length);

  return start <= end ? { start, end } : { start: end, end: start };
}

/**
 * Returns the `@query` immediately before a collapsed caret, if it is a valid
 * composer token.  Text after the caret is intentionally irrelevant: users
 * can move back into an earlier token and replace only that token.
 */
export function getActiveSkillQuery(
  text: string,
  selection: TextSelection,
): ActiveSkillQuery | null {
  const caret = normalizedSelection(text, selection);

  if (caret.start !== caret.end) {
    return null;
  }

  const beforeCaret = text.slice(0, caret.end);
  const match = SKILL_TOKEN_AT_CARET.exec(beforeCaret);

  if (!match) {
    return null;
  }

  return {
    start: caret.end - match[1].length - 1,
    end: caret.end,
    query: match[1],
  };
}

/** Finds a trigger from the textarea's collapsed caret position. */
export function findSkillTrigger(
  text: string,
  caret: number,
): SkillTrigger | null {
  return getActiveSkillQuery(text, { start: caret, end: caret });
}

function includesCaseInsensitive(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query);
}

function startsWithCaseInsensitive(value: string, query: string): boolean {
  return value.toLocaleLowerCase().startsWith(query);
}

/**
 * Filters a server-ordered catalog without introducing fuzzy-search behavior.
 * Prefixes in the canonical/display name are strongest, name/display
 * substrings follow, and description-only matches come last.  Array filtering
 * preserves server order within each rank.
 */
export function filterSkillCatalog<T extends SkillCatalogEntryLike>(
  catalog: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.toLocaleLowerCase();

  if (!normalizedQuery) {
    return [...catalog];
  }

  const nameOrDisplayPrefix: T[] = [];
  const nameOrDisplaySubstring: T[] = [];
  const descriptionSubstring: T[] = [];

  for (const skill of catalog) {
    const namePrefix = startsWithCaseInsensitive(skill.name, normalizedQuery);
    const displayPrefix = startsWithCaseInsensitive(
      skill.displayName,
      normalizedQuery,
    );

    if (namePrefix || displayPrefix) {
      nameOrDisplayPrefix.push(skill);
      continue;
    }

    const nameMatch = includesCaseInsensitive(skill.name, normalizedQuery);
    const displayMatch = includesCaseInsensitive(
      skill.displayName,
      normalizedQuery,
    );

    if (nameMatch || displayMatch) {
      nameOrDisplaySubstring.push(skill);
      continue;
    }

    if (includesCaseInsensitive(skill.description, normalizedQuery)) {
      descriptionSubstring.push(skill);
    }
  }

  return [
    ...nameOrDisplayPrefix,
    ...nameOrDisplaySubstring,
    ...descriptionSubstring,
  ];
}

/** Picker-facing catalog ranking over the API's canonical presentation type. */
export function rankSkills<T extends SkillCatalogEntry>(
  catalog: readonly T[],
  query: string,
): T[] {
  return filterSkillCatalog(catalog, query);
}

/** Removes the active mention token and puts the caret where its `@` was. */
export function removeActiveSkillQuery(
  text: string,
  activeQuery: ActiveSkillQuery,
): TextEdit {
  const start = clampSelectionIndex(activeQuery.start, text.length);
  const end = clampSelectionIndex(activeQuery.end, text.length);
  const tokenStart = Math.min(start, end);
  const tokenEnd = Math.max(start, end);

  return {
    text: `${text.slice(0, tokenStart)}${text.slice(tokenEnd)}`,
    selection: { start: tokenStart, end: tokenStart },
  };
}

/** Removes a trigger in the controller's compact `{ text, caret }` form. */
export function removeSkillTrigger(
  text: string,
  trigger: SkillTrigger,
): Readonly<{ text: string; caret: number }> {
  const replacement = removeActiveSkillQuery(text, trigger);
  return { text: replacement.text, caret: replacement.selection.start };
}

/**
 * Inserts a new trigger at the selection.  When the caret is already in a
 * valid `@query`, it replaces the entire query rather than duplicating it.
 */
export function insertSkillTriggerAtSelection(
  text: string,
  selection: TextSelection,
): TextEdit {
  const currentSelection = normalizedSelection(text, selection);
  const activeQuery = getActiveSkillQuery(text, currentSelection);
  const replacement = activeQuery
    ? { start: activeQuery.start, end: activeQuery.end }
    : currentSelection;
  const requiresBoundary =
    replacement.start > 0 && !/\s/.test(text[replacement.start - 1] ?? "");
  const prefix = requiresBoundary ? " @" : "@";
  const nextText = `${text.slice(0, replacement.start)}${prefix}${text.slice(replacement.end)}`;
  const caret = replacement.start + prefix.length;

  return {
    text: nextText,
    selection: { start: caret, end: caret },
  };
}

/**
 * Toolbar-facing insertion API.  A typed trigger is replaced atomically, so
 * pressing the toolbar button cannot leave two `@` tokens next to each other.
 */
export function insertSkillTrigger(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): Readonly<{ text: string; caret: number }> {
  const replacement = insertSkillTriggerAtSelection(text, {
    start: selectionStart,
    end: selectionEnd,
  });

  return { text: replacement.text, caret: replacement.selection.start };
}

/** Adds a skill once, enforcing the server-provided per-turn selection cap. */
export function selectSkill(
  selected: readonly string[],
  skillName: string,
  maxSelectedSkills: number,
): SelectSkillResult {
  if (selected.includes(skillName)) {
    return { selected: [...selected], outcome: "already-selected" };
  }

  if (selected.length >= maxSelectedSkills) {
    return { selected: [...selected], outcome: "limit-reached" };
  }

  return { selected: [...selected, skillName], outcome: "added" };
}

/** Removes every occurrence defensively, returning a fresh immutable value. */
export function removeSelectedSkill(
  selected: readonly string[],
  skillName: string,
): string[] {
  return selected.filter((selectedName) => selectedName !== skillName);
}
