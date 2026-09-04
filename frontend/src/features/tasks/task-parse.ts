// Pure parser for the quick-add grammar (spec §4.2, design §5.2). No React import
// here — the component (`QuickAddBar.tsx`) is what lazy-`import()`s this module on
// first focus, so `chrono-node` stays out of the initial `/app/tasks` chunk; this
// file itself imports `chrono-node` at the top level, which is fine because the
// module as a whole is what gets deferred.
import * as chrono from "chrono-node";

export type QuickAddApplication = {
  id: string;
  school_name: string;
};

export type QuickAddEssay = {
  id: string;
  application_id: string | null;
  title: string;
};

/**
 * The cached lists `@school` / `#essay` fuzzy-match against. Callers pass the
 * already-fetched `useApplications()` / `useEssays()` data — this module never
 * fetches anything itself (capture must work offline, spec §4.2).
 */
export type QuickAddContext = {
  applications: QuickAddApplication[];
  essays: QuickAddEssay[];
};

/**
 * Exact substrings the user has "un-parsed" by clicking a highlighted token off
 * (design §5.2: "excludes that exact substring from parsing for the remainder of
 * this input session"). Matching is by substring text, not character position,
 * because the position of a token shifts as the user keeps typing around it — the
 * substring itself is the stable identity of "the thing they rejected". The
 * component owns this set for the lifetime of one quick-add session and clears it
 * when the input is cleared (Enter or Esc).
 */
export type IgnoredRanges = Set<string>;

export type QuickAddTokenKind = "when" | "deadline" | "flag" | "app" | "essay";

export type QuickAddToken = {
  start: number;
  end: number;
  kind: QuickAddTokenKind;
};

export type ParsedQuickAdd = {
  title: string;
  when_on?: string;
  deadline_on?: string;
  flagged?: boolean;
  application_id?: string;
  essay_id?: string;
  tokens: QuickAddToken[];
  needsCheckIn: boolean;
};

const WAITING_HINT_PATTERN = /\b(waiting on|waiting for|wait for)\b/i;
const DEADLINE_PREFIX_PATTERN = /\b(by|due)\s*$/i;
const TRAILING_FLAG_PATTERN = /!{1,2}\s*$/;

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type DateMatch = { start: number; end: number; date: Date };

/** `by <date>` / `due <date>` → deadline_on. Run before the bare-date pass. */
function findDeadlineMatch(
  input: string,
  referenceDate: Date,
  ignored: IgnoredRanges,
): DateMatch | null {
  const results = chrono.parse(input, referenceDate);
  for (const result of results) {
    const before = input.slice(0, result.index);
    const prefixMatch = before.match(DEADLINE_PREFIX_PATTERN);
    if (!prefixMatch || prefixMatch.index === undefined) {
      continue;
    }
    const start = prefixMatch.index;
    const end = result.index + result.text.length;
    if (ignored.has(input.slice(start, end))) {
      continue;
    }
    return { start, end, date: result.start.date() };
  }
  return null;
}

/** A bare date → when_on. Run against the input with any deadline match masked out. */
function findWhenMatch(
  input: string,
  referenceDate: Date,
  ignored: IgnoredRanges,
  maskRange: { start: number; end: number } | null,
): DateMatch | null {
  let working = input;
  if (maskRange) {
    working =
      input.slice(0, maskRange.start) +
      " ".repeat(maskRange.end - maskRange.start) +
      input.slice(maskRange.end);
  }

  const results = chrono.parse(working, referenceDate);
  for (const result of results) {
    const start = result.index;
    const end = start + result.text.length;
    if (ignored.has(input.slice(start, end))) {
      continue;
    }
    return { start, end, date: result.start.date() };
  }
  return null;
}

function findFlagMatch(
  input: string,
  ignored: IgnoredRanges,
): { start: number; end: number } | null {
  const match = input.match(TRAILING_FLAG_PATTERN);
  if (!match || match.index === undefined) {
    return null;
  }
  const start = match.index;
  const end = input.length;
  if (ignored.has(input.slice(start, end))) {
    return null;
  }
  return { start, end };
}

/** Cheap fuzzy match: substring match, or the query matches the name's initials
 * (so "@mit" resolves "Massachusetts Institute of Technology"). */
function fuzzyMatches(query: string, name: string): boolean {
  // Strip separators (hyphens, underscores) before the substring check, so
  // "#why-mit" matches essay title "Why MIT supplement".
  const strip = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (strip(name).includes(strip(query))) {
    return true;
  }
  // Initials of capitalized words only, so "Massachusetts Institute of
  // Technology" yields "MIT" and not "MIOT" — lowercase filler words ("of",
  // "the", "at") do not contribute a letter.
  const initials = name
    .split(/\s+/)
    .filter((word) => /^[A-Z]/.test(word))
    .map((word) => word[0])
    .join("")
    .toLowerCase();
  return initials === query.toLowerCase();
}

