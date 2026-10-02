import type { EligibilityKind, ScholarshipPublic } from "@/api/scholarships/types";
import { summarizeFit, type Fit, type ProfileFacts } from "@/features/scholarships/eligibility";
import {
  awardSortValue,
  daysUntil,
  deadlineSortValue,
  hasEssay,
  isClosed,
} from "@/features/scholarships/scholarship-format";

export type ScholarshipTab = "foryou" | "all" | "saved";
export type ScholarshipSort = "deadline" | "amount" | "newest";
export type DeadlineWindow = "any" | "30" | "90" | "rolling";
export type BasisFilter = "any" | "merit" | "need";

export type ScholarshipFilters = {
  view: ScholarshipTab;
  q: string;
  sort: ScholarshipSort;
  minAmount: number | null;
  window: DeadlineWindow;
  basis: BasisFilter;
  noEssay: boolean;
  renewable: boolean;
  fields: string[];
  ignored: EligibilityKind[];
};

/** The filters that narrow the list, in the order the chips appear. */
export type FilterKey = "minAmount" | "window" | "basis" | "noEssay" | "renewable" | "fields";

export const FILTER_LABELS: Record<FilterKey, string> = {
  minAmount: "Amount",
  window: "Deadline",
  basis: "Type",
  noEssay: "No essay",
  renewable: "Renewable",
  fields: "Field of study",
};

export const SORT_LABELS: Record<ScholarshipSort, string> = {
  deadline: "Deadline",
  amount: "Amount",
  newest: "Recently added",
};

const DEFAULTS: ScholarshipFilters = {
  view: "foryou",
  q: "",
  sort: "deadline",
  minAmount: null,
  window: "any",
  basis: "any",
  noEssay: false,
  renewable: false,
  fields: [],
  ignored: [],
};

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return value !== null && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function list(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

export function parseFilters(params: URLSearchParams): ScholarshipFilters {
  const min = Number.parseInt(params.get("min") ?? "", 10);
  return {
    view: oneOf(params.get("view"), ["foryou", "all", "saved"], DEFAULTS.view),
    q: params.get("q") ?? "",
    sort: oneOf(params.get("sort"), ["deadline", "amount", "newest"], DEFAULTS.sort),
    minAmount: Number.isFinite(min) && min > 0 ? min : null,
    window: oneOf(params.get("window"), ["any", "30", "90", "rolling"], DEFAULTS.window),
    basis: oneOf(params.get("basis"), ["any", "merit", "need"], DEFAULTS.basis),
    noEssay: params.get("noessay") === "1",
    renewable: params.get("renewable") === "1",
    fields: list(params.get("fields")),
    ignored: list(params.get("ignore")) as EligibilityKind[],
  };
}

/** Writes only non-default values, preserving unrelated params (`s`). */
export function writeFilters(params: URLSearchParams, filters: ScholarshipFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null) => {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  };
  set("view", filters.view === DEFAULTS.view ? null : filters.view);
  set("q", filters.q.trim() ? filters.q : null);
  set("sort", filters.sort === DEFAULTS.sort ? null : filters.sort);
  set("min", filters.minAmount === null ? null : String(filters.minAmount));
  set("window", filters.window === "any" ? null : filters.window);
  set("basis", filters.basis === "any" ? null : filters.basis);
  set("noessay", filters.noEssay ? "1" : null);
  set("renewable", filters.renewable ? "1" : null);
  set("fields", filters.fields.length ? filters.fields.join(",") : null);
  set("ignore", filters.ignored.length ? filters.ignored.join(",") : null);
  return next;
}

export function activeFilterKeys(filters: ScholarshipFilters): FilterKey[] {
  const keys: FilterKey[] = [];
  if (filters.minAmount !== null) keys.push("minAmount");
  if (filters.window !== "any") keys.push("window");
  if (filters.basis !== "any") keys.push("basis");
  if (filters.noEssay) keys.push("noEssay");
  if (filters.renewable) keys.push("renewable");
  if (filters.fields.length) keys.push("fields");
  return keys;
}

