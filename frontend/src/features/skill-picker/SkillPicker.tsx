import { useEffect, useRef, type RefObject } from "react";
import type React from "react";

import type { SkillCatalogEntry } from "@/api/chat/types";
import { Popover, PopoverPopup } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function SkillPicker({
  activeIndex,
  anchorRef,
  announcement,
  isOpen,
  listboxId,
  onClose,
  onSelect,
  query,
  results,
  selectedSkills,
  setActiveIndex,
}: {
  activeIndex: number;
  anchorRef: RefObject<HTMLElement | null>;
  announcement: string | null;
  isOpen: boolean;
  listboxId: string;
  onClose: () => void;
  onSelect: (name: string) => void;
  query: string;
  results: readonly SkillCatalogEntry[];
  selectedSkills: readonly string[];
  setActiveIndex: (index: number) => void;
}): React.ReactElement {
  const optionsRef = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const active = results[activeIndex];
    if (!isOpen || !active) {
      return;
    }
    optionsRef.current.get(active.name)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen, results]);

  return (
    <>
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
      <Popover
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onClose();
          }
        }}
        open={isOpen}
      >
        <PopoverPopup
          align="start"
          anchor={anchorRef}
          className="w-[min(30rem,var(--anchor-width),calc(100vw-2rem))] [--popup-height:min(18rem,var(--available-height))] motion-reduce:transform-none motion-reduce:transition-none"
          finalFocus={false}
          initialFocus={false}
          positionerClassName="max-w-[min(var(--anchor-width),calc(100vw-2rem))] motion-reduce:transition-none"
          side="top"
          sideOffset={8}
        >
          <div className="flex min-h-0 flex-col gap-2" data-slot="skill-picker">
            <div
              aria-label="Skills"
              className="max-h-52 overflow-y-auto"
              id={listboxId}
              role="listbox"
            >
              {results.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  No skills match “{query}”.
                </p>
              ) : (
                results.map((skill, index) => {
                  const selected = selectedSkills.includes(skill.name);
                  const active = index === activeIndex;
                  return (
                    <div
                      aria-disabled={selected || undefined}
                      aria-selected={active}
                      className={cn(
                        "flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 outline-none transition-colors",
                        active && "bg-accent text-accent-foreground",
                        selected && "cursor-default opacity-60",
                      )}
                      id={`${listboxId}-${skill.name}`}
                      key={skill.name}
                      onMouseEnter={() => setActiveIndex(index)}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        if (!selected) {
                          onSelect(skill.name);
                        }
                      }}
                      ref={(node) => {
                        if (node) {
                          optionsRef.current.set(skill.name, node);
                        } else {
                          optionsRef.current.delete(skill.name);
                        }
                      }}
                      role="option"
                    >
                      <span className="flex items-baseline justify-between gap-3 text-sm font-medium">
                        <span className="truncate">{skill.displayName}</span>
                        <span className="shrink-0 font-normal text-muted-foreground">
                          @{skill.name}
                        </span>
                      </span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {selected ? "Added" : skill.description}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            <div className="hidden border-t border-border pt-2 text-xs text-muted-foreground md:flex md:items-center md:gap-1">
              <span>↑↓ Navigate</span>
              <span aria-hidden="true">·</span>
              <span>Enter Select</span>
              <span aria-hidden="true">·</span>
              <span>Esc Close</span>
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </>
  );
}
