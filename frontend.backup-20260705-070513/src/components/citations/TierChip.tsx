/**
 * TierChip utils — the source-tier label/word/name helpers (PRD story 26).
 *
 * The official/community grammar: tier 'official' reads as an official source;
 * 'community' (Reddit) reads as community voice. These helpers are shared by the
 * citation popover, source tags, and the stat/comparison cards. (The filled-pill
 * JSX component was retired in feat/message-ui-polish in favour of the calmer
 * SourceTag + the inline-citation surfaces.)
 */
import type { SourceName, Tier } from '@/api/protocol';

// B2 / wire-contract C1 (the honesty fix): the backend serves
// tier: 'official' | 'community' — the old `tier === 'reddit'` check would
// have rendered every community source as official against the real wire.
export function isCommunityTier(tier: Tier): boolean {
  return tier === 'community';
}

const SOURCE_LABELS: Record<SourceName, string> = {
  cds: 'CDS',
  ipeds: 'IPEDS',
  scorecard: 'Scorecard',
  web: 'web',
  edu: '.edu',
  reddit: 'Reddit',
};

/** Short human label for a citation's SOURCE (C1: labels key on
 *  `citation.source`, not the two-value tier); unknown sources show as-is. */
export function tierLabel(source: SourceName | string): string {
  return SOURCE_LABELS[source as SourceName] ?? source;
}

// Fuller, human-readable source names for the citation popover header — the one
// place provenance is spelled out in full (honesty: name the authority, never a
// raw enum). Falls back to the short label for unknown sources.
const SOURCE_DISPLAY_NAMES: Record<SourceName, string> = {
  cds: 'Common Data Set',
  ipeds: 'IPEDS',
  scorecard: 'College Scorecard',
  web: 'Web',
  edu: 'University website',
  reddit: 'Reddit',
};

/** The expanded source name for the citation popover (e.g. cds → "Common Data
 *  Set"); unknown sources fall back to the short label. */
export function sourceDisplayName(source: SourceName | string): string {
  return SOURCE_DISPLAY_NAMES[source as SourceName] ?? tierLabel(source);
}

/** The provenance-grammar word for a tier (the squint test, spelled out). */
export function tierWord(tier: Tier): string {
  return isCommunityTier(tier) ? 'Community voice' : 'Official source';
}
