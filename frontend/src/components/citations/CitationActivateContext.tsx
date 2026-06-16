/**
 * CitationActivateContext — carries the "open the sources sidebar at this
 * source" handler down to inline pills nested deep in the rendered markdown
 * tree, so the pill never has to thread a callback through react-markdown.
 *
 * Default is a no-op (e.g. the streaming preview before a panel exists).
 */
import { createContext, useContext } from 'react';
import type { SourceEntry } from '@/api/protocol';

const CitationActivateContext = createContext<(entry: SourceEntry) => void>(() => {});

export function useCitationActivate(): (entry: SourceEntry) => void {
  return useContext(CitationActivateContext);
}

export const CitationActivateProvider = CitationActivateContext.Provider;

export default CitationActivateContext;
