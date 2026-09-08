import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import {
  defaultFilters,
  defaultProfile,
  defaultSortKey,
  rangeDescriptors,
} from "@/features/schools/explore/explore-config";
import type {
  Control,
  ExploreFilters,
  Gender,
  NumericRange,
  RangeKey,
  ScoreFit,
  SortDirection,
  SortKey,
  StudentProfile,
  TestPolicy,
} from "@/features/schools/explore/explore-types";

/*
 * Filter state lives in the URL -- shareable, back-button-safe across
 * tabs, and it survives a reload. React state is what renders; the URL is
 * written from it on a 300ms trailing debounce with `replace: true`, so
 * holding the increment button on a number field doesn't push thirty
 * history entries.
 *
 * `useExploreFilters.ts`'s param names ARE the contract (plan §5.3): a
 * shared pre-change URL must keep resolving. Five params changed from the
 * CDS-era codec -- `data`/`noreea` are removed and ignored, `testfit`/
 * `greek` are removed with their filters, `sat` is replaced by
 * `satm`/`satebrw`/`act` (a bare `sat=` is ignored), `outofstate`
 * disappears -- and every retired enum value (`testPolicy=optional`,
 * `testPolicy=blind`, or a `fit=` value from before `scoreFit` existed)
 * falls back to its filter's default instead of erroring.
 */

const URL_WRITE_DEBOUNCE_MS = 300;
const DEFAULT_SORT = `${defaultSortKey}:asc`;

type FlagKey =
  | "noApplicationFee"
  | "offersEarlyDecision"
  | "offersEarlyAction"
  | "rollingAdmission"
  | "includeRolling"
  | "hbcu"
  | "hsi"
  | "tribal"
  | "landGrant";

const FLAG_PARAMS: Record<FlagKey, string> = {
  hbcu: "hbcu",
  hsi: "hsi",
  includeRolling: "includerolling",
  landGrant: "landgrant",
  noApplicationFee: "nofee",
  offersEarlyAction: "ea",
  offersEarlyDecision: "ed",
  rollingAdmission: "rolling",
  tribal: "tribal",
};

type ListKey = "states" | "region" | "sizeBucket" | "campusSetting";

const LIST_PARAMS: Record<ListKey, string> = {
  campusSetting: "campus",
  region: "region",
  sizeBucket: "size",
  states: "state",
};

type NullableStringKey =
  | "religiousAffiliation"
  | "entranceDifficulty"
  | "calendar"
  | "major"
  | "deadlineBefore";

const STRING_PARAMS: Record<NullableStringKey, string> = {
  calendar: "calendar",
  deadlineBefore: "before",
  entranceDifficulty: "difficulty",
  major: "major",
  religiousAffiliation: "affiliation",
};

/** Each enum's real members, for the "unknown value falls back to the
 *  default" rule -- "any" is always the default and is never itself
 *  written to the URL. */
const ENUM_MEMBERS = {
  control: ["public", "private", "private_for_profit"] as Control[],
  gender: ["coed", "women", "men"] as Gender[],
  scoreFit: ["at_or_above_p25", "inside_band", "at_or_above_p75"] as ScoreFit[],
  testPolicy: ["required", "considered", "not_required", "not_reported"] as TestPolicy[],
};

type EnumKey = keyof typeof ENUM_MEMBERS;

const ENUM_PARAMS: Record<EnumKey, string> = {
  control: "control",
  gender: "gender",
  scoreFit: "fit",
  testPolicy: "policy",
};

function parseRange(raw: string | null): NumericRange {
  if (!raw) {
    return { max: null, min: null };
  }

  const [min, max] = raw.split("-");
  const toNumber = (value: string) =>
    value === "" || Number.isNaN(Number(value)) ? null : Number(value);

  return { max: toNumber(max ?? ""), min: toNumber(min ?? "") };
}

function serializeRange(range: NumericRange): string | null {
  if (range.min === null && range.max === null) {
    return null;
  }

  return `${range.min ?? ""}-${range.max ?? ""}`;
}

function parseList(raw: string | null): string[] {
  return raw ? raw.split(",").filter(Boolean) : [];
}

function parseEnum<TKey extends EnumKey>(
  key: TKey,
  raw: string | null,
): (typeof ENUM_MEMBERS)[TKey][number] | "any" {
  const members: readonly string[] = ENUM_MEMBERS[key];
  return raw !== null && members.includes(raw)
    ? (raw as (typeof ENUM_MEMBERS)[TKey][number])
    : "any";
}

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}

function readFilters(params: URLSearchParams): ExploreFilters {
  const ranges = Object.fromEntries(
    rangeDescriptors.map((descriptor) => [descriptor.key, parseRange(params.get(descriptor.key))]),
  ) as ExploreFilters["ranges"];

  const lists = Object.fromEntries(
    Object.entries(LIST_PARAMS).map(([key, param]) => [key, parseList(params.get(param))]),
  ) as Pick<ExploreFilters, ListKey>;

  const strings = Object.fromEntries(
    Object.entries(STRING_PARAMS).map(([key, param]) => [key, params.get(param)]),
  ) as Record<NullableStringKey, string | null>;

  const flags = Object.fromEntries(
    Object.entries(FLAG_PARAMS).map(([key, param]) => [key, params.get(param) === "1"]),
  ) as Pick<ExploreFilters, FlagKey>;

  return {
    ...defaultFilters,
    ...lists,
    ...strings,
    ...flags,
    control: parseEnum("control", params.get(ENUM_PARAMS.control)),
    gender: parseEnum("gender", params.get(ENUM_PARAMS.gender)),
    includeMissing: parseList(params.get("include")) as RangeKey[],
    query: params.get("q") ?? "",
    ranges,
    scoreFit: parseEnum("scoreFit", params.get(ENUM_PARAMS.scoreFit)),
    testPolicy: parseEnum("testPolicy", params.get(ENUM_PARAMS.testPolicy)),
  };
}

