/**
 * MessageSources — the collapsed sources affordance for a completed assistant
 * turn. Renders the minimal SourcesStrip inline in the message action row (next
 * to copy / feedback / regenerate) and opens the cited sources into the shared
 * right-side rail — the same panel slot artifacts use (state.ts), so the app
 * has exactly one right panel at a time.
 *
 * Shows only the sources THIS message cited (wire-contract §5, PINNED) — the
 * same `[n]` grammar the inline chips use, single-sourced via
 * `citedIndexesForMessage`.
 */
import { useMemo } from 'react';
import { useSetAtom } from 'jotai';
import type { ChatMessage } from '@/app/ChatContext';
import { openSourcesPanelAtom } from '@/app/state';
import { citedIndexesForMessage } from '@/components/citations/remarkCitations';
import { dbSchoolsForMessage } from '@/components/citations/dbSchools';
import { isDbSource } from '@/components/citations/sourceName';
import { displaySourceCount } from '@/components/citations/SourcesList';
import SourcesStrip from '@/components/citations/SourcesStrip';

export default function MessageSources({ message }: { message: ChatMessage }) {
  const openSources = useSetAtom(openSourcesPanelAtom);
  const sources = message.sources ?? [];

  // Filter to the cited subset once; the strip and the panel both render it, so
  // they can never disagree about which sources the answer used.
  const cited = useMemo(() => {
    if (sources.length === 0) {
      return [];
    }
    const indexes = citedIndexesForMessage(message.content, message.text);
    return sources.filter((s) => indexes.has(s.index));
  }, [sources, message.content, message.text]);

  // The strip's favicon stack shows EXTERNAL sources only — the Counselle data
  // card lives in the panel, not in the favicon row.
  const externals = useMemo(() => cited.filter((s) => !isDbSource(s.citation.source)), [cited]);

  // School names for the panel's Counselle-data card subline.
  const dbSchools = useMemo(() => dbSchoolsForMessage(message), [message]);

  // Only show sources once the turn has settled. The backend emits ev_sources
  // before ev_done, so without this guard the strip would flash in while the
  // prose is still streaming — the old SourcesFooter required completion too.
  if (message.turnStatus !== 'complete' && message.turnStatus !== 'cancelled') {
    return null;
  }

  if (cited.length === 0) {
    return null;
  }

  return (
    <SourcesStrip
      sources={externals}
      displayCount={displaySourceCount(cited)}
      onOpen={() => openSources({ sources: cited, activeIndex: null, dbSchools })}
    />
  );
}
