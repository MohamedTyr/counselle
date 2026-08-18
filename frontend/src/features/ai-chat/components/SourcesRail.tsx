import { GlobeIcon, SchoolIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import type {
  EvidenceItem,
  ReplaySourceEntry,
  SourceEntry,
  SourceFocus,
} from "@/api/chat/types";
import { isLegacySourceEntry } from "@/api/chat/legacy-replay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  faviconUrlForCitation,
  faviconUrlForDomain,
  safeExternalUrl,
  sourceDisplayName,
} from "../citations";
import type { MessageSourcesPayload } from "./MessageSources";

export type SourcesRailProps = {
  payload: MessageSourcesPayload | null;
  onClose: () => void;
  isMobile: boolean;
};

function evidenceId(index: number, eid: string): string {
  return `source-evidence-${index}-${encodeURIComponent(eid)}`;
}

function sortedEvidence(entry: SourceEntry): EvidenceItem[] {
  return [...entry.evidence].sort(
    (left, right) =>
      left.page - right.page || left.eid.localeCompare(right.eid),
  );
}

/** Respects reduced-motion for the programmatic focus-follow scroll so the
 * highlight jump doesn't fight a user's OS-level motion preference. */
function scrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

const activeCardClasses =
  "bg-[var(--surface-selected)] shadow-[inset_1.5px_0_0_var(--color-primary)]";

function EvidenceRow({
  entry,
  item,
  active,
}: {
  entry: SourceEntry;
  item: EvidenceItem;
  active: boolean;
}) {
  return (
    <li
      className={cn(
        "rounded-lg border border-transparent bg-[var(--surface-sunken)] p-2.5 transition-colors duration-200 ease-out focus:outline-none",
        active && activeCardClasses,
      )}
      aria-current={active ? "true" : undefined}
      data-active={active}
      id={evidenceId(entry.index, item.eid)}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3 text-xs font-medium text-foreground">
        <span>{item.label}</span>
        <span className="shrink-0 tabular-nums">{item.value_display}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Page {item.page}
        {item.section != null ? ` · Section ${item.section}` : ""}
        {item.row_label != null ? ` · Row: ${item.row_label}` : ""}
        {item.column_label != null ? ` · Column: ${item.column_label}` : ""}
      </p>
      <blockquote className="mt-1.5 border-l-2 border-l-border pl-2 text-xs text-muted-foreground italic">
        {item.excerpt}
      </blockquote>
    </li>
  );
}

function SourceAvatar({
  entry,
  schoolDomains,
}: {
  entry: ReplaySourceEntry;
  schoolDomains: Map<number, string>;
}) {
  const iconClasses = "size-3.5 shrink-0 text-muted-foreground";
  const frame =
    "grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg border bg-[var(--surface-sunken)]";

  if (isLegacySourceEntry(entry)) {
    return (
      <span className={frame}>
        <GlobeIcon aria-hidden="true" className={iconClasses} />
      </span>
    );
  }
  const citation = entry.citation;
  const domain =
    citation.school_unitid != null
      ? schoolDomains.get(citation.school_unitid)
      : undefined;
  if (domain !== undefined) {
    return (
      <span className={frame}>
        <img
          alt=""
          className="size-4 rounded-[3px]"
          src={faviconUrlForDomain(domain)}
        />
      </span>
    );
  }
  if (citation.source === "cds" || citation.source === "profile") {
    return (
      <span className={frame}>
        <SchoolIcon aria-hidden="true" className={iconClasses} />
      </span>
    );
  }
  const favicon = faviconUrlForCitation(citation);
  return (
    <span className={frame}>
      {favicon === undefined ? (
        <GlobeIcon aria-hidden="true" className={iconClasses} />
      ) : (
        <img alt="" className="size-4 rounded-[3px]" src={favicon} />
      )}
    </span>
  );
}

function SourceRow({
  entry,
  active,
  onSelect,
  schoolDomains,
}: {
  entry: ReplaySourceEntry;
  active: SourceFocus | undefined;
  onSelect: (index: number) => void;
  schoolDomains: Map<number, string>;
}) {
  const href = safeExternalUrl(entry.citation.url);
  const legacy = isLegacySourceEntry(entry);
  const isCds = !legacy && entry.citation.source === "cds";
  const activeEntry = active?.index === entry.index;
  const exactEvidence =
    activeEntry &&
    active?.evidenceId !== undefined &&
    !legacy &&
    entry.evidence.some((item) => item.eid === active.evidenceId);
  const activeRow = activeEntry && !exactEvidence;
  const caption = sourceDisplayName(entry);
  const title = (
    <span className="font-semibold text-foreground [overflow-wrap:anywhere]">
      {entry.label}
    </span>
  );
  return (
    <li
      aria-current={activeRow ? "true" : undefined}
      className={cn(
        "scroll-mt-3 cursor-pointer rounded-xl border border-transparent bg-card p-3 shadow-[var(--elevation-1)] transition-colors duration-200 ease-out focus:outline-none",
        !activeRow && "hover:border-border hover:bg-[var(--surface-hover)]",
        activeRow && activeCardClasses,
      )}
      data-active={activeRow}
      id={`source-row-${entry.index}`}
      onClick={() => onSelect(entry.index)}
      tabIndex={-1}
    >
      <div className="flex items-start gap-2">
        <SourceAvatar entry={entry} schoolDomains={schoolDomains} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{caption}</span>
            <Badge
              className="ml-auto shrink-0"
              size="sm"
              variant={
                entry.citation.tier === "official" ? "secondary" : "outline"
              }
            >
              {entry.citation.tier === "official" ? "Official" : "Community"}
            </Badge>
          </div>
          {href !== undefined ? (
            <a
              className="mt-1 block text-sm leading-snug hover:underline"
              href={href}
              rel="noreferrer"
              target="_blank"
            >
              {title}
            </a>
          ) : (
            <p className="mt-1 text-sm leading-snug">{title}</p>
          )}
          {!legacy && entry.snippet != null && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {entry.snippet}
            </p>
          )}
        </div>
      </div>
      {isCds && !legacy && entry.evidence.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 border-t pt-3">
          {sortedEvidence(entry as SourceEntry).map((item) => (
            <EvidenceRow
              active={activeEntry && active?.evidenceId === item.eid}
              entry={entry}
              item={item}
              key={item.eid}
            />
          ))}
        </ul>
      )}
      {isCds && !legacy && entry.evidence_omitted_count > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          …and {entry.evidence_omitted_count} more values from this document
        </p>
      )}
    </li>
  );
}

