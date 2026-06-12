/**
 * ComparisonTableCard — the school comparison table (PRD stories 30–32).
 *
 * Real table: sticky first column (the dimension), schools as columns,
 * horizontal scroll past two schools. Per-cell citations open on tap
 * (popover — hover doesn't exist on phones). NA cells render the designed
 * muted state, visibly distinct from zero. ABSOLUTELY NO winner-highlighting
 * (PRD story 31 — honesty as restraint): every value cell gets the
 * identical treatment regardless of magnitude.
 */
import type { CitationEnvelope, RenderSpec } from '@/api/protocol';
import CitationPopover from '@/components/citations/CitationPopover';
import TierChip, { tierLabel } from '@/components/citations/TierChip';
import { NotAvailableValue } from '@/components/cards/StatBlockCard';

const VALUE_CELL_CLASS = 'px-3 py-2 text-sm text-text-primary';

function ComparisonCell({ cell }: { cell: CitationEnvelope | undefined }) {
  if (!cell || !cell.available) {
    return (
      <td className={VALUE_CELL_CLASS}>
        <NotAvailableValue />
      </td>
    );
  }
  return (
    <td className={VALUE_CELL_CLASS}>
      <span className="inline-flex items-center gap-1.5">
        <span className="tabular-nums">{cell.display}</span>
        <CitationPopover citation={cell.citation}>
          <TierChip tier={cell.citation.tier}>{tierLabel(cell.citation.tier)}</TierChip>
        </CitationPopover>
      </span>
    </td>
  );
}

export default function ComparisonTableCard({ spec }: { spec: RenderSpec }) {
  return (
    <div className="not-prose my-3 w-full rounded-xl border border-border-light bg-surface-primary-alt p-4">
      <div className="text-sm font-semibold text-text-primary">{spec.title}</div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border-light">
              <th className="sticky left-0 z-10 bg-surface-primary-alt px-3 py-2 text-xs font-medium text-text-secondary" />
              {spec.schools.map((school) => (
                <th
                  key={school.unitid}
                  className="whitespace-nowrap px-3 py-2 text-xs font-semibold text-text-primary"
                >
                  {school.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, i) => (
              <tr key={`${row.label}-${i}`} className="border-b border-border-light last:border-b-0">
                <th
                  scope="row"
                  className="sticky left-0 z-10 whitespace-nowrap bg-surface-primary-alt px-3 py-2 text-sm font-normal text-text-secondary"
                >
                  {row.label}
                </th>
                {spec.schools.map((school, col) => (
                  <ComparisonCell key={school.unitid} cell={row.cells[col]} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
