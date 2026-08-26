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

import { HeadlineStrip } from "@/features/schools/facts/HeadlineStrip";
import { EditionBanner } from "@/features/schools/facts/SectionHeader";
import { editionBannerVariants } from "@/features/schools/facts/school-facts-format";
import {
  SchoolFactsNav,
  SchoolFactsNavSelect,
} from "@/features/schools/facts/SchoolFactsNav";
import { SchoolFactsSection } from "@/features/schools/facts/SchoolFactsSection";
import {
  NAV_SECTIONS,
  sectionById,
} from "@/features/schools/facts/school-facts-sections";
import { buildHeadlineTiles } from "@/features/schools/facts/school-facts-headline";
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
  const tiles = buildHeadlineTiles(data);

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      {/*
       * The strip exists to make five figures comparable at a glance. With
       * no document at all there is nothing to compare, and five tiles
       * reading "no verified value" would say once per tile what the empty
       * state below says once, properly, with what to do about it.
       */}
      {data.edition ? <HeadlineStrip tiles={tiles} /> : null}
      {/* Stale and definition-changed qualify every number on the page, so
       * they are stated once, here, rather than repeated in all six
       * sections — six ambers for one fact is how a warning stops being one. */}
      {data.edition ? (
        editionBannerVariants(data.edition).map((variant) => (
          <EditionBanner
            edition={data.edition!}
            key={variant}
            schoolName={data.identity.name}
            variant={variant}
          />
        ))
      ) : (
        <NoCommonDataSet data={data} />
      )}
      <div className={LAYOUT_CLASS}>
        <div className="md:sticky md:top-0 md:flex md:flex-col">
          <SchoolFactsNavSelect
            coverage={data.coverage}
            onSelect={setSelected}
            sections={NAV_SECTIONS}
            selected={selected}
          />
          <div className="hidden md:block">
            <SchoolFactsNav
              coverage={data.coverage}
              edition={data.edition}
              identity={data.identity}
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
 * we simply do not have the document, and our own requirements data below is
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
          {data.identity.name}. The application requirements below are still
          current.
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
