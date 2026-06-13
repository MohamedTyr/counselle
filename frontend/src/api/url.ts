/**
 * URL safety guard (B5a) — gate citation/source URLs before they reach an
 * `href` sink. B5a is the first changeset flowing LIVE backend data into the
 * clickable citation cards; a `javascript:`/`data:` URL from a compromised data
 * row would be an XSS sink that `target="_blank"`/`rel` do NOT stop on click.
 *
 * Only http(s) URLs are clickable; everything else is rendered as inert text.
 */

/** True only when `url` parses as an absolute http: or https: URL. */
export function isSafeUrl(url: string | null | undefined): url is string {
  if (url == null || url === '') {
    return false;
  }
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
