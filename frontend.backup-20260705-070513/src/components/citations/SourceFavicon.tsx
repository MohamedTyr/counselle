/**
 * SourceFavicon — the source mark for a citation (Reddit, a school, the federal
 * data sites, the Common Data Set). Renders a neutral tile carrying the
 * source-tier glyph; the tier owns colour, the glyph hints at WHICH authority.
 */
import { cn } from '@librechat/client/utils';
import type { Citation } from '@/api/protocol';
import { isSafeUrl } from '@/api/url';
import { sourceIcon } from '@/components/citations/sourceMeta';

// The two federal authorities have canonical sites, so they get real marks even
// though their citations carry no URL. The CDS has no single home and falls back.
const KNOWN_DOMAINS: Partial<Record<string, string>> = {
  scorecard: 'collegescorecard.ed.gov',
  ipeds: 'nces.ed.gov',
};

/** The favicon host for a citation, or null when none can be resolved. */
export function citationDomain(citation: Citation): string | null {
  if (isSafeUrl(citation.url)) {
    try {
      return new URL(citation.url as string).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }
  return KNOWN_DOMAINS[citation.source] ?? null;
}

type SourceFaviconProps = {
  citation: Citation;
  /** Tailwind size box (e.g. 'h-8 w-8'). */
  sizeClass?: string;
  className?: string;
};

// The source-tier glyph is the source mark. We deliberately do NOT fetch a
// remote favicon from a third party (the old Google favicon endpoint): doing so
// would ship the host of every source a student reads to that third party — a
// privacy leak this product's trust posture forbids (FE-H1). If a first-party
// favicon channel ever lands (a backend proxy / bytes in the source envelope,
// Phase 6/CFG-04), wire it here; until then the glyph is the honest, zero-leak
// default.
export default function SourceFavicon({
  citation,
  sizeClass = 'h-8 w-8',
  className,
}: SourceFaviconProps) {
  const Icon = sourceIcon(citation.source);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-border-light bg-surface-primary-alt text-text-tertiary',
        sizeClass,
        className,
      )}
    >
      <Icon className="h-[55%] w-[55%]" />
    </span>
  );
}
