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

/** The gallery cares about state and copy only; provenance is Phase 4's
 * surface and has its own rows further down. */
const row = (
  key: string,
  label: string,
  value: string,
  reported: boolean,
): FactTableRow => ({ key, label, value, reported, provenance: [], caveats: [] });

const STATE_GALLERY: FactTableRow[] = [
  row("reported", "Reported value", "94%", true),
  row("not-reported", "Not reported", "not reported", false),
  row("not-applicable", "Not applicable", "not applicable", false),
  row("suppressed", "Suppressed", "withheld by the school", false),
  row(
    "not-in-template",
    "Not in this form edition",
    "not in this form edition",
    false,
  ),
  row("no-verified-value", "No verified value", "no verified value", false),
  row("zero", "A legitimate zero", "0", true),
  row("string-percent", "A string percent", "<1%", true),
  row(
    "blocked",
    "A derived value that refuses to compute",
    "not available",
    false,
  ),
  row(
    "long-label",
    "A label long enough to wrap onto a second line, because metric labels are long by nature and truncating one makes it unreadable",
    "6 to 1",
    true,
  ),
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
