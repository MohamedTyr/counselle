/**
 * SourceFavicon — the source mark for a citation (Reddit, a school, the federal
 * data sites, the Common Data Set). Renders the site's real favicon through our
 * own same-origin proxy (``/v1/favicon`` — see ``domain/urls.py``), falling back
 * to a neutral tile carrying the source-tier glyph when no host is resolvable
 * or the image fails to load; the tier owns colour, the glyph hints at WHICH
 * authority.
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

/** Our own same-origin favicon proxy (``api/routes/favicon.py``) — the browser
 *  never talks to a third-party CDN directly, so this carries none of FE-H1's
 *  original leak (which host of every source a student reads) and isn't
 *  blockable the way a known third-party tracker domain is. */
function faviconSrc(host: string, size = 64): string {
  return `/v1/favicon?host=${encodeURIComponent(host)}&sz=${size}`;
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
  const Icon = sourceIcon(citation.source);
  const host = citationDomain(citation);
  const [broken, setBroken] = useState(false);
  const showFavicon = host != null && !broken;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-light bg-surface-primary-alt text-text-tertiary',
        sizeClass,
        className,
      )}
    >
      {showFavicon ? (
        <img
          src={faviconSrc(host)}
          alt=""
          loading="lazy"
          // A deliberate inset (not h-full/object-cover): many real favicons
          // (MIT's, notably) fill their square edge-to-edge with no padding
          // of their own, so an edge-to-edge render bleeds into the badge's
          // ring — and when several overlap in SourcesStrip's stacked
          // avatars, identical edge-to-edge marks visually chain into what
          // reads as one smeared shape instead of distinct circular badges.
          // object-contain (not -cover) also avoids cropping non-square
          // marks the proxy might ever return.
          className="h-[78%] w-[78%] object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        <Icon className="h-[55%] w-[55%]" />
      )}
    </span>
  );
}
