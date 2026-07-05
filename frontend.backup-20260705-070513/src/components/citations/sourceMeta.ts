/**
 * sourceMeta — per-source visual identity for the sources strip + panel.
 *
 * The tier (cool official / warm community) carries the squint-test grammar;
 * the per-source glyph adds a hint of WHICH authority without spelling the name
 * out, so a stack of badges reads as "a landmark, a diploma, a forum" at a
 * glance. Tier still owns colour — these icons never introduce their own.
 */
import type { ComponentType, SVGProps } from 'react';
import { BookText, Globe, GraduationCap, Landmark, MessageCircle } from 'lucide-react';
import type { SourceName } from '@/api/protocol';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const SOURCE_ICONS: Record<SourceName, IconType> = {
  cds: BookText, // the Common Data Set — a published reference document
  ipeds: Landmark, // federal authority
  scorecard: Landmark, // federal authority
  edu: GraduationCap, // a university's own website
  web: Globe, // the open web
  reddit: MessageCircle, // a community forum
};

/** The lucide glyph for a citation's source; unknown sources fall back to a globe. */
export function sourceIcon(source: SourceName | string): IconType {
  return SOURCE_ICONS[source as SourceName] ?? Globe;
}
