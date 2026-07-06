import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  friendlySourceName,
  isDbSource,
  safeExternalUrl,
  sortSourcesByTrust,
} from "../citations";
import type { MessageSourcesPayload } from "./MessageSources";

export type SourcesRailProps = {
  payload: MessageSourcesPayload | null;
  onClose: () => void;
  isMobile: boolean;
};

function SourcesRailBody({ payload }: { payload: MessageSourcesPayload }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus lands on the panel heading on open, matching the old
  // SourcesPanel — the mount-focus doubles as the assistive-tech
  // announcement that the rail swapped content.
  useEffect(() => {
    const activeId =
      payload.activeIndex === "counselle-data"
        ? "source-row-counselle-data"
        : payload.activeIndex !== undefined
          ? `source-row-${payload.activeIndex}`
          : null;
    const target =
      activeId === null ? headingRef.current : document.getElementById(activeId);

    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }, [payload.activeIndex]);

  const externals = sortSourcesByTrust(
    payload.sources.filter((entry) => !isDbSource(entry.citation.source)),
  );
  const count = (payload.dbUsed ? 1 : 0) + externals.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2
          className="text-sm font-semibold text-foreground focus:outline-none"
          ref={headingRef}
          tabIndex={-1}
        >
          {count} {count === 1 ? "source" : "sources"}
        </h2>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {payload.dbUsed && (
          <div
            className={cn(
              "mb-3 rounded-lg border bg-card p-3",
              payload.activeIndex === "counselle-data" && "ring-2 ring-ring",
            )}
            data-active={payload.activeIndex === "counselle-data"}
            id="source-row-counselle-data"
            tabIndex={-1}
          >
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Counselle data</Badge>
            </div>
            {payload.dbSchools.length > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {payload.dbSchools.join(", ")}
              </p>
            )}
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {externals.map((entry) => {
            const href = safeExternalUrl(entry.citation.url);
            return (
              <li
                className={cn(
                  "rounded-lg focus:outline-none focus:ring-2 focus:ring-ring",
                  payload.activeIndex === entry.index && "ring-2 ring-ring",
                )}
                data-active={payload.activeIndex === entry.index}
                id={`source-row-${entry.index}`}
                key={`${entry.index}-${entry.citation.url ?? entry.label}`}
                tabIndex={-1}
              >
                <a
                  className="block truncate rounded-lg border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                  href={href}
                  rel="noreferrer"
                  target={href === undefined ? undefined : "_blank"}
                >
                  <span className="block font-medium">
                    {friendlySourceName(entry.citation)}
                  </span>
                  {entry.snippet !== undefined && entry.snippet !== null && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {entry.snippet}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * SourcesRail — the shared desktop right rail / mobile sheet for a message's
 * sources, ported from the old `SourcesPanel`/`SourcesSheet`. Opening
 * sources is mutually exclusive with any artifact rail (the caller is
 * responsible for clearing the other slot before opening this one — see
 * `AiChatPage`).
 */
export function SourcesRail({ payload, onClose, isMobile }: SourcesRailProps) {
  useEffect(() => {
    if (payload === null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [payload, onClose]);

  if (payload === null) {
    return null;
  }

  if (isMobile) {
    return (
      <Sheet onOpenChange={(open) => !open && onClose()} open>
        <SheetContent aria-label="Sources for this answer" side="right">
          <SheetTitle className="sr-only">Sources for this answer</SheetTitle>
          <SourcesRailBody payload={payload} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      aria-label="Sources panel"
      className="hidden h-full w-80 shrink-0 border-l bg-card md:flex md:flex-col"
    >
      <div className="flex items-center justify-end border-b px-2 py-1.5">
        <button
          aria-label="Close sources"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <SourcesRailBody payload={payload} />
      </div>
    </aside>
  );
}
