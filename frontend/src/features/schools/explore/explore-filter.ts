import {
  CURRENT_CDS_YEAR,
  LITTLE_GREEK_MAX_PERCENT,
  RECENT_CDS_YEAR_SPAN,
  rangeDescriptors,
  sizeBucketOptions,
} from "@/features/schools/explore/explore-config";
import type {
  Control,
  Exclusion,
  ExploreFilters,
  ExploreResult,
  ExploreSchool,
  NarrowestFilter,
  NumericRange,
  SortKey,
  StudentProfile,
} from "@/features/schools/explore/explore-types";

/*
 * Filtering, sorting, and — the part no competitor ships — accounting for
 * what the filters HID.
 *
 * Every range filter silently excludes schools that are MISSING the metric,
 * not just schools that fail it. With imperfect extraction recall that is a
 * large and invisible exclusion, so each one is counted and reported with a
 * one-click override (filters spec §6). A student who filters on graduation
 * rate should never lose the perfect school to an unparsed row without
 * being told.
 */

function isRangeActive(range: NumericRange) {
  return range.min !== null || range.max !== null;
}

function withinRange(value: number, range: NumericRange) {
  if (range.min !== null && value < range.min) {
    return false;
  }

  return range.max === null || value <= range.max;
}

function matchesQuery(school: ExploreSchool, query: string) {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  return `${school.name} ${school.city} ${school.state}`
    .toLowerCase()
    .includes(needle);
}

function matchesSize(school: ExploreSchool, filters: ExploreFilters) {
  if (filters.sizes.length === 0) {
    return true;
  }

  const size = school.undergraduates;

  if (size === null) {
    return false;
  }

  return filters.sizes.some((bucket) => {
    const option = sizeBucketOptions.find((entry) => entry.value === bucket);
    return (
      option !== undefined &&
      size >= option.min &&
      (option.max === null || size < option.max)
    );
  });
}

/** Presets anchored to the student's own score. A school with no band, or
 *  with no score to compare against, cannot answer the question — so it
 *  fails the filter rather than being quietly assumed to pass. */
function matchesTestFit(
  school: ExploreSchool,
  filters: ExploreFilters,
  profile: StudentProfile,
) {
  if (filters.testFit === "any") {
    return true;
  }

  const band = school.testBand;

  if (!band || profile.satScore === null) {
    return false;
  }

  if (filters.testFit === "above75") {
    return profile.satScore >= band.p75;
  }

  if (filters.testFit === "above25") {
    return profile.satScore >= band.p25;
  }

  return profile.satScore >= band.p25 && profile.satScore <= band.p75;
}

function matchesRounds(school: ExploreSchool, filters: ExploreFilters) {
  const codes = school.rounds.map((round) => round.code);

  if (
    filters.offersEarlyDecision &&
    !codes.some((code) => code.startsWith("ED"))
  ) {
    return false;
  }

  if (
    filters.offersEarlyAction &&
    !school.rounds.some((round) => round.code === "EA" || round.code === "REA")
  ) {
    return false;
  }

  if (
    filters.excludeRestrictiveEarlyAction &&
    school.rounds.some((round) => round.restrictive === true)
  ) {
    return false;
  }

  return !filters.rollingAdmission || codes.includes("Rolling");
}

function matchesCampusEnums(school: ExploreSchool, filters: ExploreFilters) {
  if (
    filters.testPolicy !== "any" &&
    school.testPolicy !== filters.testPolicy
  ) {
    return false;
  }

  if (filters.gender !== "any" && school.genderModel !== filters.gender) {
    return false;
  }

  if (filters.calendar !== "any" && school.calendar !== filters.calendar) {
    return false;
  }

  if (filters.greek !== "any") {
    if (school.greekPercent === null) {
      return false;
    }

    const isLittle = school.greekPercent <= LITTLE_GREEK_MAX_PERCENT;
    return filters.greek === "little" ? isLittle : !isLittle;
  }

  return true;
}

