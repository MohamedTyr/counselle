import { rangeDescriptors } from "@/features/schools/explore/explore-config";
import type {
  ExploreFilters,
  NumericRange,
} from "@/features/schools/explore/explore-types";

/*
 * Everything that used to filter, sort, and account for exclusions
 * client-side now happens server-side (`app/facts/service_explore.py`,
 * plan §5.3) -- the query, the missing-metric accounting, `narrowest`, the
 * facet counts, all of it. What's left here is the two things that are
 * genuinely about the CLIENT's own filter object, not the catalog: is a
 * range active, and how many filters are active.
 */

export function isRangeActive(range: NumericRange): boolean {
  return range.min !== null || range.max !== null;
}

/** How many filters the user has switched on, for the "More filters ③" badge. */
export function countActiveFilters(filters: ExploreFilters): number {
  const enums = [
    filters.control !== "any",
    filters.testPolicy !== "any",
    filters.gender !== "any",
    filters.scoreFit !== "any",
    filters.calendar !== null,
    filters.entranceDifficulty !== null,
    filters.religiousAffiliation !== null,
    filters.major !== null,
    filters.deadlineBefore !== null,
    filters.noApplicationFee,
    filters.offersEarlyDecision,
    filters.offersEarlyAction,
    filters.rollingAdmission,
    filters.hbcu,
    filters.hsi,
    filters.tribal,
    filters.landGrant,
    filters.states.length > 0,
    filters.region.length > 0,
    filters.sizeBucket.length > 0,
    filters.campusSetting.length > 0,
  ].filter(Boolean).length;

  const ranges = rangeDescriptors.filter((descriptor) =>
    isRangeActive(filters.ranges[descriptor.key]),
  ).length;

  return enums + ranges;
}
