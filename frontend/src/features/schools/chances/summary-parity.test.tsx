import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";

import { workspaceKeys } from "@/api/workspace/keys";
import type { Profile } from "@/api/workspace/types";
import type {
  Fact,
  SchoolFactsResponse,
} from "@/features/schools/facts/school-facts-types";

import { SchoolChancesPanel } from "./SchoolChancesPanel";
import {
  schoolChancesFactFixtures,
  schoolChancesProfileFixtures,
} from "./school-chances-fixtures";
import {
  buildSchoolChancesModel,
  type ChancesMetric,
  type DistributionModel,
  type GpaModel,
  type SchoolChancesModel,
  type ScoreLaneModel,
} from "./school-chances-model";

/**
 * Plan §9's one unbuilt test (school-chances-minimal-redesign): "every
 * string removed from the visual tree still appears in the `ChartFigure`
 * summary for every fixture." §6 removed a large amount of on-screen text
 * (the bucket grid, the breakdown list, the value row, five of six
 * "Reported 2025-26" stamps) on the promise that none of it actually
 * disappeared — it moved into the `ChartFigure` accessible summary
 * (chart-shell.tsx's sr-only `<figcaption>`), which "does not shrink at
 * all." This file is the standing guard on that promise: it has already
 * been broken twice by hand during this redesign (SAT/ACT losing the GPA
 * path's placement text; a later phase nearly deleting a "shown for
 * context" total that was not in the summary either).
 *
 * The assertions below are derived from `buildSchoolChancesModel`'s own
 * output — the same model the components render from — never from a
 * hand-copied list of literal strings. A regression that stops printing a
 * band, an average, a bucket, or a absence display anywhere (on screen OR
 * in the summary) fails this test; a regression that moves text between
 * the two does not, which is the whole point of a *parity* test.
 */

// ---------------------------------------------------------------------------
// Fixture reconstruction
//
// The dev gallery (`src/features/dev-school-chances/SchoolChancesGalleryPage
// .tsx`, route `/dev/school-chances`) renders the full state matrix this
// test targets, but its per-fixture `data`/`profile` transforms are private
// (not exported) — this test needs the actual `SchoolFactsResponse` for
// each fixture to derive model-based expectations, not just the rendered
// DOM. The helpers below reproduce those transforms exactly, over the same
// `schoolChancesFactFixtures` base fixtures the gallery itself imports, so
// every case here is the literal data one gallery entry renders.
// ---------------------------------------------------------------------------

function mapFacts(
  response: SchoolFactsResponse,
  transform: (fact: Fact) => Fact,
): SchoolFactsResponse {
  const cloned = structuredClone(response);
  return {
    ...cloned,
    sections: cloned.sections.map((section) => ({
      ...section,
      groups: section.groups.map((group) => ({
        ...group,
        facts: group.facts.map(transform),
      })),
    })),
  };
}

function withoutFact(
  response: SchoolFactsResponse,
  key: string,
): SchoolFactsResponse {
  const cloned = structuredClone(response);
  return {
    ...cloned,
    sections: cloned.sections.map((section) => ({
      ...section,
      groups: section.groups.map((group) => ({
        ...group,
        facts: group.facts.filter((fact) => fact.key !== key),
      })),
    })),
  };
}

const REPORTED_PERIOD_OVERRIDES: Record<string, string> = {
  "class_profile.sat_math": "2024-25 band",
  "class_profile.sat_math_distribution": "2023-24 breakdown",
  "class_profile.sat_ebrw": "2022-23 band",
  "class_profile.sat_ebrw_distribution": "2021-22 breakdown",
};

function withReportedPeriods(
  response: SchoolFactsResponse,
): SchoolFactsResponse {
  return mapFacts(response, (fact) => ({
    ...fact,
    reported_period: REPORTED_PERIOD_OVERRIDES[fact.key] ?? fact.reported_period,
  }));
}