function matchesDataWindow(school: ExploreSchool, filters: ExploreFilters) {
  if (filters.dataWindow === "any") {
    return true;
  }

  if (school.cdsYear === null) {
    return false;
  }

  if (filters.dataWindow === "current") {
    return school.cdsYear >= CURRENT_CDS_YEAR;
  }

  return school.cdsYear >= CURRENT_CDS_YEAR - RECENT_CDS_YEAR_SPAN;
}

/** Everything except the range filters, which are handled separately so
 *  their missing-metric exclusions can be counted and disclosed. */
function matchesNonRangeFilters(
  school: ExploreSchool,
  filters: ExploreFilters,
  profile: StudentProfile,
) {
  if (!matchesQuery(school, filters.query)) {
    return false;
  }

  if (filters.states.length > 0 && !filters.states.includes(school.state)) {
    return false;
  }

  if (filters.control !== "any" && school.control !== filters.control) {
    return false;
  }

  if (filters.noApplicationFee && (school.applicationFee ?? 0) > 0) {
    return false;
  }

  return (
    matchesSize(school, filters) &&
    matchesTestFit(school, filters, profile) &&
    matchesRounds(school, filters) &&
    matchesCampusEnums(school, filters) &&
    matchesDataWindow(school, filters)
  );
}

type RangeOutcome = { kept: boolean; missing: Exclusion["key"][] };

/** Returns whether the school survives every active range, and which
 *  ranges dropped it purely because the metric was absent. */
function applyRanges(
  school: ExploreSchool,
  filters: ExploreFilters,
  profile: StudentProfile,
): RangeOutcome {
  const missing: Exclusion["key"][] = [];
  let kept = true;

  for (const descriptor of rangeDescriptors) {
    const range = filters.ranges[descriptor.key];

    if (!isRangeActive(range)) {
      continue;
    }

    const value = descriptor.read(school, profile);

    if (value === null) {
      missing.push(descriptor.key);

      if (!filters.includeMissing.includes(descriptor.key)) {
        kept = false;
      }

      continue;
    }

    if (!withinRange(value, range)) {
      kept = false;
    }
  }

  return { kept, missing };
}

function deadlineTime(school: ExploreSchool) {
  const times = school.rounds
    .map((round) => (round.deadline ? Date.parse(round.deadline) : Number.NaN))
    .filter((time) => !Number.isNaN(time));

  return times.length > 0 ? Math.min(...times) : null;
}

/** Nulls sort last on every key. A missing metric is not a low value. */
function compareBy(sort: SortKey) {
  const readers: Record<SortKey, (school: ExploreSchool) => number | null> = {
    admit: (school) => school.admitRate?.value ?? null,
    cost: (school) => school.cost?.amount ?? null,
    size: (school) => school.undergraduates,
    gradRate: (school) =>
      school.gradSixYear === null ? null : -school.gradSixYear,
    deadline: deadlineTime,
    name: () => null,
  };

  return (a: ExploreSchool, b: ExploreSchool) => {
    if (sort !== "name") {
      const left = readers[sort](a);
      const right = readers[sort](b);

      if (left !== right) {
        if (left === null) return 1;
        if (right === null) return -1;
        return left - right;
      }
    }

    return a.name.localeCompare(b.name);
  };
}

export function runExplore(
  schools: ExploreSchool[],
  filters: ExploreFilters,
  profile: StudentProfile,
  sort: SortKey,
): ExploreResult {
  const missingCounts = new Map<Exclusion["key"], number>();
  const kept: ExploreSchool[] = [];

  for (const school of schools) {
    if (!matchesNonRangeFilters(school, filters, profile)) {
      continue;
    }

    const outcome = applyRanges(school, filters, profile);

    for (const key of outcome.missing) {
      missingCounts.set(key, (missingCounts.get(key) ?? 0) + 1);
    }

    if (outcome.kept) {
      kept.push(school);
    }
  }

  const exclusions = rangeDescriptors
    .filter(
      (descriptor) =>
        !filters.includeMissing.includes(descriptor.key) &&
        (missingCounts.get(descriptor.key) ?? 0) > 0,
    )
    .map((descriptor) => ({
      key: descriptor.key,
      metricLabel: descriptor.metricLabel,
      count: missingCounts.get(descriptor.key) ?? 0,
    }));

  return {
    schools: [...kept].sort(compareBy(sort)),
    exclusions,
    controlCounts: countControls(schools, filters, profile),
    narrowest:
      kept.length > 0 ? null : findNarrowest(schools, filters, profile),
  };
}

