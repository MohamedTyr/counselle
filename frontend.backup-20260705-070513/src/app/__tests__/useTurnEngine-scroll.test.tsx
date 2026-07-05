/**
 * Phase 5 regression guard — `setAbortScroll(false)` on send.
 *
 * Pre-refactor, `ChatContext.startSend` re-engaged scroll-follow on every send
 * (so the view follows the streaming answer even if the user had scrolled up).
 * The Phase 5 extraction into `useTurnEngine` dropped that call; this test pins
 * it back: sending into an existing conversation MUST call `setAbortScroll(false)`
 * before the turn runs.
 *
 * The transport seam is mocked to yield a minimal `meta → delta → done` stream so
 * the send completes without a network. We assert the provider-owned
 * `setAbortScroll` dep is invoked with `false`.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, useRef, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProtocolEvent } from '@/api/protocol';
import { getDefaultSourceConfig } from '@/api/sourceConfigStore';
import type { ChatMessage } from '@/api/projectTranscript';

// ── Mock the transport seam the engine drives ─────────────────────────────────
async function* okStream(): AsyncGenerator<ProtocolEvent, void, undefined> {
  yield { v: 1, type: 'meta', data: { trace_id: 't', session_id: 'c1', model: 'm', message_id: 'asst-1', user_message_id: 'user-1' } };
  yield { v: 1, type: 'delta', data: { text: 'hi' } };
  yield { v: 1, type: 'done', data: { status: 'complete' } };
}
const sendMessage = vi.fn((_sessionId: string, _body: unknown) => okStream());
vi.mock('@/api/selectTransport', () => ({
  transport: {
    sendMessage: (sessionId: string, body: unknown) => sendMessage(sessionId, body),
    attach: () => (async function* () {})(),
    cancel: vi.fn(async () => {}),
    transcript: vi.fn(async () => ({ entries: [], sourceConfig: null })),
    createSession: vi.fn(async () => ({ session_id: 'c1' })),
  },
}));

import { useTurnEngine, type TurnEngine } from '@/app/useTurnEngine';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(
    MemoryRouter,
    null,
    createElement(QueryClientProvider, { client }, children),
  );
}

describe('useTurnEngine — scroll-follow on send (Phase 5 regression)', () => {
  beforeEach(() => {
    sendMessage.mockClear();
  });

  test('sending into an existing conversation calls setAbortScroll(false)', async () => {
    const setAbortScroll = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    let engine: TurnEngine = null as unknown as TurnEngine;
    function useHarness(): TurnEngine {
      const persistedRef = useRef<ChatMessage[]>([]);
      const conversationIdRef = useRef<string | null>('c1');
      const freshSessionsRef = useRef<Set<string>>(new Set());
      return useTurnEngine({
        persistedRef,
        setPersisted: () => {},
        conversationId: 'c1',
        conversationIdRef,
        setConversationId: () => {},
        freshSessionsRef,
        loadTranscript: async () => {},
        navigate: (() => {}) as never,
        queryClient,
        getSourceConfig: () => getDefaultSourceConfig(),
        setAbortScroll,
      });
    }

    const { result } = renderHook(() => useHarness(), { wrapper });
    engine = result.current;

    await act(async () => {
      await engine.submitMessage('what is MIT like?');
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(setAbortScroll).toHaveBeenCalledWith(false);
  });
});
