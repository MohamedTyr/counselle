import { BookOpenIcon, GlobeIcon, SchoolIcon } from "lucide-react";
import { useState } from "react";

import { isLegacySourceEntry } from "@/api/chat/legacy-replay";
import type {
  MessageSourcesPayload,
  ReplaySourceEntry,
  SourceFocus,
} from "@/api/chat/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  faviconUrlForCitation,
  faviconUrlForDomain,
  sourceDisplayName,
  sourcesPayloadFor,
} from "../citations";
import type { AssistantChatMessage } from "../model";

export type { MessageSourcesPayload } from "@/api/chat/types";

export type MessageSourcesProps = {
  message: Pick<
    AssistantChatMessage,
    "blocks" | "text" | "sources" | "turnStatus"
  >;
  onOpen?: (payload: MessageSourcesPayload) => void;
  active?: SourceFocus;
};

const MAX_BADGES = 3;

/** The badge's real favicon, when the entry resolves to one: a school
 * citation via its viz-supplied domain (`schoolDomains`), anything else via
 * its own URL host. Undefined means the entry has no domain of its own — the
 * badge falls back to the same icon vocabulary the sources rail uses, never
 * to a guessed domain. */
function badgeFaviconUrl(
  entry: ReplaySourceEntry,
  schoolDomains: Map<number, string>,
): string | undefined {
  if (isLegacySourceEntry(entry)) return undefined;
  const citation = entry.citation;
  const domain =
    citation.school_unitid != null
      ? schoolDomains.get(citation.school_unitid)
      : undefined;
  return domain === undefined
    ? faviconUrlForCitation(citation)
    : faviconUrlForDomain(domain);
}

/** Same fallback vocabulary as the sources rail: a school mark for a
 * school-owned citation with no known domain, a globe for everything else. */
function FallbackIcon({ entry }: { entry: ReplaySourceEntry }) {
  const school =
    !isLegacySourceEntry(entry) &&
    (entry.citation.source === "cds" || entry.citation.source === "profile");
  return school ? (
    <SchoolIcon aria-hidden="true" className="size-3" />
  ) : (
    <GlobeIcon aria-hidden="true" className="size-3" />
  );
}

function SourceBadge({
  entry,
  schoolDomains,
  stacked,
}: {
  entry: ReplaySourceEntry;
  schoolDomains: Map<number, string>;
  stacked: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const name = sourceDisplayName(entry);
  const favicon = badgeFaviconUrl(entry, schoolDomains);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[22px] shrink-0 place-items-center overflow-hidden rounded-full border bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background",
        stacked && "-ml-2",
      )}
      title={name}
    >
      {favicon === undefined || failed ? (
        <FallbackIcon entry={entry} />
      ) : (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
          src={favicon}
        />
      )}
    </span>
  );
}

export function MessageSources({
  message,
  onOpen,
  active,
}: MessageSourcesProps) {
  if (message.turnStatus !== "complete" && message.turnStatus !== "cancelled")
    return null;
  const payload = sourcesPayloadFor(message, active);
  if (payload === null) return null;

  const countLabel = `${payload.sources.length} ${payload.sources.length === 1 ? "source" : "sources"}`;
  const badges = payload.sources.slice(0, MAX_BADGES);

  return (
    <Button
      aria-label={`View ${countLabel} for this answer`}
      className={cn(
        "not-prose group/strip h-8 w-fit max-w-full gap-1.5 rounded-full px-2",
      )}
      onClick={() => onOpen?.(payload)}
      size="sm"
      type="button"
      variant="ghost"
    >
      <span className="flex shrink-0 items-center">
        {badges.length > 0 ? (
          badges.map((entry, index) => (
            <SourceBadge
              entry={entry}
              key={entry.index}
              schoolDomains={payload.schoolDomains}
              stacked={index > 0}
            />
          ))
        ) : (
          <BookOpenIcon
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
        )}
      </span>
      <span className="shrink-0 text-sm text-muted-foreground transition-colors group-hover/strip:text-foreground">
        {countLabel}
      </span>
    </Button>
  );
}
