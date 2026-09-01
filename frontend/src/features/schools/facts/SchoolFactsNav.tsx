import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SectionId } from "@/features/schools/facts/school-facts-types";
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
  "flex h-9 w-full items-center rounded-[10px] px-3 text-left text-sm",
  "transition-colors duration-150 outline-none",
  "hover:bg-[var(--canvas-hover)]",
  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
);

export type NavSection = { id: SectionId; title: string };

export function SchoolFactsNav({
  onSelect,
  sections,
  selected,
}: {
  onSelect: (id: SectionId) => void;
  sections: readonly NavSection[];
  selected: SectionId;
}) {
  return (
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
          </button>
        );
      })}
    </nav>
  );
}

/** Below the two-column breakpoint the rail becomes a Select. */
export function SchoolFactsNavSelect({
  onSelect,
  sections,
  selected,
}: {
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
            {(value) =>
              sections.find((item) => item.id === value)?.title ?? null
            }
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.title}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
    </label>
  );
}