function SourcesRailHeader({
  count,
  headingRef,
  onClose,
}: {
  count: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-b-[color:var(--workspace-border)] bg-card/95 px-4 backdrop-blur-sm">
      <h2
        className="text-sm font-semibold text-foreground focus:outline-none"
        ref={headingRef}
        tabIndex={-1}
      >
        {count} {count === 1 ? "source" : "sources"}
      </h2>
      <Button
        aria-label="Close sources"
        onClick={onClose}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <XIcon data-icon="inline-start" />
      </Button>
    </header>
  );
}

/** The one panel body shared by the desktop rail and the mobile sheet — a
 * single header (no duplicate close bars) plus the scrollable source list.
 * `selected` is the card the sidebar visibly marks as current: it starts at
 * whatever citation opened the panel and moves the instant a different
 * citation or card is clicked — it never lingers on a stale source once a
 * new one is chosen, and it is the *only* thing driving the active-card
 * style, so exactly one card can ever carry it. */
function SourcesRailPanel({
  payload,
  onClose,
}: {
  payload: MessageSourcesPayload;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Resets `selected` to whatever citation just opened the panel whenever a
  // *new* payload arrives (a different citation/message was clicked) — done
  // during render, React's documented pattern for state that must track a
  // prop, rather than via a setState-in-effect that would cause an extra
  // render pass. `payload` is a fresh object per open, so identity alone is
  // the right change signal.
  const [priorPayload, setPriorPayload] = useState(payload);
  const [selected, setSelected] = useState<SourceFocus | undefined>(
    payload.active,
  );
  if (priorPayload !== payload) {
    setPriorPayload(payload);
    setSelected(payload.active);
  }

  useEffect(() => {
    const focusedEntry =
      payload.active === undefined
        ? undefined
        : payload.sources.find(
            (entry) => entry.index === payload.active?.index,
          );
    const exactEvidence =
      focusedEntry !== undefined &&
      payload.active?.evidenceId !== undefined &&
      !isLegacySourceEntry(focusedEntry) &&
      focusedEntry.evidence.some(
        (item) => item.eid === payload.active?.evidenceId,
      );
    const target =
      payload.active === undefined
        ? headingRef.current
        : (document.getElementById(
            exactEvidence
              ? evidenceId(payload.active.index, payload.active.evidenceId!)
              : `source-row-${payload.active.index}`,
          ) ?? headingRef.current);
    target?.focus();
    target?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" });
  }, [payload]);

  const count = payload.sources.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SourcesRailHeader count={count} headingRef={headingRef} onClose={onClose} />
      <ScrollArea
        className="sources-rail-scroll min-h-0 flex-1"
        scrollFade
        scrollbarGutter
      >
        <ul className="flex flex-col gap-2 p-1">
          {[...payload.sources]
            .sort((left, right) => left.index - right.index)
            .map((entry) => (
              <SourceRow
                active={selected}
                entry={entry}
                key={entry.index}
                onSelect={(index) => setSelected({ index })}
                schoolDomains={payload.schoolDomains}
              />
            ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

export function SourcesRail({ payload, onClose, isMobile }: SourcesRailProps) {
  useEffect(() => {
    if (payload === null) return;
    const handleKeyDown = (event: KeyboardEvent) =>
      event.key === "Escape" && onClose();
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [payload, onClose]);

  if (payload === null) return null;
  if (isMobile) {
    return (
      <Sheet onOpenChange={(open) => !open && onClose()} open>
        <SheetContent
          aria-label="Sources for this answer"
          className="w-full max-w-full rounded-none border-s-0"
          showCloseButton={false}
          side="right"
        >
          <SheetTitle className="sr-only">Sources for this answer</SheetTitle>
          <SourcesRailPanel onClose={onClose} payload={payload} />
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <aside
      aria-label="Sources panel"
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 hidden h-full w-[26rem] shrink-0 bg-sidebar text-sidebar-foreground duration-200 ease-out md:flex md:flex-col"
    >
      <SourcesRailPanel onClose={onClose} payload={payload} />
    </aside>
  );
}
