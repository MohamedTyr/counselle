/**
 * FE-3 placeholder for in-stream `viz` blocks — a labeled card at the spec's
 * exact in-stream position. FE-4 replaces this with the real stat-block /
 * comparison-table renderers (architecture.md §29).
 */
import type { RenderSpec } from '@/api/protocol';

const TYPE_LABELS: Record<string, string> = {
  stat_block: 'Stat block',
  comparison_table: 'Comparison table',
};

export default function VizPlaceholder({ spec }: { spec: RenderSpec }) {
  const label = TYPE_LABELS[spec.type] ?? spec.type;
  return (
    <div className="not-prose my-3 w-full rounded-xl border border-border-light bg-surface-primary-alt p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-text-primary">{spec.title}</div>
      <div className="mt-1 text-xs text-text-secondary">
        {spec.schools.map((s) => s.name).join(' · ')}
        {spec.rows.length > 0 && ` — ${spec.rows.length} ${spec.rows.length === 1 ? 'row' : 'rows'}`}
      </div>
    </div>
  );
}
