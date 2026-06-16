/**
 * SourceFavicon — the real site logo for a source (Reddit's logo, a school's
 * favicon, the federal-data sites' marks). Falls back to a neutral tile with
 * the source glyph when there's no resolvable domain (e.g. the Common Data Set,
 * which is a standard, not a website) or the favicon fails to load.
 */
import { useState } from 'react';
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

export default function SourceFavicon({
  citation,
  sizeClass = 'h-8 w-8',
  className,
}: SourceFaviconProps) {
  const [failed, setFailed] = useState(false);
  const domain = citationDomain(citation);
  const Icon = sourceIcon(citation.source);

  if (!domain || failed) {
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

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(
        'shrink-0 rounded-full border border-border-light bg-white object-contain p-0.5',
        sizeClass,
        className,
      )}
    />
  );
}
