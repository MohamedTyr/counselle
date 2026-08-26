import { useState } from "react";

import { CaveatLine } from "@/features/schools/facts/CaveatLine";
import { DerivedFactRow, FactRow } from "@/features/schools/facts/FactRow";
import { SchoolFactsPanel } from "@/features/schools/facts/SchoolFactsPanel";
import {
  FIXTURE_UNITIDS,
  schoolFactsFixture,
} from "@/features/schools/facts/school-facts-fixtures";
import { identityMeta } from "@/features/schools/facts/school-facts-format";
import type {
  Caveat,
  DerivedFact,
  Fact,
  FactState,
} from "@/features/schools/facts/school-facts-types";
import { cn } from "@/lib/utils";

/*
 * DEV ONLY. Registered under /dev, outside the auth guard, alongside the
 * tool-call and onboarding-shell galleries.
 *
 * The About tab reads from fixtures until the packet query exists, and the
 * paths that matter most — a suppressed value, a row absent from the form
 * edition, a derived value that refuses to compute — are the ones hardest to
 * reach by clicking around a logged-in app. This puts all of them on one
 * page.
 */

const galleryCaveats: Record<string, Caveat> = {
  ordinary: {
    id: "ordinary",
    severity: "ordinary",
    text: "of aid recipients, not all students — excludes PLUS and private loans",
  },
  severe: {
    id: "severe",
    severity: "severe",
    text: "Only 38% of the class submitted an SAT score — this band describes the top third, not the class.",
  },
};

function galleryFact(
  label: string,
  state: FactState,
  caveatRefs: string[] = [],
): Fact {
  return {
    ref: `gallery.${label}`,
    label,
    state,
    evidence: {
      pageNumber: 7,
      excerpt: "i. Average percent of need met.  94%",
      section: "H2",
      row: "i",
      column: null,
    },
    contexts: [],
    caveatRefs,
  };
}

const STATE_GALLERY: Fact[] = [
  galleryFact("Reported value", { kind: "reported", display: "94%", raw: 94 }),
  galleryFact("Not reported", { kind: "not_reported" }),
  galleryFact("Not applicable", { kind: "not_applicable" }),
  galleryFact("Suppressed", { kind: "suppressed" }, ["severe"]),
  galleryFact("Not in this form edition", { kind: "not_in_template_version" }),
  galleryFact("No verified value", { kind: "no_verified_value" }),
  galleryFact("A legitimate zero", { kind: "reported", display: "0", raw: 0 }),
  galleryFact("A string percent", {
    kind: "reported",
    display: "<1%",
    raw: "<1%",
  }),
  galleryFact(
    "With an ordinary caveat",
    { kind: "reported", display: "94%", raw: 94 },
    ["ordinary"],
  ),
  galleryFact(
    "With a severe caveat",
    { kind: "reported", display: "1500–1560", raw: "1500-1560" },
    ["severe"],
  ),
  galleryFact(
    "A label long enough to wrap onto a second line, because metric labels are long by nature and truncating one makes it unreadable",
    { kind: "reported", display: "6 to 1", raw: 6 },
  ),
];

const DERIVED_GALLERY: DerivedFact[] = [
  {
    key: "computed",
    label: "Admit rate",
    state: { kind: "reported", display: "4.6%", raw: 4.6 },
    formula: "2,275 admitted ÷ 49,000 applicants",
    inputs: [
      {
        ref: "admissions.admitted_total",
        label: "admitted",
        evidence: {
          pageNumber: 3,
          excerpt: "C1. Total admitted: 2,275",
          section: "C1",
          row: null,
          column: null,
        },
      },
      {
        ref: "admissions.applicants_total",
        label: "applicants",
        evidence: {
          pageNumber: 3,
          excerpt: "C1. Total applicants: 49,000",
          section: "C1",
          row: null,
          column: null,
        },
      },
    ],
    blockedBy: null,
    caveatRefs: [],
  },
  {
    key: "blocked",
    label: "Admit rate, blocked",
    state: { kind: "not_reported" },
    formula: "admitted ÷ applicants",
    inputs: [],
    blockedBy:
      "Applicants not reported, so the admit rate cannot be calculated.",
    caveatRefs: [],
  },
];

export function SchoolFactsGalleryPage() {
  const [unitid, setUnitid] = useState(FIXTURE_UNITIDS[0]);
  const data = schoolFactsFixture(unitid);

  return (
    <main className="min-h-svh bg-[var(--canvas)] px-6 py-8 md:px-10">
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-8">
        <header className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            School facts — dev gallery
          </h1>
          <p className="max-w-[70ch] text-sm text-[var(--ink-secondary)]">
            Every number on this page is fabricated. The set is deliberately
            worse than reality: a partial packet, a section with no packet, a
            stale edition, a school with no readable CDS, page-proofed
            not-in-template values, a suppressed value, an ACT band under 50%
            submitted, a “&lt;1%” string, a legitimate zero, and an admit rate
            that refuses to compute.
          </p>
          <div className="flex flex-wrap gap-2">
            {FIXTURE_UNITIDS.map((id) => {
              const fixture = schoolFactsFixture(id)!;
              const selected = id === unitid;
              return (
                <button
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm transition-colors duration-150 outline-none",
                    "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                    selected
                      ? "bg-[var(--brand-subtle)] font-medium text-[var(--brand-subtle-ink)]"
                      : "text-foreground hover:bg-[var(--canvas-hover)]",
                  )}
                  key={id}
                  onClick={() => setUnitid(id)}
                  type="button"
                >
                  {fixture.identity.name}
                </button>
              );
            })}
          </div>
        </header>

        {data ? (
          <section className="flex flex-col gap-4">
            <div className="border-b border-[var(--hairline)] pb-3">
              <h2 className="text-lg font-medium">{data.identity.name}</h2>
              <p className="text-sm text-[var(--ink-muted)]">
                {identityMeta(data.identity)}
              </p>
            </div>
            <SchoolFactsPanel data={data} />
          </section>
        ) : null}

        <section className="@container flex flex-col gap-4">
          <h2 className="border-b border-[var(--hairline)] pb-3 text-lg font-medium">
            FactRow state gallery
          </h2>
          <dl className="divide-y divide-[var(--school-fact-divider)]">
            {STATE_GALLERY.map((fact) => (
              <FactRow
                caveats={galleryCaveats}
                edition={data?.edition ?? null}
                fact={fact}
                key={fact.ref}
              />
            ))}
            {DERIVED_GALLERY.map((derived) => (
              <DerivedFactRow
                caveats={galleryCaveats}
                derived={derived}
                edition={data?.edition ?? null}
                key={derived.key}
              />
            ))}
          </dl>
        </section>

        <section className="flex flex-col gap-3 pb-16">
          <h2 className="border-b border-[var(--hairline)] pb-3 text-lg font-medium">
            Caveat severities
          </h2>
          <CaveatLine caveat={galleryCaveats.ordinary} />
          <CaveatLine caveat={galleryCaveats.severe} />
        </section>
      </div>
    </main>
  );
}
