import { FactTable } from "@/features/schools/facts/FactTable";
import { sectionRows } from "@/features/schools/facts/school-facts-rows";
import type { SectionConfig } from "@/features/schools/facts/school-facts-sections";
import type { SchoolFacts } from "@/features/schools/facts/school-facts-types";

/**
 * One section of the About tab: a title, and every value it has as a
 * name/value row. No groups, no disclosures — a fact a student has to open
 * something to see is a fact they will not see.
 */
export function SchoolFactsSection({
  data,
  section,
}: {
  data: SchoolFacts;
  section: SectionConfig;
}) {
  const rows = sectionRows(data, section);

  return (
    <section aria-labelledby={`section-${section.id}`} className="flex flex-col gap-4">
      <h2
        className="text-lg font-medium text-[var(--ink)]"
        id={`section-${section.id}`}
      >
        {section.title}
      </h2>
      {rows.length > 0 ? (
        <FactTable rows={rows} />
      ) : (
        /*
         * A section with nothing in it says so in words. Rendering an empty
         * frame would read as "we looked and there is nothing here", which is
         * a stronger claim than the one we can make.
         */
        <p className="text-sm leading-6 text-[var(--ink-secondary)]">
          {data.identity.name}'s Common Data Set doesn't cover this section, or
          we haven't been able to read it. We don't fill the gap from an older
          edition.
        </p>
      )}
    </section>
  );
}
