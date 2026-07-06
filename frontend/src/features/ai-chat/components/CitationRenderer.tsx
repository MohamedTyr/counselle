import { useMemo } from "react";
import { defaultRemarkPlugins } from "streamdown";

import type { SourceEntry } from "@/api/chat/types";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
} from "@/components/ai-elements/inline-citation";
import { MessageResponse } from "@/components/ai-elements/message";

import {
  friendlySourceName,
  isDbSource,
  safeExternalUrl,
  uniqueSourceByIndex,
} from "../citations";
import { remarkCitationRefs } from "./remark-citation-refs";

export type CitationRendererProps = {
  /** One markdown block's raw text (a single `ContentBlock` of kind
   *  "markdown"). Callers interleave this with `VizBlock` per the message's
   *  `blocks` order — this component only owns the markdown+citation layer. */
  markdown: string;
  /** The message's cumulative source registry. Citation chips render only for
   *  markers that resolve to a non-DB (external) entry here. */
  sources?: SourceEntry[];
  onCitationOpen?: (index: number) => void;
};

// `defaultRemarkPlugins` is a named-plugin map (`{ gfm, codeMeta }`), not a
// list — `Object.values` reconstructs the exact `PluggableList` Streamdown
// uses internally, so appending our citation-ref transform can't silently
// drop GFM (tables, strikethrough, etc.) or fenced-code-meta support.
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkCitationRefs];
const allowedTags = { "citation-ref": ["index"] };

/**
 * CitationChip — what a `[n]` marker becomes in rendered prose.
 *
 * The grammar (ported from the old app's InlineCitation, PINNED): a figure
 * backed by our own database (CDS/IPEDS/Scorecard) renders NOTHING inline —
 * the fact is credited in the sources strip/panel instead, never a pill. A
 * claim leaning on an external page renders a small named chip. A marker
 * whose source hasn't streamed in yet (or doesn't exist) also renders
 * nothing — never a bare, unexplained digit.
 */
function CitationChip({
  index,
  sources,
  onOpen,
}: {
  index: number;
  sources: SourceEntry[] | undefined;
  onOpen?: (index: number) => void;
}) {
  const entry = uniqueSourceByIndex(sources, index);

  if (entry === undefined || isDbSource(entry.citation.source)) {
    return null;
  }

  const label = friendlySourceName(entry.citation);
  const href = safeExternalUrl(entry.citation.url);
  const handleOpen = () => onOpen?.(entry.index);

  return (
    <InlineCitation>
      <InlineCitationCard>
        <InlineCitationCardTrigger onClick={handleOpen} sources={[label]} />
        <InlineCitationCardBody>
          <div className="space-y-1 p-3 text-xs">
            <div className="font-medium text-foreground">{label}</div>
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
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}

export function CitationRenderer({
  markdown,
  sources,
  onCitationOpen,
}: CitationRendererProps) {
  const components = useMemo(
    () => ({
      "citation-ref": ({ index }: { index: string | number }) => (
        <CitationChip index={Number(index)} onOpen={onCitationOpen} sources={sources} />
      ),
    }),
    [onCitationOpen, sources],
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
