/**
 * StatBlockCard — the dossier stat block (PRD story 28; semantics ported
 * from the retired MVP1 harness's buildStatBlock).
 *
 * Label/value grid: one VizRow per line, value = cells[0]. Unavailable
 * values render the designed muted NA state (PRD story 29) — never an
 * empty cell, visibly distinct from a zero. Available values render
 * `display` in tabular figures with a tier chip opening the citation
 * popover. Long labels and qualitative values wrap (`overflow-wrap:anywhere`)
 * rather than overflow.
 *
 * `variant='panel'` (the artifact sideview) trades the tight chat spacing for a
 * divided, roomier list — the point of opening here is to read a lot of rows
 * comfortably.
 */
import { cn } from '@librechat/client/utils';
import type { CitationEnvelope, RenderSpec } from '@/api/protocol';
import { NotAvailableValue } from '@/components/cards/NotAvailable';
import VizFrame from '@/components/cards/VizFrame';
import type { VizVariant } from '@/components/cards/vizVariant';
import CitationPopover from '@/components/citations/CitationPopover';
import TierChip, { tierLabel } from '@/components/citations/TierChip';

// Re-exported for back-compat; the canonical home is '@/components/cards/NotAvailable'.
export { NotAvailableValue };

function StatValue({ cell }: { cell: CitationEnvelope | undefined }) {
  if (!cell || !cell.available) {
    return <NotAvailableValue />;
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <span className="text-sm font-medium tabular-nums text-text-primary [overflow-wrap:anywhere]">
        {cell.display}
      </span>
      <CitationPopover citation={cell.citation}>
        <TierChip tier={cell.citation.tier}>{tierLabel(cell.citation.source)}</TierChip>
      </CitationPopover>
    </span>
  );
}

export default function StatBlockCard({
  spec,
  variant = 'card',
}: {
  spec: RenderSpec;
  variant?: VizVariant;
}) {
  const isPanel = variant === 'panel';
  const list = (
    <dl className={isPanel ? 'divide-y divide-border-light' : 'space-y-0.5'}>
      {spec.rows.map((row, i) => (
        <div
          key={`${row.label}-${i}`}
          className={cn(
            'flex items-baseline justify-between gap-4',
            isPanel ? 'py-2.5' : 'rounded-md px-1.5 py-1.5 hover:bg-surface-hover',
          )}
        >
          <dt className="text-sm text-text-secondary [overflow-wrap:anywhere]">{row.label}</dt>
          <dd className="min-w-0 text-right">
            <StatValue cell={row.cells[0]} />
          </dd>
        </div>
      ))}
    </dl>
  );

  return (
    <VizFrame title={spec.title} schools={spec.schools} variant={variant}>
      {list}
    </VizFrame>
  );
}
