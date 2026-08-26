import { useState } from "react";

import { FactTable } from "@/features/schools/facts/FactTable";
import { SchoolFactsPanel } from "@/features/schools/facts/SchoolFactsPanel";
import {
  FIXTURE_UNITIDS,
  schoolFactsFixture,
} from "@/features/schools/facts/school-facts-fixtures";
import { identityMeta } from "@/features/schools/facts/school-facts-format";
import type { FactTableRow } from "@/features/schools/facts/school-facts-rows";
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

const STATE_GALLERY: FactTableRow[] = [
  { key: "reported", label: "Reported value", value: "94%", reported: true },
  {
    key: "not-reported",
    label: "Not reported",
    value: "not reported",
    reported: false,
  },
  {
    key: "not-applicable",
    label: "Not applicable",
    value: "not applicable",
    reported: false,
  },
  {
    key: "suppressed",
    label: "Suppressed",
    value: "withheld by the school",
    reported: false,
  },
  {
    key: "not-in-template",
    label: "Not in this form edition",
    value: "not in this form edition",
    reported: false,
  },
  {
    key: "no-verified-value",
    label: "No verified value",
    value: "no verified value",
    reported: false,
  },
  { key: "zero", label: "A legitimate zero", value: "0", reported: true },
  { key: "string-percent", label: "A string percent", value: "<1%", reported: true },
  {
    key: "blocked",
    label: "A derived value that refuses to compute",
    value: "not available",
    reported: false,
  },
  {
    key: "long-label",
    label:
      "A label long enough to wrap onto a second line, because metric labels are long by nature and truncating one makes it unreadable",
    value: "6 to 1",
    reported: true,
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
            stale edition, a school with no readable CDS, a suppressed value, a
            “&lt;1%” string, a legitimate zero, and an admit rate that refuses
            to compute.
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

        <section className="flex flex-col gap-4 pb-16">
          <h2 className="border-b border-[var(--hairline)] pb-3 text-lg font-medium">
            Value state gallery
          </h2>
          <FactTable rows={STATE_GALLERY} />
        </section>
      </div>
    </main>
  );
}
