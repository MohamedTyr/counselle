import type { SatFilterQuery } from "@/api/sat/types";

/** `satKeys` — SAT practice's TanStack query keys (plan §5.2, §5.3). The
 * session itself (`GET /session`) is deliberately **not** here: `useSatSession`
 * is not TanStack Query (plan §5.3), so it owns no cache key. */
export const satKeys = {
  all: ["sat"] as const,
  taxonomy: () => [...satKeys.all, "taxonomy"] as const,
  counts: (filter: SatFilterQuery) =>
    [...satKeys.all, "counts", filter] as const,
  question: (id: string, contentSha: string) =>
    [...satKeys.all, "question", id, contentSha] as const,
  attempts: (id: string) => [...satKeys.all, "attempts", id] as const,
  stats: (today: string) => [...satKeys.all, "stats", today] as const,
};
