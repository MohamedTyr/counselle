/**
 * StatBlockCard — the dossier stat block (PRD story 28; semantics from
 * harness/viz.js buildStatBlock).
 *
 * Label/value grid: one VizRow per line, value = cells[0]. Unavailable
 * values render the designed muted NA state (PRD story 29) — never an
 * empty cell, visibly distinct from a zero. Available values render
 * `display` in tabular figures with a tier chip opening the citation
 * popover.
 */
import type { CitationEnvelope, RenderSpec } from '@/api/protocol';
import CitationPopover from '@/components/citations/CitationPopover';
import TierChip, { tierLabel } from '@/components/citations/TierChip';

/**
 * The designed "not available" state (PRD story 29): muted, italic, dashed
 * underline — shared by the stat block and the comparison table so NA reads
 * identically everywhere.
 */
export function NotAvailableValue() {
  return (
    <span className="text-sm italic text-text-secondary underline decoration-dashed underline-offset-4">
      not available
    </span>
  );
}

function StatValue({ cell }: { cell: CitationEnvelope | undefined }) {
  if (!cell || !cell.available) {
    return <NotAvailableValue />;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm font-medium tabular-nums text-text-primary">{cell.display}</span>
      <CitationPopover citation={cell.citation}>
        <TierChip tier={cell.citation.tier}>{tierLabel(cell.citation.tier)}</TierChip>
      </CitationPopover>
    </span>
  );
}

export default function StatBlockCard({ spec }: { spec: RenderSpec }) {
  return (
    <div className="not-prose my-3 w-full rounded-xl border border-border-light bg-surface-primary-alt p-4">
      <div className="text-sm font-semibold text-text-primary">{spec.title}</div>
      {spec.schools.length > 0 && (
        <div className="mt-0.5 text-xs text-text-secondary">
          {spec.schools.map((s) => s.name).join(' · ')}
        </div>
      )}
      <dl className="mt-3 space-y-0.5">
        {spec.rows.map((row, i) => (
          <div
            key={`${row.label}-${i}`}
            className="flex items-baseline justify-between gap-4 rounded-md px-1.5 py-1.5 hover:bg-surface-hover"
          >
            <dt className="text-sm text-text-secondary">{row.label}</dt>
            <dd className="text-right">
              <StatValue cell={row.cells[0]} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
