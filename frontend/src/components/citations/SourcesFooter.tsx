/**
 * SourcesFooter — the grouped sources footer for a completed answer
 * (PRD story 21).
 *
 * Official block (tier === 'official') and community block (tier === 'community'),
 * each entry: index chip + source name + vintage, wrapped in the citation
 * popover; url entries link out. The community label is permanent product
 * copy (PRD story 34's voice rule).
 */
import type { SourceEntry } from '@/api/protocol';
import { isSafeUrl } from '@/api/url';
import CitationPopover from '@/components/citations/CitationPopover';
import TierChip, {
  isCommunityTier,
  sourceDisplayName,
  tierLabel,
} from '@/components/citations/TierChip';

function SourceRow({ entry }: { entry: SourceEntry }) {
  const { citation } = entry;
  return (
    <li className="flex items-baseline gap-1.5 py-0.5">
      {/* The chip is the popover trigger — name/link stay separately tappable. */}
      <CitationPopover citation={citation}>
        <TierChip
          tier={citation.tier}
          aria-label={`Citation ${entry.index}: ${tierLabel(citation.source)}`}
        >
          {entry.index}
        </TierChip>
      </CitationPopover>
      <span className="text-xs text-text-primary">
        {isSafeUrl(citation.url) ? (
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {sourceDisplayName(citation.source)}
          </a>
        ) : (
          sourceDisplayName(citation.source)
        )}
      </span>
      <span className="text-xs text-text-secondary">{citation.vintage}</span>
    </li>
  );
}

function SourceGroup({ label, entries }: { label: string; entries: SourceEntry[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 first:mt-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      <ul className="mt-1">
        {entries.map((entry) => (
          <SourceRow key={entry.index} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

type SourcesFooterProps = {
  sources: SourceEntry[];
  /** The marker indexes cited in THIS message's prose (wire-contract §5,
   *  PINNED). The footer shows only these — never a source the message didn't
   *  cite. Viz cells contribute nothing (cards carry their own popovers). When
   *  omitted, the full list shows (callers that don't scan prose). */
  citedIndexes?: Set<number>;
};

export default function SourcesFooter({ sources, citedIndexes }: SourcesFooterProps) {
  const cited =
    citedIndexes !== undefined ? sources.filter((s) => citedIndexes.has(s.index)) : sources;
  if (cited.length === 0) {
    return null;
  }
  const official = cited.filter((s) => !isCommunityTier(s.citation.tier));
  const community = cited.filter((s) => isCommunityTier(s.citation.tier));

  return (
    <div className="not-prose mt-3 border-t border-border-light pt-3">
      <SourceGroup label="Official sources" entries={official} />
      <SourceGroup label="Community voice — experiences, not statistics" entries={community} />
    </div>
  );
}