function malformedScoreBand(response: SchoolFactsResponse): SchoolFactsResponse {
  return mapFacts(response, (fact) =>
    fact.key === "class_profile.sat_math"
      ? {
          ...fact,
          value: { p25: 900, p75: 950, min: 200, max: 800, submitted_percent: null },
          display: "900-950",
        }
      : fact,
  );
}

function malformedScoreDistribution(
  response: SchoolFactsResponse,
): SchoolFactsResponse {
  return mapFacts(response, (fact) =>
    fact.key === "class_profile.sat_math_distribution"
      ? {
          ...fact,
          value: {
            ...(fact.value as object),
            scale: "gpa",
            buckets: [{ label: "Score of 900 - 950", pct: 100 }],
          },
        }
      : fact,
  );
}

function gpaBoundaryFixture(response: SchoolFactsResponse): SchoolFactsResponse {
  return mapFacts(response, (fact) =>
    fact.key === "class_profile.gpa_distribution"
      ? {
          ...fact,
          value: {
            ...(fact.value as object),
            buckets: [
              { label: "Below 2.00", pct: 10 },
              { label: "2.00 - 2.49", lo: 2, hi: 2.49, pct: 40 },
              { label: "2.49 - 2.99", lo: 2.49, hi: 2.99, pct: 30 },
              { label: "Published group", pct: 20 },
            ],
            sums_to: 100,
          },
        }
      : fact,
  );
}

const { full, partial, allAbsent, absenceStates, stale, noCrawl } =
  schoolChancesFactFixtures;
const { compatible, incompatible, partial: partialProfile } =
  schoolChancesProfileFixtures;

// ---------------------------------------------------------------------------
// Render + text-split helpers
// ---------------------------------------------------------------------------

function renderPanel(
  data: SchoolFactsResponse,
  metric: ChancesMetric,
  profile: Profile | null,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(workspaceKeys.profile.detail(), profile);
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <SchoolChancesPanel data={data} metricParam={metric} profile={profile} />
    </QueryClientProvider>,
  );

  // The summary: chart-figure.tsx's ChartFigure is the ONLY sr-only text
  // mechanism this feature uses — its <figcaption> is the accessible
  // channel plan §6 requires to "not shrink at all."
  const figcaptions = Array.from(container.querySelectorAll("figcaption"));
  const summaryText = figcaptions.map((node) => node.textContent ?? "").join(" • ");

  // The visual tree: everything else. Cloning and stripping the figcaptions
  // (rather than reading `container.textContent` directly) is what makes
  // "visible" and "summary" mutually exclusive, so a mutation that deletes a
  // string from BOTH is the only thing that can fail every assertion below.
  const visibleClone = container.cloneNode(true) as HTMLElement;
  visibleClone.querySelectorAll("figcaption").forEach((node) => node.remove());
  const visibleText = visibleClone.textContent ?? "";

  return { allText: `${visibleText} • ${summaryText}`, summaryText, visibleText };
}

// ---------------------------------------------------------------------------
// Model-derived expectations
//
// Every string asserted below is read off `buildSchoolChancesModel`'s own
// output for the fixture under test, not typed out by hand. `.display`
// fields on an absence state are server-owned wording (the five-state
// grammar: not_reported/not_fetched/not_published/not_collected/malformed)
// carried verbatim from the `Fact` — never locally re-authored here or by
// the components under test.
// ---------------------------------------------------------------------------

function bucketDisclosures(distribution: DistributionModel | null): string[] {
  if (!distribution) return [];
  const out: string[] = [];
  for (const bucket of distribution.buckets) {
    out.push(bucket.label);
    out.push(
      bucket.pct === null
        ? (bucket.absenceDisplay ?? "not reported")
        : `${bucket.pct}%`,
    );
  }
  for (const omitted of distribution.omittedBuckets) {
    out.push(omitted.label);
    out.push(omitted.display);
  }
  return out;
}

