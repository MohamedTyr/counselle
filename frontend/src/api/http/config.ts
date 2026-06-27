/**
 * The config client (B5c) — `GET /v1/config` (season-keyed greeting, starters,
 * the user's default source config). Near-static per session; the hook gives it
 * a generous staleTime. Reuses the shared error grammar.
 */
import { errorFromResponse } from './errors';
import type { SourceConfigWire } from '@/api/source-config';
import { BASE } from './constants';
import { safeFetch } from './safeFetch';

/** The `/v1/config` response (wire-contract §0.2). `footer` is NOT served — it
 *  is static brand copy kept locally (see `@/api/appFooter`). */
export interface ConfigData {
  greeting: string;
  season_note: string | null;
  conversation_starters: string[];
  /** Off the wire it may be absent/malformed; `fromWire` tolerates `undefined`. */
  default_source_config: SourceConfigWire | undefined;
  /** Feature flag — the ResponseModeControl is hidden when false (default). */
  deep_research_enabled: boolean;
}

/** GET /v1/config → the season-keyed home-screen config (authed cookie). */
export async function fetchConfig(): Promise<ConfigData> {
  const response = await safeFetch(`${BASE}/config`, {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  const data = (await response.json()) as Partial<ConfigData>;
  // Defensive: narrow off-the-wire fields before any consumer renders them.
  const starters = Array.isArray(data.conversation_starters)
    ? data.conversation_starters.filter((s): s is string => typeof s === 'string')
    : [];
  return {
    greeting: typeof data.greeting === 'string' ? data.greeting : '',
    season_note: typeof data.season_note === 'string' ? data.season_note : null,
    conversation_starters: starters,
    default_source_config: data.default_source_config,
    deep_research_enabled: data.deep_research_enabled === true,
  };
}
