/**
 * schoolLogo — pure helpers for turning a school's website host into a logo.
 *
 * Quality vs. reliability, in one ordered chain (the component walks it on each
 * <img> error, then draws a monogram):
 *   1. logo.dev — real, high-resolution brand logos. Optional: enabled only when
 *      VITE_LOGO_DEV_TOKEN is set (a *publishable* token, safe in the browser).
 *      This is the only source that returns crisp HD logos for .edu domains.
 *   2. Google s2 favicons — keyless; low-res (~16px for .edu) but returns the
 *      *correct* mark and 404-degrades cleanly, so it's the reliable default.
 *   3. DuckDuckGo icons — keyless; often larger (32–48px) but sometimes serves a
 *      generic placeholder instead of 404ing, so it's a secondary, not primary.
 * Keyless favicons are inherently low-res for .edu domains; set the logo.dev
 * token for crisp HD. No source is hardcoded per school — the host is always
 * derived live from the DB's `institution.website`.
 */

const LOGO_DEV_TOKEN = (import.meta.env.VITE_LOGO_DEV_TOKEN as string | undefined)?.trim();

export function logoCandidates(domain: string, size = 128): string[] {
  const host = domain.trim().toLowerCase();
  if (!host) return [];
  const px = Math.max(size, 64); // never ask a CDN for a tiny, upscale-blurred image
  const enc = encodeURIComponent(host);
  const urls: string[] = [];
  if (LOGO_DEV_TOKEN) {
    urls.push(`https://img.logo.dev/${enc}?token=${LOGO_DEV_TOKEN}&size=${px}&format=png&retina=true`);
  }
  // NOTE: third-party-favicon privacy concern, same class as FE-H1 (the citation
  // SourceFavicon leak Phase 4 closed) — fetching from Google reveals which school
  // host the student is viewing. This is a DIFFERENT surface: school-card logos,
  // not the citation/source-browsing path. Deliberately left here and deferred to
  // Phase 6 (CFG-04 DRY + the deferred backend favicon-proxy option). See TODOS.md.
  urls.push(`https://www.google.com/s2/favicons?domain=${enc}&sz=${px}`);
  urls.push(`https://icons.duckduckgo.com/ip3/${enc}.ico`);
  return urls;
}

/** A 1-2 letter monogram for the final fallback: initials of the first two
 *  significant words ("New York University" → "NY"), skipping filler words. */
const FILLER = new Set(['of', 'the', 'and', 'at', 'for', 'in']);

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !FILLER.has(w.toLowerCase()));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
