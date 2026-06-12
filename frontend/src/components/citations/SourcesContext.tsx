/**
 * SourcesContext — carries the turn's SourceEntry[] down to inline
 * CitationRef chips. Default [] so chips render bare (no popover) before
 * the `sources` event streams in — that's what makes chips "materialize
 * as the text streams" (PRD story 19).
 */
import { createContext, useContext } from 'react';
import type { SourceEntry } from '@/api/protocol';

const SourcesContext = createContext<SourceEntry[]>([]);

export function useSources(): SourceEntry[] {
  return useContext(SourcesContext);
}

export const SourcesProvider = SourcesContext.Provider;

export default SourcesContext;
