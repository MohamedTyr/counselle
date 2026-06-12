/**
 * FE-4 — step-kind → icon and tier → color maps for the activity timeline
 * (PRD story 13). Tier color uses ONLY the two Counselle semantic pairs;
 * everything else is LibreChat tokens (ADR 0020, decision 5).
 */
import {
  BarChart3,
  Database,
  FlaskConical,
  Globe,
  GraduationCap,
  MessageSquare,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { StepKind, StepTier } from '@/api/protocol';

export const KIND_ICONS: Record<StepKind, LucideIcon> = {
  db_tool: Database,
  sql: Database,
  web_search: Globe,
  edu_search: GraduationCap,
  reddit_search: MessageSquare,
  viz: BarChart3,
  skill: Wrench,
  research: FlaskConical,
};

export function iconFor(kind: StepKind): LucideIcon {
  return KIND_ICONS[kind] ?? Wrench;
}

export function tierTextClass(tier: StepTier): string {
  if (tier === 'official') {
    return 'text-[var(--official-text)]';
  }
  if (tier === 'community') {
    return 'text-[var(--community-text)]';
  }
  return 'text-text-secondary';
}

/** "1240" → "1.2s" — the receipt-grid rendering of duration_ms. */
export function formatDurationMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
