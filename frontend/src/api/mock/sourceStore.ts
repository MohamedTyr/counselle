/**
 * Per-conversation source config store.
 * State: database always-on, web/edu/reddit toggles, reddit subreddit selection.
 * Persisted per conversation in localStorage.
 * FE-7 will move this to the real backend; shape stays the same.
 */

const STORAGE_KEY_PREFIX = 'counselle:sourceConfig:';
/** FE-5: user-set DEFAULT source config for new chats (Settings → General). */
const DEFAULTS_STORAGE_KEY = 'counselle:sourceDefaults';

// C3 (wire-contract): the concrete subreddit menu from config/assets/subreddit_menu.yaml.
// The `{school}` template row is agent-internal and excluded from the toggle UI.
export const SUBREDDITS = [
  'r/ApplyingToCollege',
  'r/chanceme',
  'r/financialaid',
  'r/premed',
  'r/csMajors',
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

/**
 * FE-5: the default source config for NEW conversations.
 * User-editable in Settings → General; falls back to the built-in defaults.
 */
export function getDefaultSourceConfig(): SourceConfig {
  try {
    const raw = localStorage.getItem(DEFAULTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG, selectedSubreddits: [...SUBREDDITS] };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...DEFAULT_CONFIG, selectedSubreddits: [...SUBREDDITS] };
    }
    const stored = parsed as Partial<SourceConfig>;
    return {
      webSearch: stored.webSearch ?? DEFAULT_CONFIG.webSearch,
      eduSources: stored.eduSources ?? DEFAULT_CONFIG.eduSources,
      reddit: stored.reddit ?? DEFAULT_CONFIG.reddit,
      selectedSubreddits: stored.selectedSubreddits ?? [...SUBREDDITS],
    };
  } catch {
    return { ...DEFAULT_CONFIG, selectedSubreddits: [...SUBREDDITS] };
  }
}

/** FE-5: persist the default source config for new conversations. */
export function setDefaultSourceConfig(patch: Partial<SourceConfig>): SourceConfig {
  const updated: SourceConfig = { ...getDefaultSourceConfig(), ...patch };
  try {
    localStorage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // quota exceeded or private mode — silent no-op
  }
  return updated;
}

/** Narrow a stored subreddit list: an array of `r/…` keys present in SUBREDDITS,
 *  unknowns dropped. Returns `null` when the value isn't a usable array. */
function narrowSubreddits(value: unknown): Subreddit[] | null {
  if (!Array.isArray(value)) return null;
  const known = SUBREDDITS as readonly string[];
  return value.filter(
    (s): s is Subreddit => typeof s === 'string' && s.startsWith('r/') && known.includes(s),
  );
}

function loadConfig(conversationId: string): SourceConfig {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${conversationId}`);
    if (!raw) return getDefaultSourceConfig();
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return getDefaultSourceConfig();
    }
    const stored = parsed as Partial<SourceConfig>;
    const defaults = getDefaultSourceConfig();
    return {
      webSearch: typeof stored.webSearch === 'boolean' ? stored.webSearch : defaults.webSearch,
      eduSources: typeof stored.eduSources === 'boolean' ? stored.eduSources : defaults.eduSources,
      reddit: typeof stored.reddit === 'boolean' ? stored.reddit : defaults.reddit,
      selectedSubreddits: narrowSubreddits(stored.selectedSubreddits) ?? defaults.selectedSubreddits,
    };
  } catch {
    return getDefaultSourceConfig();
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
  if (!conversationId) return getDefaultSourceConfig();
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