/** Facet counts on the enum filter, computed with that filter itself
 *  relaxed so the two numbers always add up to the unfiltered total. */
function countControls(
  schools: ExploreSchool[],
  filters: ExploreFilters,
  profile: StudentProfile,
): Record<Control, number> {
  const relaxed: ExploreFilters = { ...filters, control: "any" };
  const counts: Record<Control, number> = { private: 0, public: 0 };

  for (const school of schools) {
    if (
      matchesNonRangeFilters(school, relaxed, profile) &&
      applyRanges(school, relaxed, profile).kept
    ) {
      counts[school.control] += 1;
    }
  }

  return counts;
}

/** Which single active filter is doing the most damage. Naming the culprit
 *  is the difference between a dead end and a next step. */
function findNarrowest(
  schools: ExploreSchool[],
  filters: ExploreFilters,
  profile: StudentProfile,
): ExploreResult["narrowest"] {
  const candidates: {
    key: NarrowestFilter["key"];
    label: string;
    relaxed: ExploreFilters;
  }[] = [];

  for (const descriptor of rangeDescriptors) {
    if (isRangeActive(filters.ranges[descriptor.key])) {
      candidates.push({
        key: descriptor.key,
        label: descriptor.label,
        relaxed: {
          ...filters,
          ranges: {
            ...filters.ranges,
            [descriptor.key]: { max: null, min: null },
          },
        },
      });
    }
  }

  if (filters.states.length > 0) {
    candidates.push({
      key: "states",
      label: "Location",
      relaxed: { ...filters, states: [] },
    });
  }

  if (filters.sizes.length > 0) {
    candidates.push({
      key: "sizes",
      label: "Size",
      relaxed: { ...filters, sizes: [] },
    });
  }

  const scored = candidates
    .map((candidate) => ({
      key: candidate.key,
      label: candidate.label,
      remainingWithoutIt: schools.filter(
        (school) =>
          matchesNonRangeFilters(school, candidate.relaxed, profile) &&
          applyRanges(school, candidate.relaxed, profile).kept,
      ).length,
    }))
    .sort((a, b) => b.remainingWithoutIt - a.remainingWithoutIt);

  return scored.length > 0 && scored[0].remainingWithoutIt > 0
    ? scored[0]
    : null;
}

/** Clear exactly the one filter that findNarrowest named. */
export function relaxFilter(
  filters: ExploreFilters,
  key: NarrowestFilter["key"],
): ExploreFilters {
  if (key === "states") {
    return { ...filters, states: [] };
  }

  if (key === "sizes") {
    return { ...filters, sizes: [] };
  }

  return {
    ...filters,
    ranges: { ...filters.ranges, [key]: { max: null, min: null } },
  };
}

/** How many filters the user has switched on, for the "More filters ③" badge. */
export function countActiveFilters(filters: ExploreFilters): number {
  const enums = [
    filters.control !== "any",
    filters.testFit !== "any",
    filters.testPolicy !== "any",
    filters.greek !== "any",
    filters.gender !== "any",
    filters.calendar !== "any",
    filters.dataWindow !== "any",
    filters.noApplicationFee,
    filters.offersEarlyDecision,
    filters.offersEarlyAction,
    filters.excludeRestrictiveEarlyAction,
    filters.rollingAdmission,
    filters.states.length > 0,
    filters.sizes.length > 0,
  ].filter(Boolean).length;

  const ranges = rangeDescriptors.filter((descriptor) =>
    isRangeActive(filters.ranges[descriptor.key]),
  ).length;

  return enums + ranges;
}

export { isRangeActive };
