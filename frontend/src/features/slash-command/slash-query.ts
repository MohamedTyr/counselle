/**
 * Pure text and catalog helpers for the composer-owned slash command trigger.
 *
 * This module mirrors only the trigger-detection half of
 * `features/skill-picker/skill-query.ts` — caret scanning, token extraction,
 * and catalog filtering. It deliberately does not mirror the skill picker's
 * selection consequence: a slash command has no persistent inline mention,
 * so there is no "replace token with mention" or "spacing normalization"
 * helper here — see `plans/goal-mode-plan.md` §5.5 for the comparison table.
 *
 * Kept framework-free so it is directly unit-testable and so both composers
 * (`ChatComposer` and `AiComposer`) get identical trigger behavior.
 */

export type TextSelection = Readonly<{
  start: number;
  end: number;
}>;

export type ActiveSlashQuery = Readonly<{
  /** Always 0 — the trigger only fires at the very start of the composer. */
  start: number;
  /** Caret position, immediately after the current query. */
  end: number;
  query: string;
}>;

export type TextEdit = Readonly<{
  text: string;
  selection: TextSelection;
}>;

export type SlashCommandEntry = Readonly<{
  /** Stable identifier used to arm the command once explicitly selected. */
  id: string;
  /** The token typed after `/`, e.g. "goal" for `/goal`. */
  keyword: string;
  /** Human-facing label shown in the menu. */
  label: string;
  /** What selecting it does, in one line — a command name alone does not
   *  tell a student what will happen. */
  hint: string;
}>;

/**
 * v1 ships exactly one slash command (§5.5; Part 8 non-goals rules out
 * multiple slash commands). The catalog shape stays general so a second
 * command is additive later, but no multi-command machinery (grouping,
 * categories, async catalog loading) is built ahead of that need.
 */
export const SLASH_COMMANDS: readonly SlashCommandEntry[] = [
  {
    id: "goal",
    keyword: "goal",
    label: "Goal mode",
    hint: "Keeps working until the goal is done, then checks it",
  },
];

/**
 * Position-0-only, lowercase-and-hyphen token, per §5.5's trigger table.
 * Unlike the skill picker's `@` pattern (which matches anywhere after a
 * word boundary), this never matches mid-word or mid-sentence, so a slash
 * inside ordinary text such as "and/or" cannot open the menu.
 */
const SLASH_TOKEN_AT_START = /^\/([a-z-]*)$/;

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
 * Returns the `/query` when the caret is collapsed and the composer text
 * from position 0 to the caret is a valid slash token. Text after the caret
 * is irrelevant, matching the skill picker's caret-anchored behavior.
 */
export function getActiveSlashQuery(
  text: string,
  selection: TextSelection,
): ActiveSlashQuery | null {
  const caret = normalizedSelection(text, selection);

  if (caret.start !== caret.end) {
    return null;
  }

  const beforeCaret = text.slice(0, caret.end);
  const match = SLASH_TOKEN_AT_START.exec(beforeCaret);

  if (!match) {
    return null;
  }

  return { start: 0, end: caret.end, query: match[1] };
}

/** Finds a trigger from the textarea's collapsed caret position. */
export function findSlashTrigger(
  text: string,
  caret: number,
): ActiveSlashQuery | null {
  return getActiveSlashQuery(text, { start: caret, end: caret });
}

/**
 * Removes the slash token entirely. There is no persistent mention to
 * replace it with — the token disappears and the caret lands where the
 * `/` used to be.
 */
export function removeActiveSlashQuery(
  text: string,
  activeQuery: ActiveSlashQuery,
): TextEdit {
  const start = clampSelectionIndex(activeQuery.start, text.length);
  const end = clampSelectionIndex(activeQuery.end, text.length);

  return {
    text: `${text.slice(0, start)}${text.slice(end)}`,
    selection: { start, end: start },
  };
}

function startsWithCaseInsensitive(value: string, query: string): boolean {
  return value.toLocaleLowerCase().startsWith(query.toLocaleLowerCase());
}

/** Filters the command catalog by keyword prefix, preserving catalog order. */
export function filterSlashCommands<T extends SlashCommandEntry>(
  catalog: readonly T[],
  query: string,
): T[] {
  if (!query) {
    return [...catalog];
  }

  return catalog.filter((command) =>
    startsWithCaseInsensitive(command.keyword, query),
  );
}
