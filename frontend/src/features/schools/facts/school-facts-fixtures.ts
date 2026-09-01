import type { SchoolFacts } from "@/features/schools/facts/school-facts-types";
import { cityCollege } from "@/features/schools/facts/fixtures/city-college";
import { northeastern } from "@/features/schools/facts/fixtures/northeastern";
import { yale } from "@/features/schools/facts/fixtures/yale";

/*
 * FIXTURES. EVERY NUMBER IS FABRICATED — see fixtures/shared.ts.
 *
 * One file per school, because the set is deliberately worse than reality
 * and each school exists to exercise a different failure: Yale a partial
 * packet and a sub-50% band, Northeastern a stale edition and an admit rate
 * that will not compute, City College no readable document at all.
 */

const BY_UNITID: Record<number, SchoolFacts> = {
  130794: yale,
  167358: northeastern,
  190567: cityCollege,
};

/**
 * Stands in for the packet read. Returns `null` for a school we hold nothing
 * about at all — which the page renders as an empty state, never as an error.
 */
export function schoolFactsFixture(unitid: number): SchoolFacts | null {
  return BY_UNITID[unitid] ?? null;
}

export const FIXTURE_UNITIDS = Object.keys(BY_UNITID).map(Number);
