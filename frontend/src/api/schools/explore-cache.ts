import type { QueryClient } from "@tanstack/react-query";

import { schoolsExploreQueryKey } from "@/api/schools/explore-query-key";

/**
 * A saved-Profile change makes every Explore estimate stale. Cancelling
 * first gives every active query's fetch a real abort signal and makes React
 * Query disregard a late response before the active observers are forced to
 * fetch their replacement.
 */
export async function refreshActiveExploreEstimates(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: schoolsExploreQueryKey });
  await queryClient.invalidateQueries({
    queryKey: schoolsExploreQueryKey,
    refetchType: "active",
  });
}
