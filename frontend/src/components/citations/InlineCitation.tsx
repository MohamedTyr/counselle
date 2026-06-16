/**
 * InlineCitation — what a `[n]` marker becomes in prose (the replacement for the
 * old numbered chip).
 *
 * The grammar is no longer "this is a footnote": it's "this came from somewhere
 * you can see". So:
 *  - A figure from our own database (CDS / IPEDS / Scorecard) renders NOTHING
 *    inline — the number stands plainly; "Counselle data" credits it in the panel.
 *  - A claim leaning on an external page renders a named SourcePill (favicon +
 *    site name) that opens the sidebar at that source on click.
 *
 * A marker whose source hasn't streamed in yet renders nothing rather than a
 * bare number — better a clean sentence for a beat than a research-paper digit.
 */
import type { SourceEntry } from '@/api/protocol';
import SourcePill from '@/components/citations/SourcePill';
import { useCitationActivate } from '@/components/citations/CitationActivateContext';
import { useSources } from '@/components/citations/SourcesContext';
import { isDbSource } from '@/components/citations/sourceName';

interface InlineCitationProps {
  index: number;
}

export default function InlineCitation({ index }: InlineCitationProps) {
  const sources = useSources();
  const activate = useCitationActivate();
  const entry: SourceEntry | undefined = sources.find((s) => s.index === index);

  if (!entry || isDbSource(entry.citation.source)) {
    return null;
  }
  return <SourcePill entry={entry} onActivate={() => activate(entry)} />;
}

/**
 * The react-markdown components-map entry: `{ 'citation-ref': InlineCitationMarkdown }`.
 * react-markdown hands `index` as a string or number — coerce.
 */
export function InlineCitationMarkdown({ index }: { index: string | number }) {
  return <InlineCitation index={Number(index)} />;
}