function gpaDisclosures(gpa: GpaModel): string[] {
  const out = bucketDisclosures(gpa.distribution);
  if (!gpa.distribution && gpa.distributionState.display) {
    out.push(gpa.distributionState.display);
  }
  // The reported average is only ever surfaced (GpaComparison.tsx's
  // `gpaSummary`/`GpaFallback`) when it is actually the school's source of
  // truth — i.e. the distribution itself isn't usable. When a usable
  // distribution exists, the average is legitimately redundant and neither
  // rendered nor summarized; asserting its presence unconditionally here
  // would be a false disclosure requirement, not a real one.
  if (gpa.average && gpa.schoolSource === "average_fallback") {
    out.push(gpa.average.display);
  }
  return out;
}

function laneDisclosures(lane: ScoreLaneModel): string[] {
  const out = bucketDisclosures(lane.distribution);
  if (!lane.distribution && lane.distributionState.display) {
    out.push(lane.distributionState.display);
  }
  if (lane.band) {
    out.push(String(lane.band.p25), String(lane.band.p75));
  } else if (lane.bandState.display) {
    out.push(lane.bandState.display);
  }
  if (lane.average) out.push(lane.average.display);
  return out;
}

/** Every fact a student is entitled to for this metric's model: the
 * reported band/middle-50%, the reported average, the distribution
 * breakdown, the instrument's testing policy, and any absence state — in
 * whatever server-owned wording the model itself carries. Applied
 * uniformly across gpa/sat/act (the same function, same fields) so a
 * SAT/ACT-only omission shows up as a plain assertion failure rather than
 * needing a bespoke per-metric check. */
function modelDisclosures(
  model: SchoolChancesModel,
  metric: ChancesMetric,
): string[] {
  const out: string[] = [];
  if (model.testPolicy) out.push(model.testPolicy.display);
  if (metric === "gpa" && model.gpa) out.push(...gpaDisclosures(model.gpa));
  if (metric === "sat" && model.sat) {
    for (const lane of model.sat.lanes) out.push(...laneDisclosures(lane));
  }
  if (metric === "act" && model.act) out.push(...laneDisclosures(model.act));
  return out.filter((value) => value.length > 0);
}

// ---------------------------------------------------------------------------
// The state matrix — one entry per dev-gallery fixture this test can
// reconstruct real `data`/`profile` for. `request-error` is the one gallery
// entry skipped: it exercises the profile-fetch retry UI, not a disclosure
// this plan moved or removed, so it has nothing for a summary-parity test
// to check that "full-gpa" doesn't already cover.
// ---------------------------------------------------------------------------

type Case = {
  id: string;
  data: SchoolFactsResponse;
  metric: ChancesMetric;
  profile: Profile | null;
};

const CASES: Case[] = [
  { id: "full-gpa", data: full, metric: "gpa", profile: compatible },
  { id: "partial-gpa", data: partial, metric: "gpa", profile: compatible },
  { id: "all-absent", data: allAbsent, metric: "gpa", profile: compatible },
  { id: "non-four-gpa", data: full, metric: "gpa", profile: incompatible },
  { id: "full-sat", data: full, metric: "sat", profile: compatible },
  {
    id: "sat-total-only",
    data: full,
    metric: "sat",
    profile: { testing: { sat: { total: 1450 } } },
  },
  { id: "partial-profile", data: full, metric: "sat", profile: partialProfile },
  {
    id: "act-band-only",
    data: withoutFact(full, "class_profile.act_composite_distribution"),
    metric: "act",
    profile: compatible,
  },
  { id: "no-student-score", data: full, metric: "sat", profile: null },
  { id: "no-school-data", data: noCrawl, metric: "gpa", profile: compatible },
  { id: "stale-facts", data: stale, metric: "gpa", profile: compatible },
  {
    id: "reported-periods",
    data: withReportedPeriods(full),
    metric: "sat",
    profile: compatible,
  },
  {
    id: "malformed-score-band",
    data: malformedScoreBand(full),
    metric: "sat",
    profile: compatible,
  },
  {
    id: "malformed-score-distribution",
    data: malformedScoreDistribution(full),
    metric: "sat",
    profile: compatible,
  },
  { id: "endpoint-absence-gpa", data: absenceStates, metric: "gpa", profile: compatible },
  { id: "endpoint-absence-sat", data: absenceStates, metric: "sat", profile: compatible },
  { id: "endpoint-absence-act", data: absenceStates, metric: "act", profile: compatible },
  {
    id: "off-grid-values",
    data: full,
    metric: "gpa",
    profile: {
      academics: { gpa_unweighted: "3.825", gpa_scale: "4.0" },
      testing: { sat: { math: 755, ebrw: 740, total: 1495 } },
    },
  },
  {
    id: "unparseable-shared-boundary-gpa",
    data: gpaBoundaryFixture(full),
    metric: "gpa",
    profile: { academics: { gpa_unweighted: "2.49", gpa_scale: "4.0" } },
  },
];

