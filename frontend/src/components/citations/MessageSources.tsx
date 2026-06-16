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
import {
  citedSourcesForMessage,
  dbSourcesForMessage,
  usedDbData,
} from '@/components/citations/remarkCitations';
import { dbSchoolsForMessage } from '@/components/citations/dbSchools';
import { isDbSource } from '@/components/citations/sourceName';
import SourcesStrip from '@/components/citations/SourcesStrip';

export default function MessageSources({ message }: { message: ChatMessage }) {
  const openSources = useSetAtom(openSourcesPanelAtom);

  // External sources: cited iff their `[n]` is in prose (correct grammar). The
  // strip's favicon stack shows EXTERNAL sources only — the Counselle data card
  // lives in the panel, not in the favicon row.
  const externalCited = useMemo(
    () => citedSourcesForMessage(message).filter((s) => !isDbSource(s.citation.source)),
    [message],
  );
  // Counselle data: authoritative signal (viz card OR DB source entry), NOT the
  // prose `[n]` scan — DB facts carry no inline marker.
  const dbUsed = useMemo(() => usedDbData(message), [message]);
  const dbEntries = useMemo(() => dbSourcesForMessage(message), [message]);
  // School names for the panel's Counselle-data card subline.
  const dbSchools = useMemo(() => dbSchoolsForMessage(message), [message]);

  // The panel renders DB entries (if any) + external rows; the card shows
  // whenever dbUsed, even with zero DB SourceEntry rows. Single-sourced so the
  // strip count, panel header, card, and dbSchools cannot disagree (FE-H4).
  const panelSources = useMemo(() => [...dbEntries, ...externalCited], [dbEntries, externalCited]);
  const displayCount = (dbUsed ? 1 : 0) + externalCited.length;

  // Only show sources once the turn has settled. The backend emits ev_sources
  // before ev_done, so without this guard the strip would flash in while the
  // prose is still streaming — the old SourcesFooter required completion too.
  if (message.turnStatus !== 'complete' && message.turnStatus !== 'cancelled') {
    return null;
  }

  if (!dbUsed && externalCited.length === 0) {
    return null;
  }

  return (
    <SourcesStrip
      sources={externalCited}
      displayCount={displayCount}
      onOpen={() => openSources({ sources: panelSources, activeIndex: null, dbSchools, dbUsed })}
    />
  );
}
