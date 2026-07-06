import { BookOpenIcon } from "lucide-react";

import type { SourceEntry } from "@/api/chat/types";
import { cn } from "@/lib/utils";

import {
  citedSourcesForMessage,
  dbSchoolsForMessage,
  dbSourcesForMessage,
  friendlySourceName,
  isDbSource,
  sortSourcesByTrust,
  usedDbData,
} from "../citations";
import type { AssistantChatMessage } from "../model";

export type MessageSourcesPayload = {
  /** DB entries (if any) followed by cited external entries — the panel/rail
   *  renders this exact order. */
  sources: SourceEntry[];
  /** Whether the answer visibly used Counselle's own data (DB-cited prose OR
   *  a DB-backed viz cell) — drives the "Counselle data" card, never a stray
   *  cumulative DB source row. */
  dbUsed: boolean;
  /** School names the DB-backed content covers, for the panel card subline. */
  dbSchools: string[];
  /** Source index or DB-card sentinel the shared rail should focus on open. */
  activeIndex?: number | "counselle-data";
};

export type MessageSourcesProps = {
  message: Pick<AssistantChatMessage, "blocks" | "text" | "sources" | "turnStatus">;
  onOpen?: (payload: MessageSourcesPayload) => void;
  activeIndex?: number | "counselle-data";
};

const MAX_BADGES = 3;

function SourceBadge({ entry, stacked }: { entry: SourceEntry; stacked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[26px] shrink-0 place-items-center rounded-full border bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background",
        stacked && "-ml-2.5",
      )}
      title={friendlySourceName(entry.citation)}
    >
      {friendlySourceName(entry.citation).slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * MessageSources — the collapsed sources affordance under a completed
 * assistant turn (ported from the old app's MessageSources/SourcesStrip).
 *
 * Shows only once the turn has settled (`complete` or `cancelled`) — the
 * backend emits its `sources` event before `done`, so without this guard the
 * strip would flash in while prose is still streaming. Shows the sources
 * THIS message actually cited in prose (the `[n]` grammar, single-sourced via
 * `citedSourcesForMessage` in `../citations`), plus exactly one "Counselle
 * data" credit — never a stray cumulative DB source row — when DB-backed
 * prose or viz cells were used.
 */
export function MessageSources({ message, onOpen, activeIndex }: MessageSourcesProps) {
  if (message.turnStatus !== "complete" && message.turnStatus !== "cancelled") {
    return null;
  }

  const externalCited = citedSourcesForMessage(message).filter(
    (entry) => !isDbSource(entry.citation.source),
  );
  const sortedExternalCited = sortSourcesByTrust(externalCited);
  const dbUsed = usedDbData(message);
  const dbEntries = dbSourcesForMessage(message);
  const dbSchools = dbSchoolsForMessage(message);

  const displayCount = (dbUsed ? 1 : 0) + sortedExternalCited.length;
  if (displayCount === 0) {
    return null;
  }

  const badges = sortedExternalCited.slice(0, MAX_BADGES);
  const countLabel = `${displayCount} ${displayCount === 1 ? "source" : "sources"}`;
  const ariaLabel =
    dbUsed && sortedExternalCited.length < displayCount
      ? `View ${countLabel} for this answer, including Counselle data`
      : `View ${countLabel} for this answer`;

  const handleOpen = () => {
    onOpen?.({
      sources: [...dbEntries, ...sortedExternalCited],
      dbUsed,
      dbSchools,
      activeIndex,
    });
  };

  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        "not-prose group/strip -mx-2 inline-flex w-fit max-w-full items-center gap-2 rounded-full px-2 py-1 text-left transition-colors",
        "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      onClick={handleOpen}
      type="button"
    >
      <span className="flex shrink-0 items-center">
        {badges.length > 0 ? (
          badges.map((entry, index) => (
            <SourceBadge entry={entry} key={entry.index} stacked={index > 0} />
          ))
        ) : (
          <BookOpenIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground transition-colors group-hover/strip:text-foreground">
        {countLabel}
      </span>
    </button>
  );
}
