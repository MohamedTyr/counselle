/**
 * config — the `faviconUrl` helper (CFG-04): the single keyless-favicon URL
 * builder. Verifies the host is encoded exactly once and the size is the named
 * default unless overridden.
 */
import { describe, expect, test } from 'vitest';
import { DEFAULT_FAVICON_SIZE, FAVICON_CDN_BASE, faviconUrl } from '@/config';

describe('faviconUrl', () => {
  test('builds the Google s2 URL with the default size', () => {
    expect(faviconUrl('duke.edu')).toBe(
      `${FAVICON_CDN_BASE}?domain=duke.edu&sz=${DEFAULT_FAVICON_SIZE}`,
    );
    expect(DEFAULT_FAVICON_SIZE).toBe(64);
  });

  test('encodes the host and honors an explicit size', () => {
    expect(faviconUrl('a b.edu', 32)).toBe(
      `${FAVICON_CDN_BASE}?domain=a%20b.edu&sz=32`,
    );
  });

  test('encodes the host exactly once (no double-encoding)', () => {
    const url = faviconUrl('a b.edu');
    expect(url).toContain('domain=a%20b.edu');
    expect(url).not.toContain('a%2520b.edu');
  });
});
