/**
 * SourcesList — the body of the sources sidebar.
 *
 * Two kinds of source, one calm list:
 *  1. "Counselle data" — every structured figure, collapsed into one friendly,
 *     pinned card (no IPEDS / Scorecard / CDS jargon).
 *  2. External pages — one row each, official first, community after.
 *
 * `activeIndex` (set when the panel is opened from an inline pill) scrolls the
 * matching row into view and flashes it.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { SourceEntry } from '@/api/protocol';
import CounselleSourceCard from '@/components/citations/CounselleSourceCard';
import SourceRow from '@/components/citations/SourceRow';
import { isDbSource } from '@/components/citations/sourceName';

interface SourcesListProps {
  sources: SourceEntry[];
  /** Marker index opened from an inline pill — scrolled to + flashed. */
  activeIndex?: number | null;
  /** Schools the figures cover, for the Counselle card subline. Passed in (DB
   *  source labels are dataset vintages, not school names). */
  dbSchools?: string[];
  /** Whether to show the "Counselle data" card. Decoupled from `dbEntries`
   *  presence (FE-H4) so a viz-only answer — which has zero DB source rows but
   *  DID use Counselle data — still surfaces the card. Defaults to "has DB
   *  entries" for back-compat callers; `MessageSources` passes the authoritative
   *  `usedDbData` signal. */
  showDbCard?: boolean;
}

/**
 * Counts what the panel header shows: one "Counselle data" entry (when the
 * answer used DB data) + each external page. DB inclusion is the caller's
 * authoritative `dbUsed` signal (`usedDbData`) — NOT a prose `[n]` scan and NOT
 * the presence of DB source rows (a viz-only answer has none but still used
 * Counselle data). External rows are passed in already filtered (FE-H4).
 */
export function displaySourceCount(externals: SourceEntry[], dbUsed: boolean): number {
  return (dbUsed ? 1 : 0) + externals.length;
}

/** Trust order within the external list: a school's/gov's own site, then general
 *  web, then Reddit (the most "just opinions"). */
function externalRank(entry: SourceEntry): number {
  if (entry.citation.source === 'reddit') return 2;
  if (entry.citation.tier === 'community') return 1;
  return 0;
}

export default function SourcesList({
  sources,
  activeIndex,
  dbSchools,
  showDbCard,
}: SourcesListProps) {
  const { dbEntries, externals } = useMemo(() => {
    const db = sources.filter((s) => isDbSource(s.citation.source));
    const ext = sources
      .filter((s) => !isDbSource(s.citation.source))
      .slice()
      .sort((a, b) => externalRank(a) - externalRank(b));
    return { dbEntries: db, externals: ext };
  }, [sources]);

  // The card shows when the host says so (viz-only answers have no DB rows but
  // still used Counselle data); back-compat callers fall back to "has DB rows".
  const renderDbCard = showDbCard ?? dbEntries.length > 0;
  const counselleActive = activeIndex != null && dbEntries.some((e) => e.index === activeIndex);
  const counselleRef = useRef<HTMLLIElement>(null);
  const activeRowRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (activeIndex == null) {
      return;
    }
    const target = counselleActive ? counselleRef.current : activeRowRef.current;
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex, counselleActive]);

  return (
    <ul className="min-h-0 flex-1 space-y-1 overflow-auto px-2 py-3">
      {renderDbCard && (
        <CounselleSourceCard innerRef={counselleRef} schools={dbSchools} active={counselleActive} />
      )}
      {externals.map((entry) => {
        const active = entry.index === activeIndex;
        return (
          <SourceRow key={entry.index} entry={entry} active={active} ref={active ? activeRowRef : null} />
        );
      })}
    </ul>
  );
}
