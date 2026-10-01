import { useLayoutEffect, useRef, useState } from "react";

import type { SectionConfig } from "@/features/profile/profile-field-types";
import {
  PROFILE_SECTION_GROUPS,
  PROFILE_SECTIONS,
} from "@/features/profile/profile-sections-config";
import { cn } from "@/lib/utils";

/* The rail's row vocabulary is the sidebar's (DESIGN §9.2): 36px tall, 10px
 * radius, 12px inline padding — and so is its selection: the sidebar's
 * active tint and ink, so "where am I" reads the same in both rails. A
 * weight step keeps the selection legible in greyscale.
 *
 * The lift is one pill shared by every row, not a background per row: on a
 * change of section it slides from the old row to the new one, so the eye
 * follows the selection instead of losing it in a blink.
 *
 * Below md there is no room beside the sheet, and ten stacked rows would push
 * the form a screen down, so the rail becomes one scrolling strip of pills
 * (the Explore filter bar's idiom) without its group labels. */
const rowClassName = cn(
  "relative z-10 flex h-9 shrink-0 items-center rounded-full px-3.5 text-left text-sm md:w-full md:rounded-[10px] md:px-3",
  "transition-[color,background-color,scale] duration-150 ease-out outline-none active:scale-[0.98] motion-reduce:transition-none",
  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
);

/** The strip's inline padding (px-6), so a row scrolled into view lands on
 * the page gutter rather than under the fade. */
const STRIP_GUTTER = 24;

type PillBox = { x: number; y: number; width: number; height: number };

/** Where the selected row sits inside the nav, measured from the DOM so the
 * pill matches the row exactly in both the rail and the phone strip. */
function useSelectedBox(
  navRef: React.RefObject<HTMLElement | null>,
  selectedKey: string,
) {
  const [box, setBox] = useState<PillBox | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }
    const measure = () => {
      const row = nav.querySelector<HTMLElement>(
        `[data-section="${selectedKey}"]`,
      );
      if (!row) {
        return;
      }
      setBox({
        x: row.offsetLeft,
        y: row.offsetTop,
        width: row.offsetWidth,
        height: row.offsetHeight,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [navRef, selectedKey]);

  return box;
}

export function ProfileSectionNav({
  onSelect,
  selectedKey,
}: {
  onSelect: (key: string) => void;
  selectedKey: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const box = useSelectedBox(navRef, selectedKey);
  // The first placement is a jump, not a slide: the pill should already be
  // on the selected row when the page appears.
  const [hasPlaced, setHasPlaced] = useState(false);
  if (box && !hasPlaced) {
    setHasPlaced(true);
  }

  return (
    <nav
      aria-label="Profile sections"
      className="relative -mx-6 flex gap-1 overflow-x-auto px-6 py-1 [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none] md:mx-0 md:flex-col md:gap-5 md:overflow-visible md:px-0 md:py-0 md:[mask-image:none]"
      ref={navRef}
    >
      {box ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-0 left-0 z-0 rounded-full bg-sidebar-active md:rounded-[10px]",
            hasPlaced &&
              "transition-[translate,width,height] duration-[260ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          )}
          style={{
            height: box.height,
            translate: `${box.x}px ${box.y}px`,
            width: box.width,
          }}
        />
      ) : null}
      {PROFILE_SECTION_GROUPS.map((group) => (
        <div
          className="flex shrink-0 gap-1 md:flex-col md:gap-0.5"
          key={group.key}
        >
          <h2 className="hidden px-3 pb-1.5 text-xs font-medium text-[var(--ink-faint)] md:block">
            {group.label}
          </h2>
          {PROFILE_SECTIONS.filter(
            (section) => section.group === group.key,
          ).map((section) => (
            <SectionRow
              key={section.key}
              onSelect={onSelect}
              section={section}
              selected={section.key === selectedKey}
            />
          ))}
          {group.note ? (
            <p className="hidden px-3 pt-2.5 text-xs leading-5 text-[var(--ink-faint)] md:block">
              {group.note}
            </p>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

function SectionRow({
  onSelect,
  section,
  selected,
}: {
  onSelect: (key: string) => void;
  section: SectionConfig;
  selected: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // On the phone strip, Next can select a section that is scrolled out of
  // sight. Scrolls the strip only — scrollIntoView would also drag every
  // ancestor, the page's own overflow-hidden frame included.
  useLayoutEffect(() => {
    const row = ref.current;
    const strip = row?.closest("nav");
    if (!selected || !row || !strip) {
      return;
    }
    const rowBox = row.getBoundingClientRect();
    const stripBox = strip.getBoundingClientRect();
    if (rowBox.left < stripBox.left || rowBox.right > stripBox.right) {
      strip.scrollBy({ left: rowBox.left - stripBox.left - STRIP_GUTTER });
    }
  }, [selected]);

  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={cn(
        rowClassName,
        selected
          ? "font-medium text-sidebar-active-foreground"
          : "text-[var(--ink-secondary)] hover:bg-[var(--canvas-hover)] hover:text-[var(--ink)]",
      )}
      data-section={section.key}
      onClick={() => onSelect(section.key)}
      ref={ref}
      type="button"
    >
      <span className="truncate">{section.title}</span>
    </button>
  );
}
