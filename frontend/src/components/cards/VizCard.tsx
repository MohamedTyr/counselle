/**
 * VizCard — the render-spec dispatcher (replaces FE-3's VizPlaceholder).
 *
 * Known types route to the two cards; ANY unknown type degrades to the
 * markdown fallback (PRD story 35, MVP1's degrade rule): title + plain
 * "label: display" lines in a plain bordered card — never crash, never
 * blank, so future card types can never break an older client.
 *
 * In the chat stream (`variant='card'`, the default) each card carries an
 * ExpandToPanelButton that opens it as the right-side artifact panel. Inside
 * that panel it re-renders chromeless (`variant='panel'`, `expandable=false`).
 */
import type { RenderSpec } from '@/api/protocol';
import type { VizVariant } from '@/components/cards/vizVariant';
import VizFrame from '@/components/cards/VizFrame';
import StatBlockCard from '@/components/cards/StatBlockCard';
import ComparisonTableCard from '@/components/cards/ComparisonTableCard';
import ExpandToPanelButton from '@/components/artifact/ExpandToPanelButton';
import DbRevealValue from '@/components/citations/DbRevealValue';

function MarkdownFallbackCard({ spec, variant }: { spec: RenderSpec; variant: VizVariant }) {
  return (
    <VizFrame title={spec.title} variant={variant}>
      <div className="space-y-1">
        {/* A malformed spec may omit `rows` entirely — degrade to an empty-but-
            titled card rather than throw (FE-H5). */}
        {(spec.rows ?? []).map((row, i) => (
          <div key={`${row.label}-${i}`} className="text-sm text-text-primary [overflow-wrap:anywhere]">
            {row.label}:{' '}
            {row.cells[0]?.available ? (
              <DbRevealValue cell={row.cells[0]}>{row.cells[0].display}</DbRevealValue>
            ) : (
              'not available'
            )}
          </div>
        ))}
      </div>
    </VizFrame>
  );
}

function renderCard(spec: RenderSpec, variant: VizVariant) {
  switch (spec.type) {
    case 'stat_block':
      return <StatBlockCard spec={spec} variant={variant} />;
    case 'comparison_table':
      return <ComparisonTableCard spec={spec} variant={variant} />;
    default:
      return <MarkdownFallbackCard spec={spec} variant={variant} />;
  }
}

export default function VizCard({
  spec,
  variant = 'card',
  expandable = true,
}: {
  spec: RenderSpec;
  variant?: VizVariant;
  expandable?: boolean;
}) {
  const card = renderCard(spec, variant);
  if (variant === 'panel' || !expandable) {
    return card;
  }
  return (
    <div className="group/viz relative">
      {card}
      <ExpandToPanelButton spec={spec} />
    </div>
  );
}
