/**
 * Settings sync (B5b — the theme half).
 *
 * `users.settings` is a free jsonb bag (`{theme?, default_source_config?}`).
 * The contract:
 *   - server wins on login/me-resolve: seed the theme from `me.settings.theme`
 *     when present (the vendored ThemeProvider already keeps localStorage as the
 *     offline cache);
 *   - local-optimistic on change: the ThemeProvider flips immediately; we then
 *     PATCH /v1/me, spreading the existing settings so `default_source_config`
 *     (owned by B5c) is never clobbered.
 *
 * `default_source_config` follows the same contract via `usePersistDefaultSources`
 * below: the `/v1/config` seed wins on login (server → localStorage), and a
 * Settings→General toggle is local-optimistic then PATCHed to the server so the
 * choice survives a reload (otherwise the config seed re-clobbers it).
 */
import { useCallback, useEffect, useRef } from 'react';
import { useTheme } from '@librechat/client';
import { useMe, usePatchMe } from '@/app/auth';
import type { UserSettings } from '@/api/http/auth';
import {
  setDefaultSourceConfig,
  type SourceConfig,
} from '@/api/mock/sourceStore';
import { toWire } from '@/api/source-config';

const VALID_THEMES = ['light', 'dark', 'system'];

/**
 * Seed the theme from the server once `me` resolves (server wins). Runs only
 * when a stored server theme exists and differs from the active theme, and only
 * once per resolved user (a ref guards against re-seeding after a local change).
 */
export function useServerThemeSeed(): void {
  const { data: me } = useMe();
  const { theme, setTheme } = useTheme();
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!me) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current === me.id) {
      return;
    }
    const serverTheme = me.settings?.theme;
    if (typeof serverTheme === 'string' && VALID_THEMES.includes(serverTheme)) {
      if (serverTheme !== theme) {
        setTheme(serverTheme);
      }
    }
    seededFor.current = me.id;
  }, [me, theme, setTheme]);
}

/**
 * Returns a theme setter that flips the UI immediately (via the ThemeProvider)
 * then persists to the server.
 *
 * Error policy (FIX 6, honesty): `usePatchMe` already turns a 401 into a `me`
 * invalidation — an expired session surfaces (and routes through the AuthGate)
 * instead of leaving the student looking authed. A NON-401 persist failure stays
 * deliberately silent: theme is a preference, and the localStorage cache remains
 * the source of truth until the next change — not worth interrupting the student.
 */
export function usePersistTheme(): (value: string) => void {
  const { data: me } = useMe();
  const { setTheme } = useTheme();
  const patchMeMutation = usePatchMe();
  // FIX 9: depend on the stable `mutate` fn, not the whole mutation object
  // (recreated each render), so this callback stays memoized for ThemeSelector.
  const persist = patchMeMutation.mutate;

  return useCallback(
    (value: string) => {
      setTheme(value);
      if (!me) {
        return;
      }
      // Spread the existing settings so `default_source_config` (B5c) survives.
      const existing: UserSettings = me.settings ?? {};
      persist({ settings: { ...existing, theme: value } });
    },
    [me, setTheme, persist],
  );
}

/**
 * Returns a setter for the default source config (Settings→General). Writes
 * localStorage optimistically (the dropdown/Landing read it immediately) then
 * persists `default_source_config` to the server in WIRE shape, spreading the
 * existing settings so `theme` survives. Without the server write, the next
 * `/v1/config` seed would revert the toggle — a dishonest affordance.
 *
 * Error policy mirrors `usePersistTheme`: a 401 routes through the AuthGate (via
 * `usePatchMe`); a non-401 failure stays silent (localStorage remains the cache).
 */
export function usePersistDefaultSources(): (patch: Partial<SourceConfig>) => SourceConfig {
  const { data: me } = useMe();
  const patchMeMutation = usePatchMe();
  const persist = patchMeMutation.mutate;

  return useCallback(
    (patch: Partial<SourceConfig>) => {
      const updated = setDefaultSourceConfig(patch);
      if (me) {
        const existing: UserSettings = me.settings ?? {};
        persist({ settings: { ...existing, default_source_config: toWire(updated) } });
      }
      return updated;
    },
    [me, persist],
  );
}
