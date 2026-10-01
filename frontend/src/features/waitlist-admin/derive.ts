// Everything the admin page shows is derived here from the raw rows, as pure
// functions: who someone is, what each filter keeps, the facet counts, the
// daily buckets, the summary sentence and the CSV. Components only render.

import {
  CLASS_YEARS,
  PLAN_IDS,
  PLAN_LABELS,
  ROLE_LABELS,
  SOURCE_LABELS,
  type ClassYear,
  type Source,
  type WaitlistRow,
} from "@/features/landing/waitlist/contract";

export const WHO_VALUES = [
  "student",
  "parent",
  "counselor",
  "school",
  "unanswered",
] as const;
export type Who = (typeof WHO_VALUES)[number];
export const WHO_LABELS: Record<Who, string> = {
  ...ROLE_LABELS,
  school: "School",
  unanswered: "Didn't say",
};

export const CLASS_VALUES = [...CLASS_YEARS, "unanswered"] as const;
export type ClassValue = (typeof CLASS_VALUES)[number];
export const CLASS_LABELS: Record<ClassValue, string> = {
  ...(Object.fromEntries(CLASS_YEARS.map((y) => [y, y])) as Record<
    ClassYear,
    string
  >),
  unanswered: "Didn't say",
};

export const PLAN_VALUES = [...PLAN_IDS, "none"] as const;
export type PlanValue = (typeof PLAN_VALUES)[number];
export const PLAN_VALUE_LABELS: Record<PlanValue, string> = {
  ...PLAN_LABELS,
  none: "Not chosen",
};

/** utm_source can't contain parentheses (UTM_SHAPE), so this never collides. */
export const UNTAGGED = "(untagged)";
export const UNTAGGED_LABEL = "Untagged";

export type Filters = {
  q: string;
  who: Who | null;
  channel: string | null;
  class: ClassValue | null;
  plan: PlanValue | null;
  from: Source | null;
};
export type FilterKey = keyof Filters;
export const NO_FILTERS: Filters = {
  q: "",
  who: null,
  channel: null,
  class: null,
  plan: null,
  from: null,
};

/** "1 signup", "38 signups". */
export function plural(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}

export function whoOf(row: WaitlistRow): Who {
  if (row.side === "school") return "school";
  return row.role ?? "unanswered";
}

/** The form asks only students, parents and people who skipped the role. */
export function wasAskedClass(row: WaitlistRow): boolean {
  return row.side === "me" && row.role !== "counselor";
}

/** null when the form never asked this person for a class year. */
export function classOf(row: WaitlistRow): ClassValue | null {
  if (!wasAskedClass(row)) return null;
  return row.class_of ?? "unanswered";
}

export function channelOf(row: WaitlistRow): string {
  return row.utm_source ?? UNTAGGED;
}

export function channelLabel(channel: string): string {
  return channel === UNTAGGED ? UNTAGGED_LABEL : channel;
}

export function planOf(row: WaitlistRow): PlanValue {
  return row.plan ?? "none";
}

function matches(row: WaitlistRow, filters: Filters, key: FilterKey): boolean {
  switch (key) {
    case "q":
      return row.email.includes(filters.q.trim().toLowerCase());
    case "who":
      return whoOf(row) === filters.who;
    case "channel":
      return channelOf(row) === filters.channel;
    case "class":
      return classOf(row) === filters.class;
    case "plan":
      return planOf(row) === filters.plan;
    case "from":
      return row.source === filters.from;
  }
}

export function activeFilters(filters: Filters): FilterKey[] {
  return (Object.keys(filters) as FilterKey[]).filter((key) =>
    key === "q" ? filters.q.trim() !== "" : filters[key] !== null,
  );
}

/** The rows every active filter keeps, ignoring `except` when given. */
export function applyFilters(
  rows: WaitlistRow[],
  filters: Filters,
  except?: FilterKey,
): WaitlistRow[] {
  const keys = activeFilters(filters).filter((key) => key !== except);
  if (keys.length === 0) return rows;
  return rows.filter((row) => keys.every((key) => matches(row, filters, key)));
}

export type FacetRow<Value extends string> = { value: Value; count: number };
export type Facets = {
  channel: FacetRow<string>[];
  who: FacetRow<Who>[];
  class: FacetRow<ClassValue>[];
};

