import { useQuery } from "@tanstack/react-query";

import { getSchoolDeadlines } from "@/api/calendar/client";
import { calendarKeys } from "@/api/calendar/keys";

/** One hour. Facts change per crawl, never per student write, so there is no
 * workspace event to invalidate this on; the response's own
 * `Cache-Control: private, max-age=3600` holds the same budget server-side. */
export const SCHOOL_DEADLINES_STALE_TIME_MS = 60 * 60 * 1000;

/** Fetches nothing until the "All schools" layer is switched on. */
export function useSchoolDeadlines({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: calendarKeys.schoolDeadlines(),
    queryFn: getSchoolDeadlines,
    enabled,
    staleTime: SCHOOL_DEADLINES_STALE_TIME_MS,
  });
}
