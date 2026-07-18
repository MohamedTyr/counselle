import { GlobeIcon, SchoolIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
    return <img alt="" className="size-3.5 rounded-full" src={faviconUrlForDomain(domain)} />;
  }
  if (citation.source === "cds" || citation.source === "profile") {
    return <SchoolIcon aria-hidden="true" className="size-3.5" />;
  }
  const favicon = faviconUrlForCitation(citation);
  return favicon === undefined ? (
    <GlobeIcon aria-hidden="true" className="size-3.5" />
  ) : (
    <img alt="" className="size-3.5 rounded-full" src={favicon} />
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
 * legacy): a real accessible button showing the source's icon and name —
 * real school favicon for CDS/profile when a matching viz table exists in
 * the same message, real site favicon for web/edu/reddit, a generic icon
 * otherwise. Never a bracketed index; this is a chat answer, not a research
 * paper's footnote. A marker whose source hasn't streamed in yet (or
 * doesn't exist) renders nothing — never a bare, unexplained mark.
 */
function CitationChip({
  index,
  sources,
  onOpen,
  schoolDomains,
}: {
  index: number;
  sources: ReplaySourceEntry[] | undefined;
  onOpen?: (focus: SourceFocus) => void;
  schoolDomains?: Map<number, string>;
}) {
  const entry = uniqueSourceByIndex(sources, index);

  if (entry === undefined) {
    return null;
  }

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
              <GlobeIcon aria-hidden="true" className="size-3.5" />
            )
          }
          label={label}
          onClick={handleOpen}
        />
        <InlineCitationCardBody>
          <ChipBody entry={entry} label={label} />
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}

const PLACEHOLDER_ATTR = "data-citation-index";

function sameNodeList(a: HTMLElement[], b: HTMLElement[]): boolean {
  return a.length === b.length && a.every((node, i) => node === b[i]);
}

function CitationRendererComponent({
  markdown,
  sources,
  onCitationOpen,
  schoolDomains,
}: CitationRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [placeholders, setPlaceholders] = useState<HTMLElement[]>([]);

  // Streamdown caches each parsed markdown block's rendered output once that
  // block's own text stops changing, and reuses it by React-element identity
  // on later renders — so a mapped "citation-ref" component invoked only
  // during that first pass can get permanently frozen with whatever
  // `sources`/`displayNumbers` closure was live at that moment, even though
  // the registry finishes arriving (and this component's own props update)
  // afterward. The mapped renderer below is a plain, data-free placeholder
  // node (so freezing it is harmless — it never needs to change), and this
  // effect finds those placeholders after every render of *this* component
  // and portals the live chip content into them directly, bypassing
  // Streamdown's internal caching entirely. It intentionally has no
  // dependency array — it must re-scan on every render (new placeholders
  // can appear as streaming text grows), and `sameNodeList` makes the state
  // update a no-op once the node set stabilizes, so this does not loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const nodes = Array.from(container.querySelectorAll<HTMLElement>(`[${PLACEHOLDER_ATTR}]`));
    setPlaceholders((previous) => (sameNodeList(previous, nodes) ? previous : nodes));
  });

  const components = useMemo(
    () =>
      ({
        "citation-ref": ({ index }: { index?: unknown }) => (
          <span
            {...{ [PLACEHOLDER_ATTR]: typeof index === "number" ? index : Number(index) }}
          />
        ),
      }) as unknown as MessageResponseProps["components"],
    [],
  );

  return (
    <div ref={containerRef} style={{ display: "contents" }}>
      <MessageResponse
        allowedTags={allowedTags}
        components={components}
        remarkPlugins={remarkPlugins}
      >
        {markdown}
      </MessageResponse>
      {placeholders.map((node, i) =>
        createPortal(
          <CitationChip
            index={Number(node.getAttribute(PLACEHOLDER_ATTR))}
            onOpen={onCitationOpen}
            schoolDomains={schoolDomains}
            sources={sources}
          />,
          node,
          i,
        ),
      )}
    </div>
  );
}

export const CitationRenderer = memo(CitationRendererComponent);
