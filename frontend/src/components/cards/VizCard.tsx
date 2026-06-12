/**
 * VizCard — the render-spec dispatcher (replaces FE-3's VizPlaceholder).
 *
 * Known types route to the three cards; ANY unknown type degrades to the
 * markdown fallback (PRD story 35, MVP1's degrade rule): title + plain
 * "label: display" lines in a plain bordered card — never crash, never
 * blank, so future card types can never break an older client.
 */
import type { RenderSpec } from '@/api/protocol';
import StatBlockCard from '@/components/cards/StatBlockCard';
import ComparisonTableCard from '@/components/cards/ComparisonTableCard';
import ScoreBandCard from '@/components/cards/ScoreBandCard';

function MarkdownFallbackCard({ spec }: { spec: RenderSpec }) {
  return (
    <div className="not-prose my-3 w-full rounded-xl border border-border-light bg-surface-primary-alt p-4">
      <div className="text-sm font-semibold text-text-primary">{spec.title}</div>
      <div className="mt-2 space-y-1">
        {spec.rows.map((row, i) => (
          <div key={`${row.label}-${i}`} className="text-sm text-text-primary">
            {row.label}: {row.cells[0]?.available ? row.cells[0].display : 'not available'}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VizCard({ spec }: { spec: RenderSpec }) {
  switch (spec.type) {
    case 'stat_block':
      return <StatBlockCard spec={spec} />;
    case 'comparison_table':
      return <ComparisonTableCard spec={spec} />;
    case 'score_band':
      return <ScoreBandCard spec={spec} />;
    default:
      return <MarkdownFallbackCard spec={spec} />;
  }
}
