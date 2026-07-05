/**
 * dejargon — the one switch for "show students friendly source names, not
 * dataset jargon".
 *
 * A figure's true provenance (Common Data Set 2025-26 Section C9, IPEDS table
 * adm2024, …) is real and we keep it honest internally — but a student doesn't
 * care which federal table a number lives in. With dejargon ON, every structured
 * source reads as "Counselle data" and the raw table/vintage internals are
 * hidden; external pages get their friendly publisher/host name.
 *
 * Default OFF so existing surfaces are untouched until they opt in by wrapping
 * their subtree in <DejargonProvider value={true}>.
 */
import { createContext, useContext } from 'react';
import type { Citation } from '@/api/protocol';
import { friendlySourceName, isDbSource } from '@/components/citations/sourceName';
import { sourceDisplayName } from '@/components/citations/TierChip';

const DejargonContext = createContext<boolean>(false);

export const DejargonProvider = DejargonContext.Provider;

export function useDejargon(): boolean {
  return useContext(DejargonContext);
}

/** The short, in-cell label for a citation's source under the dejargon rule. */
export function sourceTagLabel(citation: Citation, dejargon: boolean): string {
  if (dejargon && isDbSource(citation.source)) {
    return 'Counselle';
  }
  if (dejargon) {
    return friendlySourceName(citation);
  }
  // Off: the legacy short label ("CDS", "IPEDS", "Reddit") — handled by callers.
  return '';
}

/** The full, human source name for a citation's provenance popover. */
export function sourceFullName(citation: Citation, dejargon: boolean): string {
  if (dejargon && isDbSource(citation.source)) {
    return 'Counselle data';
  }
  if (dejargon) {
    return friendlySourceName(citation);
  }
  return sourceDisplayName(citation.source);
}
