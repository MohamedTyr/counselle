/**
 * SourcesFooter — the grouped sources footer for a completed answer
 * (PRD story 21).
 *
 * Official block (tier !== 'reddit') and community block (tier === 'reddit'),
 * each entry: index chip + source name + vintage, wrapped in the citation
 * popover; url entries link out. The community label is permanent product
 * copy (PRD story 34's voice rule).
 */
import type { SourceEntry } from '@/api/protocol';
import CitationPopover from '@/components/citations/CitationPopover';
import TierChip, { isCommunityTier } from '@/components/citations/TierChip';

function SourceRow({ entry }: { entry: SourceEntry }) {
  const { citation } = entry;
  return (
    <li className="flex items-baseline gap-1.5 py-0.5">
      {/* The chip is the popover trigger — name/link stay separately tappable. */}
      <CitationPopover citation={citation}>
        <TierChip tier={citation.tier} aria-label={`Citation ${entry.index}: ${citation.source}`}>
          {entry.index}
        </TierChip>
      </CitationPopover>
      <span className="text-xs text-text-primary">
        {citation.url != null && citation.url !== '' ? (
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {citation.source}
          </a>
        ) : (
          citation.source
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

export default function SourcesFooter({ sources }: { sources: SourceEntry[] }) {
  if (sources.length === 0) {
    return null;
  }
  const official = sources.filter((s) => !isCommunityTier(s.citation.tier));
  const community = sources.filter((s) => isCommunityTier(s.citation.tier));

  return (
    <div className="not-prose mt-3 border-t border-border-light pt-3">
      <SourceGroup label="Official sources" entries={official} />
      <SourceGroup label="Community voice — experiences, not statistics" entries={community} />
    </div>
  );
}
