/** `FilterState` codec — `URLSearchParams` (the launched filter, F9) and
 * `localStorage` (the dashboard's saved selection, F10) — plan §5.3, ui-spec
 * §3.3, parity F6, F9, F10, F20. Pure: no React, no fetch.
 *
 * Both representations share one shape. An **empty** `skills` or `bands`
 * array means "all" (F20) — never encode the full taxonomy/band list to say
 * the same thing.
 */

export type SatStatus = "all" | "unsolved" | "incorrect" | "bookmarked";

export interface FilterState {
  readonly skills: readonly string[];
  readonly bands: readonly number[];
  readonly status: SatStatus;
  readonly excludeBluebook: boolean;
}

/** F20: a bare URL or a missing/corrupt saved selection is every skill,
 * every band, any status, minus Bluebook. */
export const DEFAULT_FILTER_STATE: FilterState = {
  skills: [],
  bands: [],
  status: "all",
  excludeBluebook: true,
};

const STATUSES: readonly SatStatus[] = ["all", "unsolved", "incorrect", "bookmarked"];
const VALID_BANDS = new Set([1, 2, 3, 4, 5, 6, 7]);
const STORAGE_KEY = "counselle:sat:filters";

function isSatStatus(value: string): value is SatStatus {
  return (STATUSES as readonly string[]).includes(value);
}

/** Encodes `filter` into the practice route's URL query (F9). `bluebook=1`
 * means *include* Bluebook practice questions — the inverse of the API's
 * `exclude_bluebook` — and is written only when the student opted in; every
 * other case omits it, matching upstream's excluded-by-default (F6). Never
 * wire this straight through to the API parameter; invert it. */
export function filterStateToSearchParams(filter: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.skills.length > 0) {
    params.set("skills", filter.skills.join(","));
  }
  if (filter.bands.length > 0) {
    params.set("bands", filter.bands.map(String).join(","));
  }
  if (filter.status !== "all") {
    params.set("status", filter.status);
  }
  if (!filter.excludeBluebook) {
    params.set("bluebook", "1");
  }
  return params;
}

/** Decodes a practice route URL query back into a `FilterState`. Absence of
 * a parameter means "all" for `skills`/`bands`, `"all"` for `status`, and
 * excluded for Bluebook (F20) — the same defaults a bare `/app/sat/practice`
 * gets. An unrecognised `status` value or out-of-range band is dropped
 * rather than trusted. */
export function filterStateFromSearchParams(params: URLSearchParams): FilterState {
  const skillsParam = params.get("skills");
  const bandsParam = params.get("bands");
  const statusParam = params.get("status");
  const bluebookParam = params.get("bluebook");

  const skills = skillsParam
    ? skillsParam
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean)
    : [];
  const bands = bandsParam
    ? bandsParam
        .split(",")
        .map((band) => Number.parseInt(band, 10))
        .filter((band) => VALID_BANDS.has(band))
    : [];
  const status = statusParam !== null && isSatStatus(statusParam) ? statusParam : "all";
  const excludeBluebook = bluebookParam !== "1";

  return { skills, bands, status, excludeBluebook };
}

/** Reads the dashboard's saved filter selection from `localStorage` (F10).
 * Saved skill codes are validated against `validSkillCodes` (F20's fix: a
 * code the taxonomy no longer has is dropped rather than silently
 * launching an empty, "matches everything" selection). Any read, parse, or
 * shape failure falls back to `DEFAULT_FILTER_STATE`. */
export function loadSavedFilterState(validSkillCodes: readonly string[]): FilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_FILTER_STATE;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_FILTER_STATE;
    }
    const record = parsed as Record<string, unknown>;
    const validCodes = new Set(validSkillCodes);

    const skills = Array.isArray(record.skills)
      ? record.skills.filter(
          (code): code is string => typeof code === "string" && validCodes.has(code),
        )
      : [];
    const bands = Array.isArray(record.bands)
      ? record.bands.filter(
          (band): band is number => typeof band === "number" && VALID_BANDS.has(band),
        )
      : [];
    const status =
      typeof record.status === "string" && isSatStatus(record.status) ? record.status : "all";
    const excludeBluebook =
      typeof record.excludeBluebook === "boolean" ? record.excludeBluebook : true;

    return { skills, bands, status, excludeBluebook };
  } catch {
    return DEFAULT_FILTER_STATE;
  }
}

/** Writes the dashboard's filter selection to `localStorage` (F10). No-ops
 * silently when storage is unavailable (private browsing, quota, disabled
 * storage) — persistence is a convenience, never a requirement to answer
 * questions. */
export function saveFilterState(filter: FilterState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // storage unavailable — the selection just won't persist across visits
  }
}