type MentionMatch = { start: number; end: number; id: string };

function findApplicationMatch(
  input: string,
  applications: QuickAddApplication[],
  ignored: IgnoredRanges,
): MentionMatch | null {
  for (const match of input.matchAll(/@([a-zA-Z][\w'-]*)/g)) {
    const query = match[1];
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (ignored.has(input.slice(start, end))) {
      continue;
    }
    const application = applications.find((app) =>
      fuzzyMatches(query, app.school_name),
    );
    if (application) {
      return { start, end, id: application.id };
    }
  }
  return null;
}

function findEssayMatch(
  input: string,
  candidateEssays: QuickAddEssay[],
  ignored: IgnoredRanges,
): MentionMatch | null {
  for (const match of input.matchAll(/#([a-zA-Z][\w'-]*)/g)) {
    const query = match[1];
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (ignored.has(input.slice(start, end))) {
      continue;
    }
    const essay = candidateEssays.find((entry) =>
      fuzzyMatches(query, entry.title),
    );
    if (essay) {
      return { start, end, id: essay.id };
    }
  }
  return null;
}

function removeRanges(input: string, ranges: { start: number; end: number }[]): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;
  for (const range of sorted) {
    result += input.slice(cursor, range.start);
    cursor = range.end;
  }
  result += input.slice(cursor);
  return result.replace(/\s+/g, " ").trim();
}

export function parseQuickAdd(
  input: string,
  ctx: QuickAddContext,
  ignoredRanges: IgnoredRanges = new Set(),
  referenceDate: Date = new Date(),
): ParsedQuickAdd {
  const deadlineMatch = findDeadlineMatch(input, referenceDate, ignoredRanges);
  const whenMatch = findWhenMatch(
    input,
    referenceDate,
    ignoredRanges,
    deadlineMatch,
  );
  const flagMatch = findFlagMatch(input, ignoredRanges);
  const applicationMatch = findApplicationMatch(
    input,
    ctx.applications,
    ignoredRanges,
  );

  // "of the matched/only school" (spec §4.2): scope essays to the @school token
  // just resolved, or — absent one — to the single application in context, if
  // there is exactly one. Otherwise search unscoped.
  let candidateEssays = ctx.essays;
  if (applicationMatch) {
    candidateEssays = ctx.essays.filter(
      (essay) => essay.application_id === applicationMatch.id,
    );
  } else if (ctx.applications.length === 1) {
    const onlyApplicationId = ctx.applications[0].id;
    candidateEssays = ctx.essays.filter(
      (essay) => essay.application_id === onlyApplicationId,
    );
  }
  const essayMatch = findEssayMatch(input, candidateEssays, ignoredRanges);

  const tokens: QuickAddToken[] = [];
  const consumedRanges: { start: number; end: number }[] = [];

  if (deadlineMatch) {
    tokens.push({ start: deadlineMatch.start, end: deadlineMatch.end, kind: "deadline" });
    consumedRanges.push(deadlineMatch);
  }
  if (whenMatch) {
    tokens.push({ start: whenMatch.start, end: whenMatch.end, kind: "when" });
    consumedRanges.push(whenMatch);
  }
  if (flagMatch) {
    tokens.push({ start: flagMatch.start, end: flagMatch.end, kind: "flag" });
    consumedRanges.push(flagMatch);
  }
  if (applicationMatch) {
    tokens.push({ start: applicationMatch.start, end: applicationMatch.end, kind: "app" });
    consumedRanges.push(applicationMatch);
  }
  if (essayMatch) {
    tokens.push({ start: essayMatch.start, end: essayMatch.end, kind: "essay" });
    consumedRanges.push(essayMatch);
  }

  tokens.sort((a, b) => a.start - b.start);

  const title = removeRanges(input, consumedRanges);
  const needsCheckIn =
    WAITING_HINT_PATTERN.test(input) && !whenMatch && !deadlineMatch;

  return {
    title,
    when_on: whenMatch ? toLocalDateString(whenMatch.date) : undefined,
    deadline_on: deadlineMatch ? toLocalDateString(deadlineMatch.date) : undefined,
    flagged: flagMatch ? true : undefined,
    application_id: applicationMatch?.id,
    essay_id: essayMatch?.id,
    tokens,
    needsCheckIn,
  };
}
