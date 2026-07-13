import { Check } from "lucide-react";
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
          className="w-[min(var(--workspace-skill-picker-popup-width),var(--anchor-width),calc(100vw-2rem))] [--popup-height:min(16rem,var(--available-height))] motion-reduce:transform-none motion-reduce:transition-none"
          finalFocus={false}
          initialFocus={false}
          positionerClassName="max-w-[min(var(--anchor-width),calc(100vw-2rem))] motion-reduce:transition-none"
          side="top"
          sideOffset={8}
        >
          <div className="-mx-2.5 -my-2.5 flex min-h-0 flex-col" data-slot="skill-picker">
            <div
              aria-label="Skills"
              className="flex max-h-52 flex-col gap-1.5 overflow-y-auto"
              id={listboxId}
              role="listbox"
            >
              {results.length === 0 ? (
                <p className="px-2.5 py-3 text-[13px] text-[var(--workspace-dropdown-foreground)]">
                  No skills match “{query}”.
                </p>
              ) : (
                results.map((skill, index) => {
                  const selected = selectedSkills.includes(skill.name);
                  const active = index === activeIndex;
                  return (
                    <div
                      aria-disabled={selected || undefined}
                      aria-selected={selected}
                      data-active={active ? "" : undefined}
                      className={cn(
                        "flex min-h-12 cursor-pointer flex-col gap-1 rounded-md border border-transparent px-2.5 py-2 text-[var(--workspace-dropdown-foreground)] outline-none transition-colors duration-150",
                        active &&
                          "text-[var(--workspace-composer-sources-foreground)] [&_[data-slot=skill-picker-meta]]:text-[var(--workspace-composer-sources-foreground)]",
                        selected &&
                          "cursor-default bg-[var(--workspace-composer-skill-surface)]",
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
                      <span className="flex min-w-0 items-center justify-between gap-2 text-[12px] font-medium leading-4">
                        <span className="truncate">{skill.displayName}</span>
                        {selected ? (
                          <Check
                            aria-label="Selected"
                            className="size-3.5 shrink-0 text-[var(--workspace-composer-sources-foreground)]"
                          />
                        ) : (
                          <span
                            className="max-w-32 shrink-0 truncate font-mono text-[10px] font-normal leading-4 text-[var(--workspace-muted-foreground)]"
                            data-slot="skill-picker-meta"
                          >
                            @{skill.name}
                          </span>
                        )}
                      </span>
                      <span
                        className="line-clamp-1 text-[11px] leading-4 text-[var(--workspace-muted-foreground)]"
                        data-slot="skill-picker-meta"
                      >
                        {skill.description}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </>
  );
}
