import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { workspaceKeys } from "@/api/workspace/keys";
import type { Profile } from "@/api/workspace/types";
import { cn } from "@/lib/utils";
import { SchoolChancesPanel } from "@/features/schools/chances/SchoolChancesPanel";
import {
  schoolChancesFactFixtures,
  schoolChancesProfileFixtures,
  withAdmitRate,
} from "@/features/schools/chances/school-chances-fixtures";
import type {
  Fact,
  SchoolFactsResponse,
} from "@/features/schools/facts/school-facts-types";

type GalleryFixture = {
  id: string;
  title: string;
  description: string;
  metric: "gpa" | "sat" | "act";
  data: SchoolFactsResponse;
  profile?: Profile | null;
  profileRequestError?: boolean;
  absenceSummary?: string[];
};

const compatible = schoolChancesProfileFixtures.compatible;

/**
 * A dev-only visual harness for the complete chances state matrix. It owns no
 * data fetching: the local QueryClient is seeded so the real panel can keep
 * its production composition while this page remains safe to open without an
 * API, Profile row, or database.
 */
export function SchoolChancesGalleryPage(): React.ReactElement {
  const queryClient = React.useMemo(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });
    client.setQueryData(workspaceKeys.profile.detail(), compatible);
    return client;
  }, []);
  const [selected, setSelected] = React.useState("full-gpa");

  return (
    <QueryClientProvider client={queryClient}>
      <main
        className="min-h-dvh bg-background text-foreground"
        data-slot="school-chances-gallery"
      >
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 sm:px-8">
            <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Development surface
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              School chances gallery
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Real comparison components rendered from static facts and Profile
              fixtures. This page makes no API, Profile, or database requests.
            </p>
          </div>
        </header>

        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-8">
          <nav
            aria-label="Fixture navigation"
            className="min-w-0 self-start lg:sticky lg:top-6"
            data-slot="school-chances-gallery-navigation"
          >
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Fixture navigation
            </p>
            <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {CHANCES_GALLERY_FIXTURES.map((fixture) => (
                <button
                  aria-current={selected === fixture.id ? "true" : undefined}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                    selected === fixture.id
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                  data-fixture-id={fixture.id}
                  key={fixture.id}
                  onClick={() => {
                    setSelected(fixture.id);
                    document
                      .getElementById(`${fixture.id}-heading`)
                      ?.scrollIntoView({ block: "start" });
                  }}
                  type="button"
                >
                  {fixture.title}
                </button>
              ))}
            </div>
          </nav>

          <div className="min-w-0" data-slot="school-chances-gallery-fixtures">
            <div className="flex flex-col gap-14">
              {CHANCES_GALLERY_FIXTURES.map((fixture) => (
                <FixturePreview
                  fixture={fixture}
                  isSelected={selected === fixture.id}
                  key={fixture.id}
                />
              ))}
            </div>
          </div>
        </div>
      </main>
    </QueryClientProvider>
  );
}

