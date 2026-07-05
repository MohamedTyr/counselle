/**
 * a11y guard (plan §3 behavior 23): the composer's scoped CSS must NOT ship a
 * global `*:focus-visible` reset. The original lab injected one at module scope
 * (app-wide, with `!important`) — the refactor scopes every rule under
 * `.counselle-composer`. This reads the real CSS file and asserts the scoping.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, test, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(here, '../composer.css'), 'utf8');
// Strip /* … */ comments so the JSDoc header's prose mention of
// `*:focus-visible` doesn't read as a shipped rule.
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

describe('composer.css focus-visible scoping (behavior 23)', () => {
  test('the file scopes its rules under .counselle-composer', () => {
    expect(css).toContain('.counselle-composer');
  });

  test('every *:focus-visible occurrence is prefixed with .counselle-composer', () => {
    // Match any *:focus-visible NOT immediately preceded by ".counselle-composer ".
    const unscoped = /(?<!\.counselle-composer\s)\*:focus-visible/g;
    expect(css).not.toMatch(unscoped);
  });

  test('there is at least one scoped focus-visible rule (the reset is kept, just scoped)', () => {
    expect(css).toMatch(/\.counselle-composer\s\*:focus-visible/);
  });

  test('no `!important` survives on the focus-visible reset', () => {
    // The whole point: the global, !important app-wide reset must be gone.
    const focusBlock = css.match(/\*:focus-visible\s*\{[^}]*\}/g) ?? [];
    for (const block of focusBlock) {
      expect(block).not.toContain('!important');
    }
  });
});