describe("school chances: summary parity (plan §9, §6)", () => {
  test.each(CASES.map((testCase) => [testCase.id, testCase] as const))(
    "%s: every model disclosure survives on screen or in the ChartFigure summary",
    (_id, testCase) => {
      const model = buildSchoolChancesModel(
        testCase.data,
        testCase.profile,
        testCase.metric,
      );
      const { allText } = renderPanel(testCase.data, testCase.metric, testCase.profile);
      const disclosures = modelDisclosures(model, testCase.metric);

      // A fixture with real geometry must actually have something to check —
      // otherwise this loop is vacuously true and proves nothing.
      expect(disclosures.length).toBeGreaterThan(0);

      for (const value of disclosures) {
        expect(allText, `expected "${value}" somewhere in ${testCase.id}`).toContain(
          value,
        );
      }
    },
  );

  test("cross-metric symmetry: a missing student value gets the same class of placement message on GPA, SAT, and ACT", () => {
    // This is the exact defect an earlier phase of this redesign shipped by
    // hand (plan CLAUDE.md context): SAT and ACT lost the placement text
    // the GPA path kept. `gpaProfileMessage` (GpaComparison.tsx) and
    // `profilePlacementMessage` (score-plot-copy.ts) are two different
    // functions with different field names, but they share the same
    // closing clause — "to place yourself on this chart." — which is what
    // this test checks is present on all three metrics, not the exact
    // sentence.
    const shared = "to place yourself on this chart.";
    for (const metric of ["gpa", "sat", "act"] as const) {
      const { allText } = renderPanel(full, metric, null);
      expect(allText, `metric=${metric} missing the shared placement clause`).toContain(
        shared,
      );
    }
  });

  test("the five-state absence vocabulary is carried verbatim, never re-authored, on every metric", () => {
    // Pulled directly off the fixture's own Fact.display fields — not typed
    // out by hand — so this only checks that the exact server wording
    // survives into the rendered output, never a paraphrase of it.
    const facts = absenceStates.sections[0].groups[0].facts;
    const byKey = Object.fromEntries(facts.map((fact) => [fact.key, fact]));
    const averageGpaDisplay = byKey["class_profile.average_gpa"].display;
    const satMathDisplay = byKey["class_profile.sat_math"].display;
    const satEbrwDisplay = byKey["class_profile.sat_ebrw"].display;
    const actCompositeDisplay = byKey["class_profile.act_composite"].display;

    expect(renderPanel(absenceStates, "gpa", compatible).allText).toContain(
      averageGpaDisplay,
    );
    const satText = renderPanel(absenceStates, "sat", compatible).allText;
    expect(satText).toContain(satMathDisplay);
    expect(satText).toContain(satEbrwDisplay);
    expect(renderPanel(absenceStates, "act", compatible).allText).toContain(
      actCompositeDisplay,
    );
  });
});
