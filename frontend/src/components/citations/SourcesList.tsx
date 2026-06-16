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
}

/** Counts what the panel header shows: one "Counselle data" entry + each page. */
export function displaySourceCount(sources: SourceEntry[]): number {
  const db = sources.filter((s) => isDbSource(s.citation.source));
  const externals = sources.length - db.length;
  return (db.length > 0 ? 1 : 0) + externals;
}

/** Trust order within the external list: a school's/gov's own site, then general
 *  web, then Reddit (the most "just opinions"). */
function externalRank(entry: SourceEntry): number {
  if (entry.citation.source === 'reddit') return 2;
  if (entry.citation.tier === 'community') return 1;
  return 0;
}

export default function SourcesList({ sources, activeIndex, dbSchools }: SourcesListProps) {
  const { dbEntries, externals } = useMemo(() => {
    const db = sources.filter((s) => isDbSource(s.citation.source));
    const ext = sources
      .filter((s) => !isDbSource(s.citation.source))
      .slice()
      .sort((a, b) => externalRank(a) - externalRank(b));
    return { dbEntries: db, externals: ext };
  }, [sources]);

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
      {dbEntries.length > 0 && (
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
