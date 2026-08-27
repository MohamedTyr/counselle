import type { SectionConfig } from "@/features/profile/profile-field-types";
import { hasAnyValue } from "@/features/profile/profile-facts";
import {
  PROFILE_SECTION_GROUPS,
  PROFILE_SECTIONS,
} from "@/features/profile/profile-sections-config";
import { getAtPath } from "@/features/profile/profile-patch";
import { cn } from "@/lib/utils";

/* The rail's row vocabulary is the sidebar's (DESIGN §9.2): 36px tall, 10px
 * radius, 12px inline padding, selection carried by the brand tint plus a
 * weight step so it survives greyscale. It sits on CANVAS rather than
 * chrome, so hover resolves to --canvas-hover and selection to
 * --brand-subtle instead of the rail's --chrome-* pair. */
const rowClassName = cn(
  "flex h-9 w-full items-center justify-between gap-2 rounded-[10px] px-3 text-left text-sm",
  "transition-colors duration-150 outline-none",
  "hover:bg-[var(--canvas-hover)]",
  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
);

export function ProfileSectionNav({
  onSelect,
  profile,
  selectedKey,
}: {
  onSelect: (key: string) => void;
  profile: unknown;
  selectedKey: string;
}) {
  return (
    <nav aria-label="Profile sections" className="flex flex-col gap-5">
      {PROFILE_SECTION_GROUPS.map((group) => (
        <div className="flex flex-col gap-0.5" key={group.key}>
          <h2 className="px-3 pb-1.5 text-xs font-medium text-[var(--profile-field-helper)]">
            {group.label}
          </h2>
          {PROFILE_SECTIONS.filter(
            (section) => section.group === group.key,
          ).map((section) => (
            <SectionRow
              filled={hasAnyValue(getAtPath(profile, [section.key]))}
              key={section.key}
              onSelect={onSelect}
              section={section}
              selected={section.key === selectedKey}
            />
          ))}
          {group.note ? (
            <p className="px-3 pt-3 text-xs leading-5 text-[var(--profile-field-helper)]">
              {group.note}
            </p>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

function SectionRow({
  filled,
  onSelect,
  section,
  selected,
}: {
  filled: boolean;
  onSelect: (key: string) => void;
  section: SectionConfig;
  selected: boolean;
}) {
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={cn(
        rowClassName,
        selected
          ? "bg-[var(--brand-subtle)] font-medium text-[var(--brand-subtle-ink)] hover:bg-[var(--brand-subtle)]"
          : filled
            ? "text-foreground"
            : "text-[var(--profile-field-helper)]",
      )}
      onClick={() => onSelect(section.key)}
      type="button"
    >
      <span className="truncate">{section.title}</span>
      {/* "empty" is a state, not a score: it never counts, ranks or nags —
       * it only tells you which rows have nothing behind them yet. */}
      {filled ? null : (
        <span className="shrink-0 text-xs text-[var(--profile-field-helper)]">
          empty
        </span>
      )}
    </button>
  );
}
