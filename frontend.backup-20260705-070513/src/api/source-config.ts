/**
 * The source-config wire boundary (B5c, wire-contract §4 + C3).
 *
 * The ONE place that translates between the FE store shape (`SourceConfig`,
 * `webSearch`/`eduSources`/`reddit`/`selectedSubreddits` with `r/…` keys) and
 * the wire shape (`SourceConfigWire`, bare `web`/`edu`/`reddit`/`reddit_subreddits`).
 *
 * Discipline: nothing above `transport.ts` ever sees the wire (bare-key) shape;
 * nothing on the wire ever sees `webSearch`. ChatContext builds the wire body
 * via `toWire` right at the `sendMessage`/`createSession` call.
 */
import { SUBREDDITS, type SourceConfig, type Subreddit } from './sourceConfigStore';

/** The wire shape — backend names (`domain/specs.py SourceConfig`). */
export type SourceConfigWire = {
  web: boolean;
  edu: boolean;
  reddit: boolean;
  /** Bare keys, no `r/`. `null` = the full menu (the backend's default). */
  reddit_subreddits: string[] | null;
};

/** The full subreddit menu as bare keys — re-derived from the FE `SUBREDDITS`
 *  constant (C3: the concrete yaml entries; the `{school}` template row is
 *  agent-internal and excluded from the toggle). `null` on the wire means this. */
export const FULL_MENU: readonly string[] = SUBREDDITS.map((s) => s.replace(/^r\//, ''));

/** FE store defaults — the fallback when wire input is missing or malformed. */
const FE_DEFAULTS: SourceConfig = {
  webSearch: true,
  eduSources: true,
  reddit: true,
  selectedSubreddits: [...SUBREDDITS],
};

function setEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bSet = new Set(b);
  return a.every((x) => bSet.has(x));
}

/** FE → wire. `reddit_subreddits` collapses to `null` when the full menu is selected. */
export function toWire(fe: SourceConfig): SourceConfigWire {
  const selectedBare = fe.selectedSubreddits.map((s) => s.replace(/^r\//, ''));
  return {
    web: fe.webSearch,
    edu: fe.eduSources,
    reddit: fe.reddit,
    reddit_subreddits: setEquals(selectedBare, FULL_MENU) ? null : selectedBare,
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** The wire subreddit list → FE `r/…` selection. `null`/missing/malformed →
 *  the full menu (the backend's documented `null = full menu` semantics). */
function subredditsFromWire(value: unknown): Subreddit[] {
  if (!Array.isArray(value)) {
    return [...SUBREDDITS];
  }
  const bare = value
    .filter((s): s is string => typeof s === 'string')
    .filter((s) => FULL_MENU.includes(s));
  return bare.map((s) => `r/${s}` as Subreddit);
}

/** Wire → FE. Defensive: `wire` comes off the network — narrow `unknown` and
 *  fall back to FE defaults on a malformed payload (never throw at the seam). */
export function fromWire(wire: unknown): SourceConfig {
  if (wire === null || typeof wire !== 'object') {
    return { ...FE_DEFAULTS, selectedSubreddits: [...SUBREDDITS] };
  }
  const w = wire as Partial<SourceConfigWire>;
  return {
    webSearch: asBoolean(w.web, FE_DEFAULTS.webSearch),
    eduSources: asBoolean(w.edu, FE_DEFAULTS.eduSources),
    reddit: asBoolean(w.reddit, FE_DEFAULTS.reddit),
    selectedSubreddits:
      w.reddit_subreddits === null || w.reddit_subreddits === undefined
        ? [...SUBREDDITS]
        : subredditsFromWire(w.reddit_subreddits),
  };
}
