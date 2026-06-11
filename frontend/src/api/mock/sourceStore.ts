/**
 * Per-conversation source config store.
 * State: database always-on, web/edu/reddit toggles, reddit subreddit selection.
 * Persisted per conversation in localStorage.
 * FE-7 will move this to the real backend; shape stays the same.
 */

const STORAGE_KEY_PREFIX = 'counselle:sourceConfig:';

export const SUBREDDITS = [
  'r/ApplyingToCollege',
  'r/chanceme',
  'r/IntltoUSA',
] as const;

export type Subreddit = (typeof SUBREDDITS)[number];

export type SourceConfig = {
  webSearch: boolean;
  eduSources: boolean;
  reddit: boolean;
  selectedSubreddits: Subreddit[];
};

const DEFAULT_CONFIG: SourceConfig = {
  webSearch: true,
  eduSources: true,
  reddit: true,
  selectedSubreddits: [...SUBREDDITS],
};

function loadConfig(conversationId: string): SourceConfig {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${conversationId}`);
    if (!raw) return { ...DEFAULT_CONFIG, selectedSubreddits: [...SUBREDDITS] };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_CONFIG, selectedSubreddits: [...SUBREDDITS] };
    }
    return parsed as SourceConfig;
  } catch {
    return { ...DEFAULT_CONFIG, selectedSubreddits: [...SUBREDDITS] };
  }
}

function saveConfig(conversationId: string, config: SourceConfig): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${conversationId}`, JSON.stringify(config));
  } catch {
    // quota exceeded or private mode — silent no-op
  }
}

export function getSourceConfig(conversationId: string | null): SourceConfig {
  if (!conversationId) return { ...DEFAULT_CONFIG, selectedSubreddits: [...SUBREDDITS] };
  return loadConfig(conversationId);
}

export function updateSourceConfig(
  conversationId: string | null,
  patch: Partial<SourceConfig>,
): SourceConfig {
  const current = getSourceConfig(conversationId);
  const updated: SourceConfig = { ...current, ...patch };
  if (conversationId) {
    saveConfig(conversationId, updated);
  }
  return updated;
}
