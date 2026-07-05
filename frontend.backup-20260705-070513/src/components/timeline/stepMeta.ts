/**
 * FE-4 — step-kind → icon map + duration formatting for the activity timeline
 * (PRD story 13). The rail is monochrome: step icons take their colour from
 * status (active vs done) in ReasoningTrace, not from source tier — hue is
 * reserved for meaning (tier shows in the chip previews + the answer's
 * citations, the red error mark), never decoration (ADR 0020, decision 5).
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
import type { StepKind } from '@/api/protocol';

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

/** "1240" → "1.2s"; "92000" → "1m 32s" — the timeline's duration rendering.
 *  Live turns (clarify-parked especially) can run for minutes, so seconds-only
 *  ("600.0s") would be wrong above a minute. */
export function formatDurationMs(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  // Round to whole seconds FIRST, then split — rounding the remainder alone can
  // carry to 60 (e.g. 599_950ms → "9m 60s").
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rem = whole % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}
