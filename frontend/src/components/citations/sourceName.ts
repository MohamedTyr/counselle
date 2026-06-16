/**
 * sourceName — jargon-free naming for sources.
 *
 * Two audiences, one rule: never show a student a raw enum or an internal
 * dataset name. Our own structured data (CDS / IPEDS / Scorecard) is ALL just
 * "Counselle data" — the student never learns which federal table a number came
 * from. External pages get a friendly, human name: a subreddit handle, a known
 * publisher's brand, or the bare host — never "web" / "edu".
 */
import type { Citation, SourceName } from '@/api/protocol';
import { isSafeUrl } from '@/api/url';

/** Our own structured datasets — collapsed to a single "Counselle data" source. */
const DB_SOURCES: ReadonlySet<string> = new Set(['cds', 'ipeds', 'scorecard']);

/** True for a figure that comes from our own verified database. */
export function isDbSource(source: SourceName | string): boolean {
  return DB_SOURCES.has(source);
}

/** Known publishers, so a host reads like a name instead of a URL. */
const BRANDS: Partial<Record<string, string>> = {
  'usnews.com': 'US News',
  'nytimes.com': 'The New York Times',
  'washingtonpost.com': 'The Washington Post',
  'wsj.com': 'The Wall Street Journal',
  'forbes.com': 'Forbes',
  'theatlantic.com': 'The Atlantic',
  'niche.com': 'Niche',
  'collegeconfidential.com': 'College Confidential',
  'princetonreview.com': 'The Princeton Review',
  'collegeboard.org': 'College Board',
};

/** The registrable host (no `www`, no path), or null when there's no URL. */
export function hostOf(citation: Citation): string | null {
  if (!isSafeUrl(citation.url)) {
    return null;
  }
  try {
    return new URL(citation.url as string).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The subreddit handle (`r/ApplyingToCollege`) for a reddit thread, else null. */
function subredditOf(citation: Citation): string | null {
  if (!isSafeUrl(citation.url)) {
    return null;
  }
  const match = (citation.url as string).match(/reddit\.com\/(r\/[A-Za-z0-9_]+)/i);
  return match ? match[1] : null;
}

/**
 * A friendly, jargon-free name for an EXTERNAL source — the inline pill label.
 * Reddit → the subreddit; a known publisher → its brand; anything else → the
 * bare host. DB sources never reach this (they're "Counselle data").
 */
export function friendlySourceName(citation: Citation): string {
  if (citation.source === 'reddit') {
    return subredditOf(citation) ?? 'Reddit';
  }
  const host = hostOf(citation);
  if (host && BRANDS[host]) {
    return BRANDS[host];
  }
  return host ?? 'Source';
}

/** The school name a DB label leads with (`"NYU — Common Data Set…"` → `"NYU"`). */
export function schoolFromDbLabel(label: string): string | null {
  const [head] = label.split(' — ');
  const name = head?.trim();
  return name && name.length > 0 ? name : null;
}
