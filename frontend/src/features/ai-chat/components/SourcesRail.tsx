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

/** How long a citation-driven highlight stays lit before fading back to the
 * resting row. Long enough to find the row after the panel opens, short
 * enough that the panel never keeps a stale "selected" source afterwards. */
const HIGHLIGHT_MS = 1800;

/** The transient highlight: the sidebar's own selected-row fill, card-shaped
 * — the row is flat at rest and only takes a shape when it reacts. One
 * duration for the whole row, because hover rides the same `background-color`
 * transition and a hover that took half a second would feel broken. */
const highlightClasses =
  "rounded-lg transition-colors duration-200 ease-out data-[active=true]:bg-sidebar-active";

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
      className={cn("-mx-2 px-2 py-1 focus:outline-none", highlightClasses)}
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
  const iconClasses = "size-4 shrink-0 text-muted-foreground";
  // Flat list: the favicon sits directly on the panel, no framed tile. A tile
  // per row would be six little cards stacked down the rail.
  const frame = "grid size-4 shrink-0 place-items-center overflow-hidden";

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

/**
 * One source, rendered flat: no card, no fill, no shadow, no divider at rest
 * — just the panel's own surface. A fill in the shape of a rounded card
 * appears only when the row reacts (hover, or a citation highlight).
 *
 * The row *is* the link: the title anchor stretches over it
 * (`after:absolute after:inset-0`), so a click anywhere opens the source.
 * Clicking never changes the row's styling — the only thing that highlights
 * a row is a citation chip.
 *
 * When a CDS entry nests evidence rows, the stretch is scoped to the header
 * block instead — an overlay across the whole row would sit on top of the
 * excerpts and make them unselectable.
 */
function SourceRow({
  entry,
  active,
  schoolDomains,
}: {
  entry: ReplaySourceEntry;
  active: SourceFocus | undefined;
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
  const hasEvidence = isCds && !legacy && entry.evidence.length > 0;
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
        "relative scroll-mt-3 px-3 py-3 focus:outline-none",
        // Hover only when the row isn't already lit — otherwise the two
        // fills race on equal specificity and the highlight can lose.
        href !== undefined &&
          !activeRow &&
          "hover:bg-sidebar-accent has-[a:focus-visible]:bg-sidebar-accent",
        highlightClasses,
      )}
      data-active={activeRow}
      id={`source-row-${entry.index}`}
      tabIndex={-1}
    >
      <div
        className={cn("flex items-start gap-2.5", hasEvidence && "relative")}
      >
        <span className="mt-0.5">
          <SourceAvatar entry={entry} schoolDomains={schoolDomains} />
        </span>
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
              className="mt-1 block text-sm leading-snug after:absolute after:inset-0 focus-visible:outline-none hover:underline"
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
      {hasEvidence && (
        <ul className="mt-3 flex flex-col gap-2.5 ps-[26px]">
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
        <p className="mt-2 ps-[26px] text-xs text-muted-foreground">
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
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-b-sidebar-border px-4">
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
 * `highlighted` is a *transient* mark, not a selection: clicking a citation
 * chip opens the panel and lights that one source so it can be found, then
 * the mark fades out on its own. Nothing else sets it — clicking a row in
 * the panel follows the link, it does not select anything — so the rail
 * never sits there wearing a stale highlight. */
function SourcesRailPanel({
  payload,
  onClose,
}: {
  payload: MessageSourcesPayload;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Relights the highlight whenever a *new* payload arrives (a different
  // citation/message was clicked) — done during render, React's documented
  // pattern for state that must track a prop, rather than via a
  // setState-in-effect that would cause an extra render pass. `payload` is a
  // fresh object per open, so identity alone is the right change signal.
  const [priorPayload, setPriorPayload] = useState(payload);
  const [highlighted, setHighlighted] = useState<SourceFocus | undefined>(
    payload.active,
  );
  if (priorPayload !== payload) {
    setPriorPayload(payload);
    setHighlighted(payload.active);
  }

  useEffect(() => {
    if (payload.active === undefined) return;
    const timer = window.setTimeout(
      () => setHighlighted(undefined),
      HIGHLIGHT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [payload]);

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
      <SourcesRailHeader
        count={count}
        headingRef={headingRef}
        onClose={onClose}
      />
      {/* No scrollbar gutter: the rows run edge to edge so their hairlines
          read as one continuous list, and the overlay scrollbar rides over
          the row's own right padding. */}
      <ScrollArea className="sources-rail-scroll min-h-0 flex-1" scrollFade>
        {/* The list pads itself so a hovered/highlighted row's fill reads as
            a card inset from the panel edges, never a full-bleed band. */}
        <ul className="flex flex-col gap-0.5 p-2">
          {[...payload.sources]
            .sort((left, right) => left.index - right.index)
            .map((entry) => (
              <SourceRow
                active={highlighted}
                entry={entry}
                key={entry.index}
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
          className="w-full max-w-full rounded-none border-s-0 bg-sidebar text-sidebar-foreground"
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
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 hidden h-full w-[26rem] shrink-0 border-s border-s-sidebar-border bg-sidebar text-sidebar-foreground duration-200 ease-out md:flex md:flex-col"
    >
      <SourcesRailPanel onClose={onClose} payload={payload} />
    </aside>
  );
}
