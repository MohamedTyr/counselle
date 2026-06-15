/**
 * SourceTag — the quiet, in-cell citation trigger (PRD story 26/27).
 *
 * A calmer sibling to TierChip: instead of a filled pill, it pairs a small
 * tier-colored dot (the squint signal — official reads cool, community warm)
 * with a muted source label that warms to the tier colour on hover/focus.
 * Built for dense surfaces (the comparison table, stat blocks) where a wall
 * of filled chips would shout louder than the data itself.
 *
 * Contract: the source label is the button's own text node so the element
 * carrying `data-tier` is the one matched by the honesty tests; the dot is
 * decorative (aria-hidden). Wrap in <CitationPopover> exactly like TierChip.
 */
import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@librechat/client/utils';
import type { Tier } from '@/api/protocol';
import { isCommunityTier } from '@/components/citations/TierChip';

interface SourceTagProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tier: Tier;
  children?: ReactNode;
}

const SourceTag = forwardRef<HTMLButtonElement, SourceTagProps>(function SourceTag(
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
        'group/src -mx-1 inline-flex min-h-[24px] items-center gap-1.5 rounded px-1 py-0.5 align-middle',
        'text-[10.5px] font-medium leading-none tracking-wide text-text-secondary',
        'transition-colors hover:bg-surface-hover',
        'hover:text-text-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          community ? 'bg-[var(--community-text)]' : 'bg-[var(--official-text)]',
        )}
      />
      {children}
    </button>
  );
});

export default SourceTag;
