/**
 * TierChip — the inline source-tier marker (PRD story 26).
 *
 * The official/community visual grammar: tier 'official' reads cool via the
 * --official-* tokens; 'community' (Reddit) reads warm via --community-*.
 * Squint test: tier is instantly visible. Used identically in prose chips,
 * cards, and the sources footer (counselle.css contract).
 */
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@librechat/client/utils';
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

interface TierChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tier: Tier;
  children?: ReactNode;
}

const TierChip = forwardRef<HTMLButtonElement, TierChipProps>(function TierChip(
  { tier, children, className, ...rest },
  ref,
) {
  const community = isCommunityTier(tier);
  return (
    <button
      ref={ref}
      type="button"
      data-tier={community ? 'community' : 'official'}
      className={cn(
        'inline-flex items-center rounded-full border px-1.5 py-0.5 align-middle',
        'text-[10px] font-medium leading-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-50',
        community
          ? 'border-[var(--community-border)] bg-[var(--community-surface)] text-[var(--community-text)]'
          : 'border-[var(--official-border)] bg-[var(--official-surface)] text-[var(--official-text)]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export default TierChip;