function readSort(params: URLSearchParams): { key: SortKey; direction: SortDirection } {
  const raw = params.get("sort") ?? DEFAULT_SORT;
  const [key, direction] = raw.split(":");
  const validKey: SortKey[] = [
    "name",
    "undergraduates",
    "admit",
    "cost",
    "needMet",
    "gradFour",
    "gradSix",
    "retention",
    "deadline",
  ];

  return {
    direction: direction === "desc" ? "desc" : "asc",
    key: validKey.includes(key as SortKey) ? (key as SortKey) : defaultSortKey,
  };
}

function readProfile(params: URLSearchParams): StudentProfile {
  return {
    act: parseNumber(params.get("act")),
    homeState: params.get("home") ?? defaultProfile.homeState,
    satEbrw: parseNumber(params.get("satebrw")),
    satMath: parseNumber(params.get("satm")),
  };
}

function writeFilters(
  params: URLSearchParams,
  filters: ExploreFilters,
  profile: StudentProfile,
  sort: { key: SortKey; direction: SortDirection },
  page: number,
) {
  const set = (key: string, value: string | null) => {
    if (value === null || value === "" || value === "any") {
      params.delete(key);
      return;
    }

    params.set(key, value);
  };

  set("q", filters.query);
  set("include", filters.includeMissing.join(","));
  set("home", profile.homeState);
  set("satm", profile.satMath === null ? null : String(profile.satMath));
  set("satebrw", profile.satEbrw === null ? null : String(profile.satEbrw));
  set("act", profile.act === null ? null : String(profile.act));
  set("page", page <= 1 ? null : String(page));

  const sortValue = `${sort.key}:${sort.direction}`;
  set("sort", sortValue === DEFAULT_SORT ? null : sortValue);

  for (const [key, param] of Object.entries(LIST_PARAMS)) {
    set(param, filters[key as ListKey].join(","));
  }

  for (const [key, param] of Object.entries(STRING_PARAMS)) {
    set(param, filters[key as NullableStringKey]);
  }

  for (const [key, param] of Object.entries(FLAG_PARAMS)) {
    set(param, filters[key as FlagKey] ? "1" : null);
  }

  for (const [key, param] of Object.entries(ENUM_PARAMS)) {
    set(param, filters[key as EnumKey]);
  }

  for (const descriptor of rangeDescriptors) {
    set(descriptor.key, serializeRange(filters.ranges[descriptor.key]));
  }
}

export type ExploreState = {
  filters: ExploreFilters;
  profile: StudentProfile;
  sort: { key: SortKey; direction: SortDirection };
  page: number;
  setFilters: (update: (current: ExploreFilters) => ExploreFilters) => void;
  setProfile: (profile: StudentProfile) => void;
  setSort: (sort: { key: SortKey; direction: SortDirection }) => void;
  setRange: (key: RangeKey, range: NumericRange) => void;
  toggleIncludeMissing: (key: RangeKey) => void;
  loadMore: () => void;
  clearAll: () => void;
};

export function useExploreFilters(): ExploreState {
  const [searchParams, setSearchParams] = useSearchParams();

  // Lazy initializers, so the URL is read exactly once. After mount this
  // hook owns the state and writes to the URL; reading back on every
  // render would fight the debounce and drop in-flight keystrokes.
  const [filters, setFiltersState] = useState<ExploreFilters>(() => readFilters(searchParams));
  const [profile, setProfile] = useState<StudentProfile>(() => readProfile(searchParams));
  const [sort, setSort] = useState(() => readSort(searchParams));
  const [page, setPage] = useState(() => {
    const raw = Number(searchParams.get("page") ?? "1");
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  });

  // A filter, sort, or profile change starts the result set over at one
  // page -- only "Load more" itself grows `page`.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, profile, sort]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          writeFilters(next, filters, profile, sort, page);
          return next;
        },
        { replace: true },
      );
    }, URL_WRITE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [filters, page, profile, setSearchParams, sort]);

  const setFilters = useCallback((update: (current: ExploreFilters) => ExploreFilters) => {
    setFiltersState(update);
  }, []);

  const setRange = useCallback((key: RangeKey, range: NumericRange) => {
    setFiltersState((current) => ({
      ...current,
      ranges: { ...current.ranges, [key]: range },
    }));
  }, []);

  const toggleIncludeMissing = useCallback((key: RangeKey) => {
    setFiltersState((current) => ({
      ...current,
      includeMissing: current.includeMissing.includes(key)
        ? current.includeMissing.filter((entry) => entry !== key)
        : [...current.includeMissing, key],
    }));
  }, []);

  const loadMore = useCallback(() => setPage((current) => current + 1), []);

  const clearAll = useCallback(() => setFiltersState(defaultFilters), []);

  return useMemo(
    () => ({
      clearAll,
      filters,
      loadMore,
      page,
      profile,
      setFilters,
      setProfile,
      setRange,
      setSort,
      sort,
      toggleIncludeMissing,
    }),
    [clearAll, filters, loadMore, page, profile, setFilters, setRange, sort, toggleIncludeMissing],
  );
}
