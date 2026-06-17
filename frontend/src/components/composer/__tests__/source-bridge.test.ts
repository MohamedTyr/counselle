/**
 * Source-bridge unit tests (plan §3 behaviors 13, 14, 15, 16, 22).
 *
 * Pure-function coverage of the FE-store ⇆ composer ⇆ wire mapping:
 *   - `toActiveSet`  : SourceConfig → the composer's controlled `Set<SourceId>`
 *   - round-trip     : config → active set → patch → store → read back
 *   - `toWire` golden: the exact request body for given source selections
 *   - SUBREDDITS      : the store's canonical 5 (not the lab's wrong list)
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { toActiveSet } from '@/components/composer/ChatComposer';
import {
  SUBREDDITS,
  getSourceConfig,
  updateSourceConfig,
  type SourceConfig,
} from '@/api/sourceConfigStore';
import { toWire } from '@/api/source-config';

function config(over: Partial<SourceConfig> = {}): SourceConfig {
  return {
    webSearch: true,
    eduSources: true,
    reddit: true,
    selectedSubreddits: [...SUBREDDITS],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('toActiveSet — SourceConfig → composer active set (behaviors 13, 16)', () => {
  test('maps webSearch→web, eduSources→edu, reddit→reddit', () => {
    const active = toActiveSet(config());
    expect(active).toEqual(new Set(['web', 'edu', 'reddit']));
  });

  test('all sources off → empty set', () => {
    const active = toActiveSet(
      config({ webSearch: false, eduSources: false, reddit: false }),
    );
    expect(active.size).toBe(0);
  });

  test('only web on → {web}', () => {
    const active = toActiveSet(config({ webSearch: true, eduSources: false, reddit: false }));
    expect(active).toEqual(new Set(['web']));
  });

  test('Database is never part of the active set (always-on, not a toggle)', () => {
    const active = toActiveSet(config());
    expect(active.has('web')).toBe(true);
    // there is no 'database' SourceId — the set only ever holds web/edu/reddit
    expect([...active].every((id) => id === 'web' || id === 'edu' || id === 'reddit')).toBe(true);
  });
});

describe('round-trip: store → toActiveSet → patch → store (behaviors 13, 15)', () => {
  test('reconstructing a patch from the active set persists the same booleans', () => {
    const convo = 'convo-1';
    // Arrange: seed a mixed config.
    updateSourceConfig(convo, { webSearch: true, eduSources: false, reddit: true });
    const stored = getSourceConfig(convo);

    // Act: derive the active set, then rebuild the boolean patch from it.
    const active = toActiveSet(stored);
    const patch: Partial<SourceConfig> = {
      webSearch: active.has('web'),
      eduSources: active.has('edu'),
      reddit: active.has('reddit'),
    };
    updateSourceConfig(convo, patch);

    // Assert: a no-op round-trip leaves the booleans unchanged.
    const after = getSourceConfig(convo);
    expect(after.webSearch).toBe(true);
    expect(after.eduSources).toBe(false);
    expect(after.reddit).toBe(true);
  });

  test('selecting a subreddit subset persists to selectedSubreddits', () => {
    const convo = 'convo-2';
    const subset = ['r/ApplyingToCollege', 'r/premed'] as SourceConfig['selectedSubreddits'];
    updateSourceConfig(convo, { selectedSubreddits: subset });
    expect(getSourceConfig(convo).selectedSubreddits).toEqual(subset);
  });
});

describe('toWire golden — the request body for given selections (behavior 22)', () => {
  test('all sources on, full subreddit menu → reddit_subreddits is null', () => {
    expect(toWire(config())).toEqual({
      web: true,
      edu: true,
      reddit: true,
      reddit_subreddits: null,
    });
  });

  test('a subreddit subset → bare keys array (no r/ prefix)', () => {
    const subset = ['r/ApplyingToCollege', 'r/chanceme'] as SourceConfig['selectedSubreddits'];
    expect(toWire(config({ selectedSubreddits: subset }))).toEqual({
      web: true,
      edu: true,
      reddit: true,
      reddit_subreddits: ['ApplyingToCollege', 'chanceme'],
    });
  });

  test('reddit off still emits the subreddit field per the wire shape', () => {
    expect(toWire(config({ reddit: false }))).toEqual({
      web: true,
      edu: true,
      reddit: false,
      reddit_subreddits: null,
    });
  });

  test('web + edu off → bare false booleans', () => {
    const out = toWire(config({ webSearch: false, eduSources: false }));
    expect(out.web).toBe(false);
    expect(out.edu).toBe(false);
  });
});

describe('SUBREDDITS sanity — the canonical store menu (behavior 14)', () => {
  test('exactly the 5 canonical subreddits, in order', () => {
    expect([...SUBREDDITS]).toEqual([
      'r/ApplyingToCollege',
      'r/chanceme',
      'r/financialaid',
      'r/premed',
      'r/csMajors',
    ]);
  });

  test("does NOT include the lab's wrong list", () => {
    const bare = SUBREDDITS.map((s) => s.replace(/^r\//, ''));
    expect(bare).not.toContain('collegeresults');
    expect(bare).not.toContain('CollegeAdmissions');
    expect(bare).not.toContain('IntltoUSA');
  });
});
