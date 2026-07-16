import { memo, useMemo } from "react";
import { defaultRemarkPlugins } from "streamdown";

import type { ReplaySourceEntry, SourceFocus } from "@/api/chat/types";
import { Button } from "@/components/ui/button";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
} from "@/components/ai-elements/inline-citation";
import {
  MessageResponse,
  type MessageResponseProps,
} from "@/components/ai-elements/message";

import {
  friendlySourceName,
  isDbSource,
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
   *  markers that resolve to a non-DB (external) entry here. */
  sources?: ReplaySourceEntry[];
  onCitationOpen?: (focus: SourceFocus) => void;
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
 * backed by CDS/profile data remains visible as a compact accessible marker
 * button. A claim leaning on an external page renders a small named chip. A
 * marker whose source hasn't streamed in yet (or doesn't exist) renders
 * nothing — never a bare, unexplained digit.
 */
function CitationChip({
  index,
  sources,
  onOpen,
}: {
  index: number;
  sources: ReplaySourceEntry[] | undefined;
  onOpen?: (focus: SourceFocus) => void;
}) {
  const entry = uniqueSourceByIndex(sources, index);

  if (entry === undefined) {
    return null;
  }

  if (isLegacySourceEntry(entry) || isDbSource(entry.citation.source)) {
    return (
      <Button
        aria-label={`Open source ${entry.index}`}
        className="mx-0.5 h-5 min-w-5 rounded-full px-1.5 align-middle text-[10px]"
        onClick={() => onOpen?.({ index: entry.index })}
        size="sm"
        type="button"
        variant="secondary"
      >
        [{entry.index}]
      </Button>
    );
  }

  // The storage-only branch above narrows this to the current v2 contract.

  const label = friendlySourceName(entry.citation);
  const href = safeExternalUrl(entry.citation.url);
  const handleOpen = () => onOpen?.({ index: entry.index });

  return (
    <InlineCitation>
      <InlineCitationCard>
        <InlineCitationCardTrigger onClick={handleOpen} sources={[label]} />
        <InlineCitationCardBody>
          <div className="flex flex-col gap-1 p-3 text-xs">
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

function CitationRendererComponent({
  markdown,
  sources,
  onCitationOpen,
}: CitationRendererProps) {
  const components = useMemo(
    () =>
      ({
        "citation-ref": ({ index }: { index?: unknown }) => (
          <CitationChip
            index={typeof index === "number" ? index : Number(index)}
            onOpen={onCitationOpen}
            sources={sources}
          />
        ),
      }) as unknown as MessageResponseProps["components"],
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

export const CitationRenderer = memo(CitationRendererComponent);