function FixturePreview({
  fixture,
  isSelected,
}: {
  fixture: GalleryFixture;
  isSelected: boolean;
}) {
  const [metric, setMetric] = React.useState(fixture.metric);
  const panel = (
    <SchoolChancesPanel
      data={fixture.data}
      metricParam={metric}
      onMetricChange={setMetric}
      profile={fixture.profile ?? null}
    />
  );

  return (
    <section
      aria-labelledby={`${fixture.id}-heading`}
      className={cn(
        "flex min-w-0 scroll-mt-6 flex-col gap-3",
        isSelected && "[&>div:first-child]:border-foreground",
      )}
      data-fixture={fixture.id}
      data-testid={`school-chances-gallery-fixture-${fixture.id}`}
      data-slot="school-chances-gallery-fixture"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3">
        <h2 className="text-base font-medium" id={`${fixture.id}-heading`}>
          {fixture.title}
        </h2>
        <p className="text-xs text-muted-foreground">Static fixture</p>
      </div>
      <p className="text-sm text-muted-foreground">{fixture.description}</p>
      {fixture.profileRequestError ? (
        <>
          <div
            className="flex flex-wrap items-center justify-between gap-2"
            role="alert"
          >
            <p className="text-sm text-destructive">
              Could not load your profile. The school comparison remains
              available.
            </p>
            <button className="text-sm underline" type="button">
              Retry
            </button>
          </div>
          {panel}
        </>
      ) : (
        panel
      )}
      {fixture.absenceSummary ? (
        <ul aria-label="Endpoint absence states" className="sr-only">
          {fixture.absenceSummary.map((display) => (
            <li key={display}>{display}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const CHANCES_GALLERY_FIXTURES: readonly GalleryFixture[] = [
  {
    id: "chance-selective",
    title: "Chances · selective private",
    description: "An 8% admit rate: the curve stays low even at the top of the class.",
    metric: "gpa",
    data: withAdmitRate(schoolChancesFactFixtures.full, 8, "private"),
    profile: compatible,
  },
  {
    id: "chance-moderate",
    title: "Chances · moderate",
    description: "A 38% admit rate at a private school, saved SAT in the upper part of the class.",
    metric: "sat",
    data: withAdmitRate(schoolChancesFactFixtures.full, 38, "private"),
    profile: compatible,
  },
  {
    id: "chance-open-public",
    title: "Chances · open public",
    description: "A 72% admit rate at a public school.",
    metric: "act",
    data: withAdmitRate(schoolChancesFactFixtures.full, 72, "public"),
    profile: compatible,
  },
  {
    id: "chance-no-profile",
    title: "Chances · no saved score",
    description: "No Profile value: the slider starts at the typical student.",
    metric: "gpa",
    data: withAdmitRate(schoolChancesFactFixtures.full, 24, "public"),
    profile: null,
  },
  {
    id: "full-gpa",
    title: "Full GPA · compatible",
    description: "A complete 4.0-scale bucket profile with a saved 3.82 GPA.",
    metric: "gpa",
    data: schoolChancesFactFixtures.full,
    profile: compatible,
  },
  {
    id: "partial-gpa",
    title: "Partial GPA",
    description:
      "Reported buckets total 60%; omitted and absent buckets stay visible.",
    metric: "gpa",
    data: schoolChancesFactFixtures.partial,
    profile: compatible,
  },
  {
    id: "all-absent",
    title: "All GPA buckets absent",
    description:
      "An all-absent distribution is unavailable rather than a zero-valued chart.",
    metric: "gpa",
    data: schoolChancesFactFixtures.allAbsent,
    profile: compatible,
  },
  {
    id: "non-four-gpa",
    title: "Non-4.0 GPA",
    description:
      "A saved GPA on another scale remains exact but cannot be placed.",
    metric: "gpa",
    data: schoolChancesFactFixtures.full,
    profile: schoolChancesProfileFixtures.incompatible,
  },
  {
    id: "full-sat",
    title: "Full paired SAT",
    description:
      "Math and Reading and Writing each retain their own band and distribution.",
    metric: "sat",
    data: schoolChancesFactFixtures.full,
    profile: compatible,
  },
  {
    id: "sat-total-only",
    title: "SAT total only",
    description:
      "A total is shown for context without fabricating section scores.",
    metric: "sat",
    data: schoolChancesFactFixtures.full,
    profile: { testing: { sat: { total: 1450 } } },
  },
  {
    id: "partial-profile",
    title: "One SAT section",
    description:
      "One saved SAT section is placed while the other remains explicitly unadded.",
    metric: "sat",
    data: schoolChancesFactFixtures.full,
    profile: schoolChancesProfileFixtures.partial,
  },
  {
    id: "act-band-only",
    title: "ACT band · no distribution",
    description:
      "The middle 50% remains useful when no ACT breakdown is reported.",
    metric: "act",
    data: withoutFacts(
      schoolChancesFactFixtures.full,
      (fact) => fact.key === "class_profile.act_composite_distribution",
    ),
    profile: compatible,
  },
  {
    id: "no-student-score",
    title: "No student score",
    description:
      "School context remains readable while the explorer starts empty.",
    metric: "sat",
    data: schoolChancesFactFixtures.full,
    profile: null,
  },
  {
    id: "no-school-data",
    title: "No school data",
    description:
      "No crawl data means no empty axes and no invented comparison.",
    metric: "gpa",
    data: schoolChancesFactFixtures.noCrawl,
    profile: compatible,
  },
  {
    id: "stale-facts",
    title: "Stale facts",
    description:
      "The server-owned freshness line is shown verbatim beside usable data.",
    metric: "gpa",
    data: schoolChancesFactFixtures.stale,
    profile: compatible,
  },
  {
    id: "reported-periods",
    title: "Different reported periods",
    description:
      "Each fact keeps its own reported period; no mixed-vintage warning is invented.",
    metric: "sat",
    data: withReportedPeriods(schoolChancesFactFixtures.full),
    profile: compatible,
  },
  {
    id: "invalid-score-distributions",
    title: "Invalid score distributions",
    description:
      "Wrong-scale and out-of-domain score buckets fall back while valid bands remain.",
    metric: "sat",
    data: invalidScoreDistributions(schoolChancesFactFixtures.full),
    profile: compatible,
  },
  {
    id: "malformed-score-band",
    title: "Malformed score band",
    description:
      "A malformed SAT band is omitted while the valid score distribution remains.",
    metric: "sat",
    data: malformedScoreBand(schoolChancesFactFixtures.full),
    profile: compatible,
  },
  {
    id: "malformed-score-distribution",
    title: "Malformed score distribution",
    description:
      "A malformed SAT breakdown is listed literally without plotting it to scale.",
    metric: "sat",
    data: malformedScoreDistribution(schoolChancesFactFixtures.full),
    profile: compatible,
  },
  {
    id: "endpoint-absence",
    title: "Endpoint absence grammar",
    description:
      "Every endpoint absence state preserves its server-owned wording.",
    metric: "gpa",
    data: schoolChancesFactFixtures.absenceStates,
    profile: compatible,
    absenceSummary: [
      "Not reported",
      "Not checked",
      "Not on file",
      "Not collected",
    ],
  },
  {
    id: "request-error",
    title: "Profile request error",
    description:
      "A profile request failure keeps school data visible and offers retry.",
    metric: "gpa",
    data: schoolChancesFactFixtures.full,
    profileRequestError: true,
  },
  {
    id: "off-grid-values",
    title: "Off-grid values",
    description:
      "Saved 3.825 GPA and 755 SAT values stay exact and leave explorers unseeded.",
    metric: "gpa",
    data: schoolChancesFactFixtures.full,
    profile: {
      academics: { gpa_unweighted: "3.825", gpa_scale: "4.0" },
      testing: { sat: { math: 755, ebrw: 740, total: 1495 } },
    },
  },
  {
    id: "unparseable-shared-boundary-gpa",
    title: "Unparseable/shared-boundary GPA",
    description:
      "A shared 2.49 endpoint and an unknown label demonstrate refusal to guess placement.",
    metric: "gpa",
    data: gpaBoundaryFixture(schoolChancesFactFixtures.full),
    profile: { academics: { gpa_unweighted: "2.49", gpa_scale: "4.0" } },
  },
];

function withoutFacts(
  response: SchoolFactsResponse,
  remove: (fact: Fact) => boolean,
): SchoolFactsResponse {
  return {
    ...structuredClone(response),
    sections: response.sections.map((section) => ({
      ...section,
      groups: section.groups.map((group) => ({
        ...group,
        facts: group.facts.filter((fact) => !remove(fact)),
      })),
    })),
  };
}

function withReportedPeriods(
  response: SchoolFactsResponse,
): SchoolFactsResponse {
  const periods: Record<string, string> = {
    "class_profile.sat_math": "2024-25 band",
    "class_profile.sat_math_distribution": "2023-24 breakdown",
    "class_profile.sat_ebrw": "2022-23 band",
    "class_profile.sat_ebrw_distribution": "2021-22 breakdown",
  };
  return mapFacts(response, (fact) => ({
    ...fact,
    reported_period: periods[fact.key] ?? fact.reported_period,
  }));
}

function invalidScoreDistributions(
  response: SchoolFactsResponse,
): SchoolFactsResponse {
  return mapFacts(response, (fact) => {
    if (fact.key === "class_profile.sat_math_distribution") {
      return {
        ...fact,
        value: {
          ...(fact.value as object),
          scale: "gpa",
          buckets: [{ label: "Score of 900 - 950", pct: 100 }],
        },
      };
    }
    if (fact.key === "class_profile.sat_ebrw_distribution") {
      return {
        ...fact,
        value: {
          ...(fact.value as object),
          buckets: [{ label: "Score of 100 - 199", pct: 100 }],
        },
      };
    }
    if (fact.key === "class_profile.act_composite_distribution") {
      return {
        ...fact,
        value: {
          ...(fact.value as object),
          scale: "sat_math",
          buckets: [{ label: "Score of 800 - 900", pct: 100 }],
        },
      };
    }
    return fact;
  });
}

function malformedScoreBand(
  response: SchoolFactsResponse,
): SchoolFactsResponse {
  return mapFacts(response, (fact) =>
    fact.key === "class_profile.sat_math"
      ? {
          ...fact,
          value: {
            p25: 900,
            p75: 950,
            min: 200,
            max: 800,
            submitted_percent: null,
          },
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

function gpaBoundaryFixture(
  response: SchoolFactsResponse,
): SchoolFactsResponse {
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
