import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import { SOURCES, type Source } from "@/features/landing/waitlist/contract";
import {
  CLASS_VALUES,
  NO_FILTERS,
  PLAN_VALUES,
  WHO_VALUES,
  type ClassValue,
  type FilterKey,
  type Filters,
  type PlanValue,
  type SortDir,
  type Who,
} from "./derive";

// The view lives in the URL (q, who, channel, class, plan, from, dir), so a
// reload, back, or a shared link reproduces it. An unknown value reads as
// no filter rather than a filter that matches nothing.

function oneOf<Value extends string>(
  value: string | null,
  allowed: readonly Value[],
): Value | null {
  return allowed.includes(value as Value) ? (value as Value) : null;
}

export function parseView(params: URLSearchParams): {
  filters: Filters;
  dir: SortDir;
} {
  return {
    filters: {
      q: params.get("q") ?? "",
      who: oneOf<Who>(params.get("who"), WHO_VALUES),
      channel: params.get("channel") || null,
      class: oneOf<ClassValue>(params.get("class"), CLASS_VALUES),
      plan: oneOf<PlanValue>(params.get("plan"), PLAN_VALUES),
      from: oneOf<Source>(params.get("from"), SOURCES),
    },
    dir: params.get("dir") === "asc" ? "asc" : "desc",
  };
}

export function useView() {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseView(params), [params]);

  const setFilters = useCallback(
    (patch: Partial<Filters>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "") next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const clearFilter = useCallback(
    (key: FilterKey) => setFilters({ [key]: NO_FILTERS[key] }),
    [setFilters],
  );

  const clearAll = useCallback(
    () =>
      setParams(
        (current) => {
          const next = new URLSearchParams();
          const dir = current.get("dir");
          if (dir) next.set("dir", dir);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const setDir = useCallback(
    (dir: SortDir) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (dir === "desc") next.delete("dir");
          else next.set("dir", dir);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { ...view, setFilters, clearFilter, clearAll, setDir };
}
