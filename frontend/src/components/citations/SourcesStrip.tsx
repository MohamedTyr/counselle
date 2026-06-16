/**
 * SourcesStrip — the collapsed "sources" affordance under a completed answer.
 *
 * Deliberately minimal (ChatGPT-style): a small stack of overlapping source
 * favicons followed by a plain "{n} sources" label, no pill chrome. The whole
 * thing is one button that opens the SourcesPanel (the full provenance list).
 * It lives inline in the message action row, next to copy / feedback /
 * regenerate.
 *
 * Honours `citedIndexes` exactly like SourcesFooter did — never counts a source
 * the message didn't cite.
 */
import { cn } from '@librechat/client/utils';
import type { SourceEntry } from '@/api/protocol';
import SourceFavicon from '@/components/citations/SourceFavicon';

/** How many logos to overlap in the stack; the label carries the true count. */
const MAX_BADGES = 3;

type SourcesStripProps = {
  sources: SourceEntry[];
  /** Marker indexes cited in this message's prose (wire-contract §5). When
   *  given, only these sources are summarised. */
  citedIndexes?: Set<number>;
  /** Overrides the count in the "{n} sources" label (favicons still come from
   *  `sources`). Lets the strip show externals-only logos while the label still
   *  reflects the full cited set — the Counselle card counting as one — so the
   *  strip and the panel header agree. */
  displayCount?: number;
  /** Opens the full sources panel. */
  onOpen: () => void;
};

function Badge({ entry, stacked }: { entry: SourceEntry; stacked: boolean }) {
  return (
    <SourceFavicon
      citation={entry.citation}
      sizeClass="h-[26px] w-[26px]"
      className={cn(
        // The favicons notch into the chat surface (ring = page bg), so the
        // overlap reads as a clean stack rather than a smear.
        'ring-2 ring-surface-primary',
        stacked && '-ml-2.5',
      )}
    />
  );
}

export default function SourcesStrip({
  sources,
  citedIndexes,
  displayCount,
  onOpen,
}: SourcesStripProps) {
  const cited =
    citedIndexes !== undefined ? sources.filter((s) => citedIndexes.has(s.index)) : sources;
  // A DB-only answer has zero external favicons but still cites sources, so the
  // strip must appear so the student can open the panel's Counselle card. Gate
  // on the EFFECTIVE count (the full cited set when `displayCount` is supplied),
  // not on the favicons actually shown.
  const effectiveCount = displayCount ?? cited.length;
  if (effectiveCount === 0) {
    return null;
  }

  const badges = cited.slice(0, MAX_BADGES);
  // The label counts the full cited set (Counselle card = 1) when `displayCount`
  // is supplied; otherwise it falls back to the favicons actually shown.
  const labelCount = effectiveCount;
  const countLabel = `${labelCount} ${labelCount === 1 ? 'source' : 'sources'}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`View ${countLabel} for this answer`}
      className={cn(
        'not-prose group/strip inline-flex w-fit max-w-full items-center gap-2 rounded-full',
        // Flat when idle; a quiet rounded-full surface appears on hover/focus.
        '-mx-2 px-2 py-1 text-left transition-colors duration-150 ease-out',
        'hover:bg-surface-hover focus-visible:bg-surface-hover',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="flex shrink-0 items-center">
        {badges.map((entry, i) => (
          <Badge key={entry.index} entry={entry} stacked={i > 0} />
        ))}
      </span>

      <span className="shrink-0 text-[15px] text-text-tertiary transition-colors group-hover/strip:text-text-secondary">
        {countLabel}
      </span>
    </button>
  );
}
