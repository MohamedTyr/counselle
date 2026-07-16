import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import type { EvidenceItem, ReplaySourceEntry, SourceEntry } from "@/api/chat/types";
import { isLegacySourceEntry } from "@/api/chat/legacy-replay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { safeExternalUrl, sourceDisplayName } from "../citations";
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
  return [...entry.evidence].sort((left, right) =>
    left.page - right.page || left.eid.localeCompare(right.eid),
  );
}

function EvidenceRow({ entry, item, active }: { entry: SourceEntry; item: EvidenceItem; active: boolean }) {
  return (
    <li
      className={cn("rounded-md border bg-background p-2 focus:outline-none", active && "ring-2 ring-ring")}
      aria-current={active ? "true" : undefined}
      data-active={active}
      id={evidenceId(entry.index, item.eid)}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3 text-xs font-medium text-foreground">
        <span>{item.label}</span><span>{item.value_display}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Page {item.page}
        {item.section != null ? ` · Section ${item.section}` : ""}
        {item.row_label != null ? ` · Row: ${item.row_label}` : ""}
        {item.column_label != null ? ` · Column: ${item.column_label}` : ""}
      </p>
      <blockquote className="mt-1 border-l-2 pl-2 text-xs text-muted-foreground">{item.excerpt}</blockquote>
    </li>
  );
}

function SourceRow({ entry, active }: { entry: ReplaySourceEntry; active: MessageSourcesPayload["active"] }) {
  const href = safeExternalUrl(entry.citation.url);
  const legacy = isLegacySourceEntry(entry);
  const isCds = !legacy && entry.citation.source === "cds";
  const activeEntry = active?.index === entry.index;
  const exactEvidence = activeEntry && active?.evidenceId !== undefined && !legacy &&
    entry.evidence.some((item) => item.eid === active.evidenceId);
  const activeRow = activeEntry && !exactEvidence;
  const label = sourceDisplayName(entry);
  return (
    <li
      aria-current={activeRow ? "true" : undefined}
      className={cn("rounded-lg border bg-card p-3 focus:outline-none", activeRow && "ring-2 ring-ring")}
      data-active={activeRow}
      id={`source-row-${entry.index}`}
      tabIndex={-1}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">[{entry.index}] {entry.label}</span>
        <Badge variant={entry.citation.tier === "official" ? "secondary" : "outline"}>
          {entry.citation.tier === "official" ? "Official" : "Community"}
        </Badge>
      </div>
      {isCds && (
        <p className="mt-1 text-xs text-muted-foreground">
          {!legacy && [entry.citation.source_kind, entry.citation.retrieved_at].filter(Boolean).join(" · ")}
        </p>
      )}
      {!isCds && <p className="mt-1 text-xs text-muted-foreground">{label}</p>}
      {!legacy && entry.snippet != null && <p className="mt-1 text-xs text-muted-foreground">{entry.snippet}</p>}
      {href !== undefined && (
        <a className="mt-1 block truncate text-xs text-primary underline" href={href} rel="noreferrer" target="_blank">{href}</a>
      )}
      {isCds && !legacy && entry.evidence.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {sortedEvidence(entry as SourceEntry).map((item) => (
            <EvidenceRow active={activeEntry && active?.evidenceId === item.eid} entry={entry} item={item} key={item.eid} />
          ))}
        </ul>
      )}
      {isCds && !legacy && entry.evidence_omitted_count > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">…and {entry.evidence_omitted_count} more values from this document</p>
      )}
    </li>
  );
}

function SourcesRailBody({ payload }: { payload: MessageSourcesPayload }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const focusedEntry = payload.active === undefined
      ? undefined
      : payload.sources.find((entry) => entry.index === payload.active?.index);
    const exactEvidence = focusedEntry !== undefined && payload.active?.evidenceId !== undefined
      && !isLegacySourceEntry(focusedEntry)
      && focusedEntry.evidence.some((item) => item.eid === payload.active?.evidenceId);
    const target = payload.active === undefined
      ? headingRef.current
      : document.getElementById(exactEvidence
          ? evidenceId(payload.active.index, payload.active.evidenceId!)
          : `source-row-${payload.active.index}`) ?? headingRef.current;
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }, [payload]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground focus:outline-none" ref={headingRef} tabIndex={-1}>
          {payload.sources.length} {payload.sources.length === 1 ? "source" : "sources"}
        </h2>
      </header>
      <ul className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {[...payload.sources].sort((left, right) => left.index - right.index).map((entry) => (
          <SourceRow active={payload.active} entry={entry} key={entry.index} />
        ))}
      </ul>
    </div>
  );
}

export function SourcesRail({ payload, onClose, isMobile }: SourcesRailProps) {
  useEffect(() => {
    if (payload === null) return;
    const handleKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [payload, onClose]);

  if (payload === null) return null;
  if (isMobile) {
    return <Sheet onOpenChange={(open) => !open && onClose()} open><SheetContent aria-label="Sources for this answer" side="right"><SheetTitle className="sr-only">Sources for this answer</SheetTitle><SourcesRailBody payload={payload} /></SheetContent></Sheet>;
  }
  return (
    <aside aria-label="Sources panel" className="hidden h-full w-80 shrink-0 border-l bg-card md:flex md:flex-col">
      <div className="flex items-center justify-end border-b px-2 py-1.5">
        <Button aria-label="Close sources" onClick={onClose} size="icon-sm" type="button" variant="ghost"><XIcon data-icon="inline-start" /></Button>
      </div>
      <div className="min-h-0 flex-1"><SourcesRailBody payload={payload} /></div>
    </aside>
  );
}
