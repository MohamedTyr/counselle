import { useQuery } from "@tanstack/react-query";

import { getSchoolFacts } from "@/api/schools/facts";
import { schoolFactsKeys } from "@/api/schools/keys";

/**
 * Five minutes — the app's first explicit `staleTime` (plan §5.2's Q19).
 * The crawl behind this endpoint runs at most once a day, so refetching
 * more often than this buys nothing; `Cache-Control: private, max-age=300`
 * on the response already caps the server side of the same budget.
 */
const FACTS_STALE_TIME_MS = 5 * 60 * 1000;

export function useSchoolFacts(unitid: number | null) {
  return useQuery({
    queryKey: schoolFactsKeys.detail(unitid ?? -1),
    queryFn: () => getSchoolFacts(unitid as number),
    enabled: unitid !== null,
    staleTime: FACTS_STALE_TIME_MS,
  });
}
