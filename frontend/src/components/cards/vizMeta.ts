/**
 * vizMeta — the single source of truth for per-viz-type presentation metadata
 * (eyebrow label + a header icon).
 *
 * Keyed by `RenderSpec['type']` so adding a new card type is one entry here, not
 * a hardcoded label/icon edited across components. The `viz*` helpers degrade any
 * unknown type (a future server may emit one) to generic values, mirroring
 * VizCard's markdown-fallback degrade rule — an older client never shows a blank
 * eyebrow or a missing icon.
 */
import { BarChart3, Columns3, Rows3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RenderSpec } from '@/api/protocol';

export type VizType = RenderSpec['type'];

type VizMeta = {
  /** Short eyebrow label shown above the title in the artifact panel. */
  label: string;
  /** Quiet header glyph that gives the panel a per-type identity. */
  icon: LucideIcon;
};

const VIZ_META: Record<VizType, VizMeta> = {
  // Icons mirror each card's structure: rows of stats, school columns.
  stat_block: { label: 'Stat block', icon: Rows3 },
  comparison_table: { label: 'Comparison', icon: Columns3 },
};

const UNKNOWN: VizMeta = { label: 'Visualization', icon: BarChart3 };

function metaFor(type: string): VizMeta {
  return (VIZ_META as Record<string, VizMeta>)[type] ?? UNKNOWN;
}

export function vizLabel(type: string): string {
  return metaFor(type).label;
}

export function vizIcon(type: string): LucideIcon {
  return metaFor(type).icon;
}
