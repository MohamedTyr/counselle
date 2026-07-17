import { GlobeIcon, SchoolIcon } from "lucide-react";
import { memo, useMemo } from "react";
import { defaultRemarkPlugins } from "streamdown";

import type { Citation, ReplaySourceEntry, SourceFocus } from "@/api/chat/types";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
} from "@/components/ai-elements/inline-citation";
import { Badge } from "@/components/ui/badge";
import {
  MessageResponse,
  type MessageResponseProps,
} from "@/components/ai-elements/message";

import {
  citationYearLabel,
  faviconUrlForCitation,
  faviconUrlForDomain,
  friendlySourceName,
  hostOf,
  safeExternalUrl,
  uniqueSourceByIndex,
} from "../citations";
import { isLegacySourceEntry } from "@/api/chat/legacy-replay";
import { remarkCitationRefs } from "./remark-citation-refs";

export type CitationRendererProps = {
  /** One markdown block's raw text (a single `ContentBlock` of kind
   *  "markdown"). Callers interleave this with `VizBlock` per the message's
   *  `blocks` order — this component only owns the markdown+citation layer. */
  markdown: string;
  /** The message's cumulative source registry. Citation chips render only for
   *  markers that resolve to a unique entry here. */
  sources?: ReplaySourceEntry[];
  onCitationOpen?: (focus: SourceFocus) => void;
  /** Sequential, first-appearance display numbers keyed by raw registry
   *  index — absent for narration, which intentionally keeps raw indices. */
  displayNumbers?: Map<number, number>;
  /** CDS/profile `school_unitid` -> real school domain, sourced from any
   *  tabular viz spec in the same message. */
  schoolDomains?: Map<number, string>;
};

// `defaultRemarkPlugins` is a named-plugin map (`{ gfm, codeMeta }`), not a
// list — `Object.values` reconstructs the exact `PluggableList` Streamdown
// uses internally, so appending our citation-ref transform can't silently
// drop GFM (tables, strikethrough, etc.) or fenced-code-meta support.
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkCitationRefs];
const allowedTags = { "citation-ref": ["index"] };

function TierBadge({ citation }: { citation: Citation }) {
  return (
    <Badge variant={citation.tier === "official" ? "secondary" : "outline"}>
      {citation.tier === "official" ? "Official" : "Community"}
    </Badge>
  );
}

function ChipIcon({
  citation,
  schoolDomains,
}: {
  citation: Citation;
  schoolDomains: Map<number, string> | undefined;
}) {
  const domain =
    citation.school_unitid != null ? schoolDomains?.get(citation.school_unitid) : undefined;
  if (domain !== undefined) {
    return <img alt="" className="size-3 rounded-[2px]" src={faviconUrlForDomain(domain)} />;
  }
  if (citation.source === "cds" || citation.source === "profile") {
    return <SchoolIcon aria-hidden="true" className="size-3" />;
  }
  const favicon = faviconUrlForCitation(citation);
  return favicon === undefined ? (
    <GlobeIcon aria-hidden="true" className="size-3" />
  ) : (
    <img alt="" className="size-3 rounded-[2px]" src={favicon} />
  );
}

function ChipBody({ entry, label }: { entry: ReplaySourceEntry; label: string }) {
  if (isLegacySourceEntry(entry)) {
    const href = safeExternalUrl(entry.citation.url);
    return (
      <div className="flex flex-col gap-1 p-3 text-xs">
        <div className="font-medium text-foreground">{label}</div>
        {href !== undefined && (
          <a
            className="block truncate text-primary underline"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            {href}
          </a>
        )}
      </div>
    );
  }

  const citation = entry.citation;
  const isDb = citation.source === "cds" || citation.source === "profile";
  const year = citationYearLabel(citation);
  const href = isDb ? undefined : safeExternalUrl(citation.url);
  const host = isDb ? undefined : hostOf(citation);

  return (
    <div className="flex flex-col gap-1 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">{label}</span>
        <TierBadge citation={citation} />
      </div>
      {host !== undefined && host !== null && (
        <p className="text-muted-foreground">{host}</p>
      )}
      {year !== undefined && <p className="text-muted-foreground">{year}</p>}
      {entry.snippet !== undefined && entry.snippet !== null && (
        <p className="text-muted-foreground">{entry.snippet}</p>
      )}
      {href !== undefined && (
        <a
          className="block truncate text-primary underline"
          href={href}
          rel="noreferrer"
          target="_blank"
        >
          {href}
        </a>
      )}
    </div>
  );
}

/**
 * CitationChip — what a `[n]` marker becomes in rendered prose.
 *
 * One chip shape for every source kind (CDS, profile, web, edu, reddit,
 * legacy): a real accessible button showing a sequential, first-appearance
 * display number (never the raw, gappy registry index) plus a kind-specific
 * icon — real school favicon for CDS/profile when a matching viz table
 * exists in the same message, real site favicon for web/edu/reddit, a
 * generic icon otherwise. A marker whose source hasn't streamed in yet (or
 * doesn't exist) renders nothing — never a bare, unexplained digit.
 */
function CitationChip({
  index,
  sources,
  onOpen,
  displayNumbers,
  schoolDomains,
}: {
  index: number;
  sources: ReplaySourceEntry[] | undefined;
  onOpen?: (focus: SourceFocus) => void;
  displayNumbers?: Map<number, number>;
  schoolDomains?: Map<number, string>;
}) {
  const entry = uniqueSourceByIndex(sources, index);

  if (entry === undefined) {
    return null;
  }

  const displayNumber = displayNumbers?.get(entry.index) ?? entry.index;
  const label = isLegacySourceEntry(entry) ? entry.citation.source : friendlySourceName(entry.citation);
  const citation = isLegacySourceEntry(entry) ? undefined : entry.citation;
  const handleOpen = () => onOpen?.({ index: entry.index });

  return (
    <InlineCitation>
      <InlineCitationCard>
        <InlineCitationCardTrigger
          icon={
            citation !== undefined ? (
              <ChipIcon citation={citation} schoolDomains={schoolDomains} />
            ) : (
              <GlobeIcon aria-hidden="true" className="size-3" />
            )
          }
          index={displayNumber}
          onClick={handleOpen}
        />
        <InlineCitationCardBody>
          <ChipBody entry={entry} label={label} />
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}

function CitationRendererComponent({
  markdown,
  sources,
  onCitationOpen,
  displayNumbers,
  schoolDomains,
}: CitationRendererProps) {
  const components = useMemo(
    () =>
      ({
        "citation-ref": ({ index }: { index?: unknown }) => (
          <CitationChip
            displayNumbers={displayNumbers}
            index={typeof index === "number" ? index : Number(index)}
            onOpen={onCitationOpen}
            schoolDomains={schoolDomains}
            sources={sources}
          />
        ),
      }) as unknown as MessageResponseProps["components"],
    [displayNumbers, onCitationOpen, schoolDomains, sources],
  );

  return (
    <MessageResponse
      allowedTags={allowedTags}
      components={components}
      remarkPlugins={remarkPlugins}
    >
      {markdown}
    </MessageResponse>
  );
}

export const CitationRenderer = memo(CitationRendererComponent);
