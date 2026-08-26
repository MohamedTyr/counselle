import { useState } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { FileQuestion } from "lucide-react";
import { Link } from "react-router";

import {
  SchoolFactsNav,
  SchoolFactsNavSelect,
} from "@/features/schools/facts/SchoolFactsNav";
import { SchoolFactsSection } from "@/features/schools/facts/SchoolFactsSection";
import {
  NAV_SECTIONS,
  sectionById,
} from "@/features/schools/facts/school-facts-sections";
import type {
  SchoolFacts,
  SectionId,
} from "@/features/schools/facts/school-facts-types";

/*
 * The About tab.
 *
 * Two columns — a 200px rail and the panel — reusing ProfileRoute's grid
 * verbatim rather than minting a second two-column layout for the same job.
 * The rail is sticky; the panel scrolls with the page, because the page owns
 * its own scroll container (the shell never scrolls).
 */

const LAYOUT_CLASS =
  "grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)] lg:gap-8";

export function SchoolFactsPanel({ data }: { data: SchoolFacts }) {
  const [selected, setSelected] = useState<SectionId>("getting-in");
  const section = sectionById(selected);

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      {/* Applying still has answers without a form — those come from the
       * school's own pages — so the sections render either way. */}
      {data.edition ? null : <NoCommonDataSet data={data} />}
      <div className={LAYOUT_CLASS}>
        <div className="md:sticky md:top-0 md:flex md:flex-col">
          <SchoolFactsNavSelect
            onSelect={setSelected}
            sections={NAV_SECTIONS}
            selected={selected}
          />
          <div className="hidden md:block">
            <SchoolFactsNav
              onSelect={setSelected}
              sections={NAV_SECTIONS}
              selected={selected}
            />
          </div>
        </div>
        <div
          /* Panel content re-enters on section change. Keyed so the
           * animation actually re-runs; opacity and a 4px slide only. */
          className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
          key={selected}
        >
          <SchoolFactsSection data={data} section={section} />
        </div>
      </div>
    </div>
  );
}

/**
 * The school exists in the catalogue but has no readable Common Data Set.
 * This is NOT an error and must not wear error styling — we are not broken,
 * we simply do not have the document, and our own requirements data is
 * unaffected by that.
 */
function NoCommonDataSet({ data }: { data: SchoolFacts }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestion />
        </EmptyMedia>
        <EmptyTitle>No Common Data Set on file</EmptyTitle>
        <EmptyDescription>
          We haven't been able to read a Common Data Set for{" "}
          {data.identity.name}. The application requirements on the other tab
          are still current.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          render={
            <Link
              state={{
                draftPrompt: `What can you tell me about ${data.identity.name}? Counselle has no Common Data Set on file for it.`,
              }}
              to="/app/ai"
            />
          }
        >
          Ask Counselle about {data.identity.name}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
