import { useEffect, useRef, type RefObject } from "react";
import type React from "react";

import { Popover, PopoverPopup } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { SlashCommandEntry } from "@/features/slash-command/slash-query";

/**
 * The slash-trigger's listbox popover. Mirrors the skill picker's listbox
 * pattern (`role="listbox"`, `aria-activedescendant` via the caller,
 * scroll-into-view on active index) but has no "already selected" state —
 * selecting a command arms it and closes the menu immediately, per §5.5.
 *
 * v1 always renders at most the single `/goal` entry (§5.5, Part 8
 * non-goals), so there is no grouping or category UI here.
 */
export function SlashCommandMenu({
  activeIndex,
  anchorRef,
  announcement,
  isOpen,
  listboxId,
  onClose,
  onSelect,
  query,
  results,
  setActiveIndex,
}: {
  activeIndex: number;
  anchorRef: RefObject<HTMLElement | null>;
  announcement: string | null;
  isOpen: boolean;
  listboxId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  query: string;
  results: readonly SlashCommandEntry[];
  setActiveIndex: (index: number) => void;
}): React.ReactElement {
  const optionsRef = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const active = results[activeIndex];
    if (!isOpen || !active) {
      return;
    }
    optionsRef.current.get(active.id)?.scrollIntoView({ block: "nearest" });
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
          <div
            className="-mx-2.5 -my-2.5 flex min-h-0 flex-col"
            data-slot="slash-command-menu"
          >
            <div
              aria-label="Commands"
              className="flex max-h-52 flex-col gap-1.5 overflow-y-auto"
              id={listboxId}
              role="listbox"
            >
              {results.length === 0 ? (
                <p className="px-2.5 py-3 text-[13px] text-[var(--workspace-dropdown-foreground)]">
                  No commands match “/{query}”.
                </p>
              ) : (
                results.map((command, index) => {
                  const active = index === activeIndex;
                  return (
                    <div
                      aria-selected={active}
                      data-active={active ? "" : undefined}
                      className={cn(
                        "flex min-h-12 cursor-pointer flex-col justify-center gap-1 rounded-md border border-transparent px-2.5 py-2 text-[var(--workspace-dropdown-foreground)] outline-none transition-colors duration-150",
                        active &&
                          "text-[var(--workspace-composer-sources-foreground)]",
                      )}
                      id={optionIdFor(listboxId, command.id)}
                      key={command.id}
                      onMouseEnter={() => setActiveIndex(index)}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        onSelect(command.id);
                      }}
                      ref={(node) => {
                        if (node) {
                          optionsRef.current.set(command.id, node);
                        } else {
                          optionsRef.current.delete(command.id);
                        }
                      }}
                      role="option"
                    >
                      <span className="flex min-w-0 items-center justify-between gap-2 text-[12px] font-medium leading-4">
                        <span className="truncate">{command.label}</span>
                        <span className="max-w-32 shrink-0 truncate font-mono text-[10px] font-normal leading-4 text-[var(--workspace-muted-foreground)]">
                          /{command.keyword}
                        </span>
                      </span>
                      <span className="text-[12px] leading-4 text-[var(--workspace-muted-foreground)]">
                        {command.hint}
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

function optionIdFor(listboxId: string, id: string) {
  return `${listboxId}-${id}`;
}