export function clearFilter(filters: ScholarshipFilters, key: FilterKey): ScholarshipFilters {
  return { ...filters, [key]: DEFAULTS[key] };
}

export function clearAllFilters(filters: ScholarshipFilters): ScholarshipFilters {
  return { ...DEFAULTS, view: filters.view, sort: filters.sort, ignored: filters.ignored };
}

function matchesFilter(item: ScholarshipPublic, filters: ScholarshipFilters, key: FilterKey): boolean {
  switch (key) {
    case "minAmount": {
      const award = item.award;
      if (award.kind === "full_ride" || award.kind === "full_tuition") return true;
      const top = award.kind === "range" ? award.max : award.amount;
      return top !== null && top >= (filters.minAmount ?? 0);
    }
    case "window": {
      if (filters.window === "rolling") return item.deadline.kind === "rolling";
      if (item.deadline.kind === "rolling" || !item.deadline.date) return false;
      return daysUntil(item.deadline.date) <= Number(filters.window);
    }
    case "basis":
      return item.basis.includes(filters.basis as "merit" | "need");
    case "noEssay":
      return !hasEssay(item.requirements);
    case "renewable":
      return item.award.renewable;
    case "fields":
      return item.fields.length === 0 || item.fields.some((field) => filters.fields.includes(field));
  }
}

function matchesQuery(item: ScholarshipPublic, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [item.name, item.sponsor, item.summary, ...item.fields].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

export type Listed = { item: ScholarshipPublic; fit: Fit };

export type FilterResult = {
  open: Listed[];
  closed: Listed[];
  /** Rows hidden on "For you" because the profile rules them out. */
  hiddenIneligible: number;
  /** For filtered-to-zero: the filter whose removal frees the most rows. */
  narrowest: { key: FilterKey; count: number } | null;
};

type Context = { facts: ProfileFacts; savedIds: readonly string[] };

function passes(listed: Listed, filters: ScholarshipFilters, ctx: Context, skip?: FilterKey) {
  const { item } = listed;
  if (filters.view === "saved" && !ctx.savedIds.includes(item.id)) return false;
  if (!matchesQuery(item, filters.q)) return false;
  return activeFilterKeys(filters).every((key) => key === skip || matchesFilter(item, filters, key));
}

function compare(sort: ScholarshipSort) {
  return (a: Listed, b: Listed) => {
    if (sort === "amount") return awardSortValue(b.item.award) - awardSortValue(a.item.award);
    if (sort === "newest") return b.item.created_at.localeCompare(a.item.created_at);
    return deadlineSortValue(a.item.deadline) - deadlineSortValue(b.item.deadline);
  };
}

export function applyFilters(
  items: ScholarshipPublic[],
  filters: ScholarshipFilters,
  ctx: Context,
): FilterResult {
  const ignored = new Set(filters.ignored);
  const listed = items.map((item) => ({ item, fit: summarizeFit(item, ctx.facts, ignored) }));
  const hideIneligible = filters.view === "foryou";
  const eligible = hideIneligible ? listed.filter((row) => row.fit.kind !== "ineligible") : listed;
  const shown = eligible.filter((row) => passes(row, filters, ctx)).sort(compare(filters.sort));
  const hiddenIneligible = hideIneligible
    ? listed.filter((row) => row.fit.kind === "ineligible" && passes(row, filters, ctx)).length
    : 0;

  let narrowest: FilterResult["narrowest"] = null;
  if (shown.length === 0) {
    for (const key of activeFilterKeys(filters)) {
      const count = eligible.filter((row) => passes(row, filters, ctx, key)).length;
      if (count > 0 && (!narrowest || count > narrowest.count)) narrowest = { key, count };
    }
  }

  return {
    open: shown.filter((row) => !isClosed(row.item.deadline)),
    closed: shown.filter((row) => isClosed(row.item.deadline)),
    hiddenIneligible,
    narrowest,
  };
}

export function fieldOptions(items: ScholarshipPublic[]): string[] {
  return [...new Set(items.flatMap((item) => item.fields))].sort();
}
