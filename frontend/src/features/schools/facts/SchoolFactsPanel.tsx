import { useSearchParams } from "react-router";

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

/*
 * There is no SchoolFactsSkeleton here on purpose. The facts arrive
 * synchronously and the route's own SchoolDetailSkeleton already covers the
 * only wait there is; a rail-and-panel skeleton would be a shape with no
 * moment to appear in. It belongs with the change that makes this read
 * async, not ahead of it.
 */

const SECTION_PARAM = "section";

export function SchoolFactsPanel({ data }: { data: SchoolFacts }) {
  /*
   * The section lives in the URL, in the same grammar as the About/Applying
   * tab one level up (SchoolDetailRoute) — so a link to a school's aid
   * numbers lands on the aid numbers, and reload keeps the reader where they
   * were. `replace` because reading down a page of facts is one visit, not
   * six, and six back-presses to leave a tab is a broken back button.
   */
  const [params, setParams] = useSearchParams();
  const section = sectionById(params.get(SECTION_PARAM));
  const selected = section.id;
  const setSelected = (next: SectionId) => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set(SECTION_PARAM, next);
        return updated;
      },
      { replace: true },
    );
  };

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
        {/*
         * The swap is INSTANT, deliberately.
         *
         * It used to fade and slide in on a keyframe, keyed to re-run per
         * section. Keyframes restart from zero rather than retargeting, so
         * clicking quickly down the rail — the most repeated interaction on
         * this tab — stuttered instead of crossfading. And the fix is not a
         * better curve: this is navigation a reader performs dozens of times
         * in a session, which is the tier where the answer is to remove the
         * animation, not tune it. Profile's identical rail-and-panel swap has
         * never animated either.
         */}
        <SchoolFactsSection data={data} section={section} />
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
