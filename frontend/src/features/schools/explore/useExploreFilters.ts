import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import {
  defaultFilters,
  defaultProfile,
  rangeDescriptors,
} from "@/features/schools/explore/explore-config";
import type {
  ExploreFilters,
  NumericRange,
  RangeKey,
  SortKey,
  StudentProfile,
} from "@/features/schools/explore/explore-types";

/*
 * Filter state lives in the URL (filters spec §7.1) — shareable,
 * back-button-safe across tabs, and it survives a reload.
 *
 * React state is what renders; the URL is written from it on a 300ms
 * trailing debounce with `replace: true`, so holding the increment button
 * on a number field doesn't push thirty history entries. Only the tab
 * switch pushes (see SchoolsRoute), which is what makes Back mean "go back
 * to My list" rather than "undo one keystroke".
 */

const URL_WRITE_DEBOUNCE_MS = 300;

type FlagKey =
  | "noApplicationFee"
  | "offersEarlyDecision"
  | "offersEarlyAction"
  | "excludeRestrictiveEarlyAction"
  | "rollingAdmission";

const FLAG_PARAMS: Record<FlagKey, string> = {
  excludeRestrictiveEarlyAction: "noreea",
  noApplicationFee: "nofee",
  offersEarlyAction: "ea",
  offersEarlyDecision: "ed",
  rollingAdmission: "rolling",
};

type EnumKey =
  | "control"
  | "testFit"
  | "testPolicy"
  | "greek"
  | "gender"
  | "calendar"
  | "dataWindow";

const ENUM_PARAMS: Record<EnumKey, string> = {
  calendar: "calendar",
  control: "control",
  dataWindow: "data",
  gender: "gender",
  greek: "greek",
  testFit: "testfit",
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

function readFilters(params: URLSearchParams): ExploreFilters {
  const ranges = Object.fromEntries(
    rangeDescriptors.map((descriptor) => [
      descriptor.key,
      parseRange(params.get(descriptor.key)),
    ]),
  ) as ExploreFilters["ranges"];

  const enums = Object.fromEntries(
    Object.entries(ENUM_PARAMS).map(([key, param]) => [
      key,
      params.get(param) ?? defaultFilters[key as EnumKey],
    ]),
  ) as Pick<ExploreFilters, EnumKey>;

  const flags = Object.fromEntries(
    Object.entries(FLAG_PARAMS).map(([key, param]) => [
      key,
      params.get(param) === "1",
    ]),
  ) as Pick<ExploreFilters, FlagKey>;

  return {
    ...defaultFilters,
    ...enums,
    ...flags,
    includeMissing: parseList(params.get("include")) as RangeKey[],
    query: params.get("q") ?? "",
    ranges,
    sizes: parseList(params.get("size")) as ExploreFilters["sizes"],
    states: parseList(params.get("state")),
  };
}

function writeFilters(
  params: URLSearchParams,
  filters: ExploreFilters,
  profile: StudentProfile,
  sort: SortKey,
) {
  const set = (key: string, value: string | null) => {
    if (value === null || value === "" || value === "any") {
      params.delete(key);
      return;
    }

    params.set(key, value);
  };

  set("q", filters.query);
  set("state", filters.states.join(","));
  set("size", filters.sizes.join(","));
  set("include", filters.includeMissing.join(","));
  set("sort", sort === "admit" ? null : sort);
  set("home", profile.homeState);
  set("sat", profile.satScore === null ? null : String(profile.satScore));

  for (const [key, param] of Object.entries(ENUM_PARAMS)) {
    set(param, filters[key as EnumKey]);
  }

  for (const [key, param] of Object.entries(FLAG_PARAMS)) {
    set(param, filters[key as FlagKey] ? "1" : null);
  }

  for (const descriptor of rangeDescriptors) {
    set(descriptor.key, serializeRange(filters.ranges[descriptor.key]));
  }
}

export type ExploreState = {
  filters: ExploreFilters;
  profile: StudentProfile;
  sort: SortKey;
  setFilters: (update: (current: ExploreFilters) => ExploreFilters) => void;
  setProfile: (profile: StudentProfile) => void;
  setSort: (sort: SortKey) => void;
  setRange: (key: RangeKey, range: NumericRange) => void;
  toggleIncludeMissing: (key: RangeKey) => void;
  clearAll: () => void;
};

export function useExploreFilters(): ExploreState {
  const [searchParams, setSearchParams] = useSearchParams();

  // Lazy initializers, so the URL is read exactly once. After mount this
  // hook owns the state and writes to the URL; reading back on every render
  // would fight the debounce and drop in-flight keystrokes.
  const [filters, setFiltersState] = useState<ExploreFilters>(() =>
    readFilters(searchParams),
  );
  const [profile, setProfile] = useState<StudentProfile>(() => ({
    homeState: searchParams.get("home") ?? defaultProfile.homeState,
    satScore: searchParams.get("sat") ? Number(searchParams.get("sat")) : null,
  }));
  const [sort, setSort] = useState<SortKey>(
    () => (searchParams.get("sort") as SortKey | null) ?? "admit",
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          writeFilters(next, filters, profile, sort);
          return next;
        },
        { replace: true },
      );
    }, URL_WRITE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [filters, profile, setSearchParams, sort]);

  const setFilters = useCallback(
    (update: (current: ExploreFilters) => ExploreFilters) => {
      setFiltersState(update);
    },
    [],
  );

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

  const clearAll = useCallback(() => setFiltersState(defaultFilters), []);

  return useMemo(
    () => ({
      clearAll,
      filters,
      profile,
      setFilters,
      setProfile,
      setRange,
      setSort,
      sort,
      toggleIncludeMissing,
    }),
    [
      clearAll,
      filters,
      profile,
      setFilters,
      setRange,
      sort,
      toggleIncludeMissing,
    ],
  );
}
