/**
 * DbRevealValue — passive reveal wrapper for DB-backed viz values.
 *
 * Unlike DbClaim, this adds no interaction. Card values already own their
 * citation popovers; this wrapper only applies the same reveal wash when the
 * per-message toggle is on.
 */
import type { ReactNode } from 'react';
import { cn } from '@librechat/client/utils';
import type { CitationEnvelope } from '@/api/protocol';
import { isRevealableDbCell } from '@/components/citations/dbReveal';
import { DB_REVEAL_WASH_CLASS } from '@/components/citations/revealStyles';
import { useRevealState } from '@/components/citations/RevealStateContext';

export default function DbRevealValue({
  cell,
  children,
  className,
  as = 'span',
}: {
  cell: CitationEnvelope | undefined;
  children: ReactNode;
  className?: string;
  as?: 'span' | 'div';
}) {
  const { revealed } = useRevealState();
  const revealable = isRevealableDbCell(cell);
  const active = revealed && revealable;
  const Tag = as;

  return (
    <Tag
      data-db-viz-cell={revealable ? '' : undefined}
      data-revealed={active ? '' : undefined}
      className={cn(
        'transition-[background-color] duration-200 ease-out motion-reduce:transition-none',
        active && DB_REVEAL_WASH_CLASS,
        className,
      )}
    >
      {children}
    </Tag>
  );
}
