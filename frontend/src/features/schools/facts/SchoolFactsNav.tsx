import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  academicYearLabel,
  coverageFraction,
} from "@/features/schools/facts/school-facts-format";
import type {
  DomainCoverage,
  SchoolEdition,
  SchoolIdentity,
  SectionId,
} from "@/features/schools/facts/school-facts-types";
import { cn } from "@/lib/utils";

/*
 * The rail.
 *
 * Row vocabulary is the sidebar's and ProfileSectionNav's, verbatim: 36px
 * tall, 10px radius, 12px inline padding, selection carried by the brand
 * tint plus a weight step so it survives greyscale. It sits on CANVAS rather
 * than chrome, so hover resolves to --canvas-hover.
 *
 * There is no left bar on the selected row. Fill plus weight is already two
 * signals; a bar would be a redundant third, and it was removed from the
 * sidebar deliberately.
 */

const rowClassName = cn(
  "flex h-9 w-full items-center justify-between gap-2 rounded-[10px] px-3 text-left text-sm",
  "transition-colors duration-150 outline-none",
  "hover:bg-[var(--canvas-hover)]",
  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
);

export type NavSection = { id: SectionId; title: string };

export function SchoolFactsNav({
  coverage,
  edition,
  identity,
  onSelect,
  sections,
  selected,
}: {
  coverage: Record<string, DomainCoverage>;
  edition: SchoolEdition | null;
  identity: SchoolIdentity;
  onSelect: (id: SectionId) => void;
  sections: readonly NavSection[];
  selected: SectionId;
}) {
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="School fact sections" className="flex flex-col gap-0.5">
        {sections.map((section) => {
          const isSelected = section.id === selected;
          return (
            <button
              aria-current={isSelected ? "true" : undefined}
              className={cn(
                rowClassName,
                isSelected
                  ? "bg-[var(--brand-subtle)] font-medium text-[var(--brand-subtle-ink)] hover:bg-[var(--brand-subtle)]"
                  : "text-foreground",
              )}
              key={section.id}
              onClick={() => onSelect(section.id)}
              type="button"
            >
              <span className="truncate">{section.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-[var(--ink-muted)]">
                {/*
                 * An em dash when there is no packet, never "0/28".
                 * Zero-of-N asserts we looked and found nothing, which is a
                 * stronger and different claim than having nothing to look
                 * at.
                 */}
                {coverageFraction(coverage[section.id])}
              </span>
            </button>
          );
        })}
      </nav>
      <SourceBlock edition={edition} identity={identity} />
    </div>
  );
}

function SourceBlock({
  edition,
  identity,
}: {
  edition: SchoolEdition | null;
  identity: SchoolIdentity;
}) {
  if (!edition) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--hairline)] px-3 pt-4">
      <p className="text-xs text-[var(--ink-muted)]">Source</p>
      <p className="text-xs text-[var(--ink-secondary)]">
        CDS {academicYearLabel(edition.academicYear)} · {identity.name}
      </p>
      {edition.currentness === "stale" ? (
        <div>
          <Badge variant="warning">Older edition</Badge>
        </div>
      ) : null}
      {edition.documentUrl ? (
        <div>
          <Button
            className="-ml-2"
            render={
              <a href={edition.documentUrl} rel="noreferrer" target="_blank" />
            }
            size="sm"
            variant="ghost"
          >
            View document
            <ExternalLink data-icon="inline-end" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Below the two-column breakpoint the rail becomes a Select. */
export function SchoolFactsNavSelect({
  coverage,
  onSelect,
  sections,
  selected,
}: {
  coverage: Record<string, DomainCoverage>;
  onSelect: (id: SectionId) => void;
  sections: readonly NavSection[];
  selected: SectionId;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--ink-muted)] md:hidden">
      Section
      <Select
        onValueChange={(next) => onSelect(next as SectionId)}
        value={selected}
      >
        <SelectTrigger>
          {/* Base UI renders the raw value unless told otherwise, and
           * "getting-in" is a slug, not a section. */}
          <SelectValue>
            {(value) => {
              const current = sections.find((item) => item.id === value);
              if (!current) return null;
              return `${current.title} · ${coverageFraction(coverage[current.id])}`;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.title} · {coverageFraction(coverage[section.id])}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
    </label>
  );
}
