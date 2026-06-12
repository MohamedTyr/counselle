/**
 * CitationRef — the inline prose citation chip for a `[n]` marker
 * (PRD stories 19 + 26).
 *
 * Looks up the SourceEntry by `index` from SourcesContext. Found → a
 * TierChip in a CitationPopover; not found yet (sources still streaming)
 * → the bare chip, official styling by default.
 */
import { useSources } from '@/components/citations/SourcesContext';
import CitationPopover from '@/components/citations/CitationPopover';
import TierChip from '@/components/citations/TierChip';

interface CitationRefProps {
  index: number;
}

export default function CitationRef({ index }: CitationRefProps) {
  const sources = useSources();
  const entry = sources.find((s) => s.index === index);

  const chip = (
    <TierChip
      tier={entry?.citation.tier ?? 'cds'}
      aria-label={entry ? `Citation ${index}: ${entry.citation.source}` : `Citation ${index}`}
      className="mx-0.5 -translate-y-[0.2em] cursor-pointer"
    >
      {index}
    </TierChip>
  );

  if (!entry) {
    return chip;
  }
  return <CitationPopover citation={entry.citation}>{chip}</CitationPopover>;
}
