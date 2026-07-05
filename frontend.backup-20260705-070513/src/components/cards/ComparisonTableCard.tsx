/**
 * ComparisonTableCard — the school comparison table (PRD stories 30–32).
 *
 * Editorial data table: schools are the anchoring columns, the dimension is a
 * sticky first column. Each value is the hero with its provenance stacked
 * quietly beneath it (a tier-dotted SourceTag, tap to cite — hover doesn't
 * exist on phones). NA cells render the designed muted state, visibly distinct
 * from zero. ABSOLUTELY NO winner-highlighting (PRD story 31 — honesty as
 * restraint): every value cell gets the identical treatment regardless of
 * magnitude.
 *
 * Layout is `table-fixed` + a `<colgroup>` so columns share width predictably
 * and long content WRAPS (`overflow-wrap:anywhere`) instead of blowing a column
 * out. The two variants make a deliberate trade:
 *   - inline (`card`): a horizontal-scroll escape hatch with a dynamic min-width
 *     so many schools stay legible; the metric column pins while you scroll.
 *   - sideview (`panel`): no min-width, so dense data wraps to fit the panel
 *     without a horizontal scrollbar; the header row and metric column both
 *     stick so you never lose context down a long list of rows.
 */
import { cn } from '@librechat/client/utils';
import type { CitationEnvelope, RenderSpec } from '@/api/protocol';
import { NotAvailableValue } from '@/components/cards/NotAvailable';
import SchoolHeader from '@/components/cards/SchoolHeader';
import VizFrame from '@/components/cards/VizFrame';
import type { VizVariant } from '@/components/cards/vizVariant';
import CitationPopover from '@/components/citations/CitationPopover';
import DbRevealValue from '@/components/citations/DbRevealValue';
import SourceTag from '@/components/citations/SourceTag';
import { tierLabel } from '@/components/citations/TierChip';

// Comfortable per-column minimums (px), applied ONLY inline where the card can
// scroll horizontally past them. The panel prefers wrapping (no min-width).
const METRIC_COL_MIN = 148;
const SCHOOL_COL_MIN = 128;

// Every value cell is structurally identical (PRD story 31): same padding, same
// text class, no per-magnitude styling. `overflow-wrap:anywhere` lets long
// qualitative values ("Mostly positive") wrap rather than force a wide column.
const VALUE_CELL_CLASS = 'px-4 py-3 align-top';
const VALUE_TEXT_CLASS =
  'text-sm font-medium tabular-nums text-text-primary [overflow-wrap:anywhere]';

/** Metric column share of the table; the schools split the remainder evenly. */
function metricColumnWidth(schoolCount: number): string {
  if (schoolCount <= 2) return '36%';
  if (schoolCount === 3) return '28%';
  return '22%';
}

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
      <div className="flex flex-col items-start gap-1.5">
        <DbRevealValue cell={cell} className="inline-block">
          <span className={VALUE_TEXT_CLASS}>{cell.display}</span>
        </DbRevealValue>
        <CitationPopover citation={cell.citation}>
          <SourceTag tier={cell.citation.tier}>{tierLabel(cell.citation.source)}</SourceTag>
        </CitationPopover>
      </div>
    </td>
  );
}

export default function ComparisonTableCard({
  spec,
  variant = 'card',
}: {
  spec: RenderSpec;
  variant?: VizVariant;
}) {
  const isPanel = variant === 'panel';
  const schoolCount = spec.schools.length;

  const metricThClass = cn(
    'border-r border-border-light bg-surface-primary-alt px-4 py-2.5',
    'text-[10.5px] font-medium uppercase tracking-wider text-text-secondary',
    isPanel ? 'sticky left-0 top-0 z-30' : 'sticky left-0 z-10',
  );
  const schoolThClass = cn(
    'px-4 py-2.5 align-middle',
    isPanel && 'sticky top-0 z-20 bg-surface-primary-alt',
  );
  const rowHeaderClass = cn(
    'sticky left-0 z-10 border-r border-border-light bg-surface-primary-alt px-4 py-3 align-top',
    'text-sm font-normal text-text-primary [overflow-wrap:anywhere]',
    'transition-colors group-hover:bg-surface-hover',
  );

  // Inline only: keep many-school tables legible by letting them scroll.
  const tableMinWidth = isPanel ? undefined : METRIC_COL_MIN + schoolCount * SCHOOL_COL_MIN;

  const table = (
    <table
      aria-label={spec.title}
      className="w-full table-fixed border-collapse text-left"
      style={tableMinWidth ? { minWidth: `${tableMinWidth}px` } : undefined}
    >
      <colgroup>
        <col style={{ width: metricColumnWidth(schoolCount) }} />
        {/* Key on `${unitid}-${idx}` so a malformed spec with a repeated school
            can't produce a duplicate React key (FE-L4). */}
        {spec.schools.map((school, idx) => (
          <col key={`${school.unitid}-${idx}`} />
        ))}
      </colgroup>
      <thead>
        <tr className="border-y border-border-light">
          <th scope="col" className={metricThClass}>
            Metric
          </th>
          {spec.schools.map((school, idx) => (
            <th key={`${school.unitid}-${idx}`} scope="col" className={schoolThClass}>
              <SchoolHeader school={school} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {/* `rows` is guarded (`?? []`) so a malformed spec degrades instead of
            throwing (FE-H5). The `-${i}` row key is safe: viz specs are emitted
            whole, so rows never stream in or reorder mid-render (FE-L5). */}
        {(spec.rows ?? []).map((row, i) => (
          <tr
            key={`${row.label}-${i}`}
            className="group border-b border-border-light transition-colors last:border-b-0 hover:bg-surface-hover"
          >
            <th scope="row" className={rowHeaderClass}>
              {row.label}
            </th>
            {spec.schools.map((school, col) => (
              <ComparisonCell key={`${school.unitid}-${col}`} cell={row.cells[col]} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <VizFrame title={spec.title} variant={variant} flush>
      {isPanel ? table : <div className="overflow-x-auto">{table}</div>}
    </VizFrame>
  );
}
