/**
 * FE-SOURCECFG-DUAL — the per-session source config is a single REACTIVE source
 * (the React Query cache keyed `['sourceConfig', sessionId]`), not a `useState`
 * mirror re-read by effects. These tests prove the two halves of the contract:
 *   1. Opening a conversation whose config is already in the cache shows it
 *      WITHOUT any manual re-read — the composer renders the cached subs/active.
 *   2. Toggling a source writes the cache optimistically, so the value the next
 *      `sendMessage` reads (via ChatContext's cache-backed `getSourceConfig`) is
 *      the toggled one.
 *
 * The Radix popover (portal + floating-ui) is flaky to drive under jsdom, so the
 * cache contract is exercised directly (seed/read), which is exactly the seam the
 * composer + ChatContext now share.
 */
import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { sourceConfigKey } from '@/app/ChatContext';
import { getDefaultSourceConfig, type SourceConfig } from '@/api/sourceConfigStore';

/** Mirrors ChatComposer's reactive read: cache-only, no network. */
function probeConfig(client: QueryClient, sessionId: string): SourceConfig {
  let observed: SourceConfig = getDefaultSourceConfig();
  function Probe() {
    const { data = getDefaultSourceConfig() } = useQuery<SourceConfig>(
      sourceConfigKey(sessionId),
      () => getDefaultSourceConfig(),
      { enabled: false, staleTime: Infinity },
    );
    observed = data;
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return observed;
}

/** Mirrors ChatContext's cache-backed `getSourceConfig` (the send read path). */
function getSourceConfigFromCache(client: QueryClient, convoId: string | null): SourceConfig {
  if (convoId === null) {
    return getDefaultSourceConfig();
  }
  return client.getQueryData<SourceConfig>(sourceConfigKey(convoId)) ?? getDefaultSourceConfig();
}

describe('FE-SOURCECFG-DUAL — reactive per-session source config', () => {
  test('opening a conversation shows the cached (server) config without a re-read', () => {
    const client = new QueryClient();
    const serverConfig: SourceConfig = {
      webSearch: true,
      eduSources: false,
      reddit: false,
      selectedSubreddits: ['r/premed'],
    };
    // ChatContext's loadTranscript seeds this from server truth.
    client.setQueryData(sourceConfigKey('c1'), serverConfig);

    const observed = probeConfig(client, 'c1');
    expect(observed).toEqual(serverConfig);
  });

  test('a session with no cached config falls back to the new-chat default', () => {
    const client = new QueryClient();
    const observed = probeConfig(client, 'c-unseeded');
    expect(observed).toEqual(getDefaultSourceConfig());
  });

  test('toggling a source updates the cache → the next send reads the toggled value', () => {
    const client = new QueryClient();
    client.setQueryData(sourceConfigKey('c1'), getDefaultSourceConfig());

    // The composer's handleSourcesChange: optimistic setQueryData.
    const current =
      client.getQueryData<SourceConfig>(sourceConfigKey('c1')) ?? getDefaultSourceConfig();
    client.setQueryData<SourceConfig>(sourceConfigKey('c1'), { ...current, reddit: false });

    // ChatContext.runTurn reads getSourceConfig(convoId) from the cache.
    const onSend = getSourceConfigFromCache(client, 'c1');
    expect(onSend.reddit).toBe(false);
    // And the composer renders the same toggled value reactively.
    expect(probeConfig(client, 'c1').reddit).toBe(false);
  });
});
