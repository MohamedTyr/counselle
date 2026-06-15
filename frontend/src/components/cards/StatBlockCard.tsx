/**
 * StatBlockCard — the dossier stat block (PRD story 28; semantics ported
 * from the retired MVP1 harness's buildStatBlock).
 *
 * One school, one fact sheet. The header is a logo-led identity (SchoolIdentity)
 * so the school is recognised at a glance; the eyebrow lifts the descriptive
 * remainder of the title ("Key facts") without echoing the name.
 *
 * Label/value grid: one VizRow per line, value = cells[0]. Unavailable values
 * render the designed muted NA state (PRD story 29) — never an empty cell,
 * visibly distinct from a zero. Available values stack `display` (tabular
 * figures) over a quiet SourceTag — the same calm citation grammar as the
 * comparison table, tap to see provenance. Long labels and qualitative values
 * wrap (`overflow-wrap:anywhere`) rather than overflow.
 *
 * `variant='panel'` (the artifact sideview) trades the tight chat spacing for a
 * divided, roomier list — the point of opening here is to read a lot of rows
 * comfortably; PanelChrome already draws the identity, so the body is rows only.
 */
import { cn } from '@librechat/client/utils';
import type { CitationEnvelope, RenderSpec } from '@/api/protocol';
import { NotAvailableValue } from '@/components/cards/NotAvailable';
import SchoolIdentity from '@/components/cards/SchoolIdentity';
import VizFrame from '@/components/cards/VizFrame';
import { sectionLabel } from '@/components/cards/vizTitle';
import type { VizVariant } from '@/components/cards/vizVariant';
import CitationPopover from '@/components/citations/CitationPopover';
import SourceTag from '@/components/citations/SourceTag';
import { tierLabel } from '@/components/citations/TierChip';

// Re-exported for back-compat; the canonical home is '@/components/cards/NotAvailable'.
export { NotAvailableValue };

function StatValue({ cell }: { cell: CitationEnvelope | undefined }) {
  if (!cell || !cell.available) {
    return <NotAvailableValue />;
  }
  // Value and source share one line (wrapping only when the value is long
  // qualitative prose) — the dense fact-sheet read, not a stacked column.
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
      <span className="text-sm font-medium tabular-nums text-text-primary [overflow-wrap:anywhere]">
        {cell.display}
      </span>
      <CitationPopover citation={cell.citation}>
        <SourceTag tier={cell.citation.tier}>{tierLabel(cell.citation.source)}</SourceTag>
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
  const school = spec.schools[0];
  const list = (
    <dl className={isPanel ? 'divide-y divide-border-light' : 'space-y-px'}>
      {spec.rows.map((row, i) => (
        <div
          key={`${row.label}-${i}`}
          className={cn(
            'flex items-start justify-between gap-4',
            isPanel ? 'py-2' : 'rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-hover',
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

  // school is always present for a stat_block (one school × fields); guard for
  // the degenerate empty spec so a malformed payload degrades, never crashes.
  const header = school ? (
    <SchoolIdentity school={school} eyebrow={sectionLabel(spec.title, school.name)} />
  ) : undefined;

  return (
    <VizFrame title={spec.title} header={header} variant={variant}>
      {list}
    </VizFrame>
  );
}
