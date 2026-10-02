import type React from "react";

import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { ShellSection } from "./use-selected-section";

/*
 * The chapter rail: a sticky list on the left, one chapter on the right, so
 * a chapter gets the whole column. Below the two-column breakpoint the rail
 * becomes a Select.
 *
 * Row vocabulary is the sidebar's and ProfileSectionNav's: 36px tall, 10px
 * radius, selection carried by the brand tint plus a weight step so it
 * survives greyscale. No left bar — fill plus weight is already two signals.
 */

type Props = {
  sections: ShellSection[];
  selected: string;
  onSelect: (id: string) => void;
};

export function SectionShell({
  sections,
  selected,
  onSelect,
  children,
}: Props & { children: React.ReactNode }) {
  return (
    <div className="grid items-start gap-6 md:grid-cols-[208px_minmax(0,1fr)] lg:gap-10">
      <div className="flex flex-col gap-6 md:sticky md:top-6">
        <SectionSelect
          onSelect={onSelect}
          sections={sections}
          selected={selected}
        />
        <nav
          aria-label="School fact sections"
          className="hidden flex-col gap-0.5 md:flex"
        >
          {sections.map((section) => {
            const isSelected = section.id === selected;
            return (
              <button
                aria-current={isSelected ? "true" : undefined}
                className={cn(
                  "flex h-9 w-full items-center rounded-[10px] px-3 text-left text-sm outline-none",
                  "transition-colors duration-150 hover:bg-[var(--canvas-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
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
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SectionSelect({ sections, selected, onSelect }: Props) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--ink-muted)] md:hidden">
      Section
      <Select onValueChange={(next) => onSelect(next as string)} value={selected}>
        <SelectTrigger>
          {/* Base UI renders the raw value unless told otherwise, and an id
           * is a slug, not a section name. */}
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