function tally<Value extends string>(
  rows: WaitlistRow[],
  valueOf: (row: WaitlistRow) => Value | null,
): Map<Value, number> {
  const counts = new Map<Value, number>();
  for (const row of rows) {
    const value = valueOf(row);
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function fixed<Value extends string>(
  values: readonly Value[],
  counts: Map<Value, number>,
): FacetRow<Value>[] {
  return values.map((value) => ({ value, count: counts.get(value) ?? 0 }));
}

/**
 * Each facet counts the rows every other filter keeps (standard faceted
 * search), so choosing a value never collapses its own column. A selected
 * channel stays listed even at 0.
 */
export function facetCounts(rows: WaitlistRow[], filters: Filters): Facets {
  const channels = tally(applyFilters(rows, filters, "channel"), channelOf);
  if (filters.channel !== null && !channels.has(filters.channel))
    channels.set(filters.channel, 0);
  const channel = [...channels]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return {
    channel,
    who: fixed(WHO_VALUES, tally(applyFilters(rows, filters, "who"), whoOf)),
    class: fixed(
      CLASS_VALUES,
      tally(applyFilters(rows, filters, "class"), classOf),
    ),
  };
}

export type SortDir = "desc" | "asc";

export function sortRows(rows: WaitlistRow[], dir: SortDir): WaitlistRow[] {
  const sorted = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  return dir === "asc" ? sorted : sorted.reverse();
}

/** The local calendar day, as YYYY-MM-DD. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `days` local days before `date`'s day; DST-safe, unlike adding ms. */
function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

const MAX_BUCKETS = 90;
const WEEK = 7;

export type Bucket = { key: string; date: Date; count: number; all: number };

/**
 * One bucket per local day from the first signup to today, the last 90 at
 * most, with empty days kept. `count` is the filtered rows, `all` every row.
 */
export function dailyBuckets(
  rows: WaitlistRow[],
  filtered: WaitlistRow[],
  now: Date,
): Bucket[] {
  if (rows.length === 0) return [];
  const today = startOfDay(now);
  const first = rows.reduce((min, row) =>
    row.created_at < min.created_at ? row : min,
  );
  let start = startOfDay(new Date(first.created_at));
  const earliest = shiftDays(today, -(MAX_BUCKETS - 1));
  if (start < earliest) start = earliest;

  const all = tally(rows, (row) => dayKey(new Date(row.created_at)));
  const kept = tally(filtered, (row) => dayKey(new Date(row.created_at)));
  const buckets: Bucket[] = [];
  for (let date = start; date <= today; date = shiftDays(date, 1)) {
    const key = dayKey(date);
    buckets.push({
      key,
      date,
      count: kept.get(key) ?? 0,
      all: all.get(key) ?? 0,
    });
  }
  return buckets;
}

export type Summary = {
  total: number;
  lastWeek: number;
  today: number;
  /** null on a first visit, when there is nothing to compare against. */
  newSince: number | null;
};

export function isNew(row: WaitlistRow, lastSeen: string | null): boolean {
  return lastSeen !== null && row.created_at > lastSeen;
}

/** Always the whole list. "The last 7 days" is today plus the six before it,
 * so it equals the last seven bars. */
export function summary(
  rows: WaitlistRow[],
  total: number,
  now: Date,
  lastSeen: string | null,
): Summary {
  const todayKey = dayKey(now);
  const weekStart = dayKey(shiftDays(now, -(WEEK - 1)));
  let today = 0;
  let lastWeek = 0;
  for (const row of rows) {
    const key = dayKey(new Date(row.created_at));
    if (key === todayKey) today += 1;
    if (key >= weekStart) lastWeek += 1;
  }
  const newSince =
    lastSeen === null
      ? null
      : rows.filter((row) => isNew(row, lastSeen)).length;
  return { total, lastWeek, today, newSince };
}

/** The active filter whose removal brings back the most signups. */
export function narrowest(
  rows: WaitlistRow[],
  filters: Filters,
): { key: FilterKey; count: number } | null {
  let best: { key: FilterKey; count: number } | null = null;
  for (const key of activeFilters(filters)) {
    const count = applyFilters(rows, filters, key).length;
    if (best === null || count > best.count) best = { key, count };
  }
  return best;
}

export function filterLabel(filters: Filters, key: FilterKey): string {
  switch (key) {
    case "q":
      return `Search "${filters.q.trim()}"`;
    case "who":
      return WHO_LABELS[filters.who as Who];
    case "channel":
      return channelLabel(filters.channel as string);
    case "class":
      return `Class of ${CLASS_LABELS[filters.class as ClassValue]}`;
    case "plan":
      return `Plan: ${PLAN_VALUE_LABELS[filters.plan as PlanValue]}`;
    case "from":
      return `From: ${SOURCE_LABELS[filters.from as Source]}`;
  }
}

const CSV_COLUMNS = [
  "email",
  "created_at",
  "updated_at",
  "side",
  "role",
  "class_of",
  "plan",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
] as const satisfies readonly (keyof WaitlistRow)[];

/** A spreadsheet runs a cell that starts like a formula, so prefix a quote. */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | null): string {
  let text = value ?? "";
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 with CRLF and a UTF-8 BOM, so Excel reads it as UTF-8. */
export function toCsv(rows: WaitlistRow[]): string {
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) => CSV_COLUMNS.map((c) => csvCell(row[c])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
