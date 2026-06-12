/**
 * TierChip — the inline source-tier marker (PRD story 26).
 *
 * The official/community visual grammar: official tiers (cds / ipeds /
 * scorecard / web / edu / anything unknown) read cool via the --official-*
 * tokens; 'reddit' reads warm via --community-*. Squint test: tier is
 * instantly visible. Used identically in prose chips, cards, and the
 * sources footer (counselle.css contract).
 */
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@librechat/client/utils';
import type { Tier } from '@/api/protocol';

export function isCommunityTier(tier: Tier): boolean {
  return tier === 'reddit';
}

const TIER_LABELS: Record<string, string> = {
  cds: 'CDS',
  ipeds: 'IPEDS',
  scorecard: 'Scorecard',
  web: 'web',
  edu: '.edu',
  reddit: 'Reddit',
};

/** Short human label for a tier; unknown tiers show the tier string itself. */
export function tierLabel(tier: Tier): string {
  return TIER_LABELS[tier] ?? tier;
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
