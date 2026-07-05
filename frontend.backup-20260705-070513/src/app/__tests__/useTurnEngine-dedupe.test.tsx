import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, useRef, useState, type ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProtocolEvent } from '@/api/protocol';
import { getDefaultSourceConfig } from '@/api/sourceConfigStore';
import type { ChatMessage } from '@/api/projectTranscript';

const transportMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  attach: vi.fn(),
  cancel: vi.fn(async (_sessionId: string) => {}),
  transcript: vi.fn(async (_sessionId: string) => ({ entries: [], sourceConfig: null })),
  createSession: vi.fn(async (_sourceConfig: unknown) => ({ session_id: 'c1' })),
}));

vi.mock('@/api/selectTransport', () => ({
  transport: {
    sendMessage: (sessionId: string, body: unknown) =>
      transportMocks.sendMessage(sessionId, body),
    attach: (sessionId: string) => transportMocks.attach(sessionId),
    cancel: (sessionId: string) => transportMocks.cancel(sessionId),
    transcript: (sessionId: string) => transportMocks.transcript(sessionId),
    createSession: (sourceConfig: unknown) => transportMocks.createSession(sourceConfig),
  },
}));

import { useTurnEngine, type TurnEngine } from '@/app/useTurnEngine';

type HarnessResult = {
  engine: TurnEngine;
  messages: ChatMessage[];
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(
    MemoryRouter,
    null,
    createElement(QueryClientProvider, { client }, children),
  );
}

function useHarness(initialMessages: ChatMessage[] = []): HarnessResult {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const persistedRef = useRef(messages);
  persistedRef.current = messages;
  const conversationIdRef = useRef<string | null>('c1');
  const freshSessionsRef = useRef<Set<string>>(new Set());
  const queryClientRef = useRef(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const navigate: NavigateFunction = (() => {}) as NavigateFunction;
  const engine = useTurnEngine({
    persistedRef,
    setPersisted: setMessages,
    conversationId: 'c1',
    conversationIdRef,
    setConversationId: () => {},
    freshSessionsRef,
    loadTranscript: async () => {},
    navigate,
    queryClient: queryClientRef.current,
    getSourceConfig: () => getDefaultSourceConfig(),
    setAbortScroll: () => {},
  });
  return { engine, messages };
}

function user(messageId: string, conversationId = 'c1'): ChatMessage {
  return {
    messageId,
    conversationId,
    parentMessageId: null,
    text: 'What about MIT?',
    isCreatedByUser: true,
    sender: '',
    error: false,
    unfinished: false,
    hasBackendId: true,
    ts: '2026-06-18T00:00:00.000Z',
  };
}

function assistant(messageId: string, conversationId = 'c1'): ChatMessage {
  return {
    messageId,
    conversationId,
    parentMessageId: 'user-1',
    text: 'old answer',
    isCreatedByUser: false,
    sender: 'Counselle',
    error: false,
    unfinished: false,
    hasBackendId: true,
    turnStatus: 'complete',
    ts: '2026-06-18T00:00:00.000Z',
  };
}

function meta(messageId = 'asst-1'): ProtocolEvent {
  return {
    v: 1,
    type: 'meta',
    data: {
      trace_id: 'trace-1',
      session_id: 'c1',
      model: 'test-model',
      message_id: messageId,
      user_message_id: 'user-1',
    },
  };
}

function delta(text: string): ProtocolEvent {
  return { v: 1, type: 'delta', data: { text } };
}

function done(): ProtocolEvent {
  return { v: 1, type: 'done', data: { status: 'complete' } };
}

async function* stream(events: ProtocolEvent[]): AsyncGenerator<ProtocolEvent, void, undefined> {
  for (const event of events) {
    yield event;
  }
}

async function* streamThenThrow(
  events: ProtocolEvent[],
  error: Error,
): AsyncGenerator<ProtocolEvent, void, undefined> {
  for (const event of events) {
    yield event;
  }
  throw error;
}

function gatedStream(events: ProtocolEvent[]): {
  release: () => void;
  iterable: AsyncGenerator<ProtocolEvent, void, undefined>;
} {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  async function* iterable(): AsyncGenerator<ProtocolEvent, void, undefined> {
    await gate;
    for (const event of events) {
      yield event;
    }
  }
  return { release, iterable: iterable() };
}

function assistantCards(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => !message.isCreatedByUser);
}

describe('useTurnEngine terminal assistant idempotency', () => {
  beforeEach(() => {
    transportMocks.sendMessage.mockReset();
    transportMocks.attach.mockReset();
    transportMocks.cancel.mockClear();
    transportMocks.transcript.mockClear();
    transportMocks.createSession.mockClear();
  });

  test('duplicate done frames persist one completed assistant card', async () => {
    transportMocks.sendMessage.mockReturnValue(stream([meta(), delta('final'), done(), done()]));

    const { result } = renderHook(() => useHarness(), { wrapper });

    await act(async () => {
      await result.current.engine.submitMessage('Tell me about MIT.');
    });

    await waitFor(() => expect(assistantCards(result.current.messages)).toHaveLength(1));
    expect(assistantCards(result.current.messages)[0]).toMatchObject({
      messageId: 'asst-1',
      conversationId: 'c1',
      text: 'final',
      turnStatus: 'complete',
      hasBackendId: true,
    });
  });

  test('accepted-then-failed terminal card is replaced by a replayed completion', async () => {
    transportMocks.sendMessage.mockReturnValueOnce(
      streamThenThrow([meta(), delta('partial')], new Error('socket closed')),
    );
    transportMocks.attach.mockReturnValueOnce(stream([meta(), delta('final'), done()]));

    const { result } = renderHook(() => useHarness([user('user-1')]), { wrapper });

    await act(async () => {
      await result.current.engine.submitMessage('Tell me about MIT.');
    });

    await waitFor(() => {
      const cards = assistantCards(result.current.messages);
      expect(cards).toHaveLength(1);
      expect(cards[0].turnStatus).toBe('error');
    });

    await act(async () => {
      await result.current.engine.attachTurn('c1');
    });

    await waitFor(() => {
      const cards = assistantCards(result.current.messages);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        messageId: 'asst-1',
        text: 'final',
        turnStatus: 'complete',
      });
    });
  });

  test('same-tick attach does not start a replay loop for the active send', async () => {
    const live = gatedStream([meta(), delta('final'), done()]);
    transportMocks.sendMessage.mockReturnValueOnce(live.iterable);
    transportMocks.attach.mockReturnValueOnce(stream([meta(), delta('replayed'), done()]));

    const { result } = renderHook(() => useHarness(), { wrapper });

    let sendPromise: Promise<boolean> = Promise.resolve(false);
    act(() => {
      sendPromise = result.current.engine.submitMessage('Tell me about MIT.');
    });

    await act(async () => {
      await result.current.engine.attachTurn('c1');
    });

    expect(transportMocks.attach).not.toHaveBeenCalled();

    live.release();
    await act(async () => {
      await sendPromise;
    });

    await waitFor(() => expect(assistantCards(result.current.messages)).toHaveLength(1));
    expect(assistantCards(result.current.messages)[0].text).toBe('final');
  });

  test('attach replay without meta reuses the loaded assistant id', async () => {
    transportMocks.attach.mockReturnValueOnce(stream([delta('replayed final'), done()]));

    const { result } = renderHook(() => useHarness([user('user-1'), assistant('asst-1')]), {
      wrapper,
    });

    await act(async () => {
      await result.current.engine.attachTurn('c1');
    });

    await waitFor(() => {
      const cards = assistantCards(result.current.messages);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        messageId: 'asst-1',
        conversationId: 'c1',
        text: 'replayed final',
        turnStatus: 'complete',
      });
    });
  });

  test('terminal upsert does not replace user or other-conversation id matches', async () => {
    const sameIdUser = user('asst-1');
    const otherConversationAssistant = assistant('asst-1', 'c2');
    transportMocks.attach.mockReturnValueOnce(stream([meta(), delta('new answer'), done()]));

    const { result } = renderHook(
      () => useHarness([sameIdUser, otherConversationAssistant, user('user-1')]),
      { wrapper },
    );

    await act(async () => {
      await result.current.engine.attachTurn('c1');
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(4));
    expect(result.current.messages[0]).toBe(sameIdUser);
    expect(result.current.messages[1]).toBe(otherConversationAssistant);
    expect(assistantCards(result.current.messages).filter((m) => m.conversationId === 'c1')).toHaveLength(1);
    expect(result.current.messages[3]).toMatchObject({
      messageId: 'asst-1',
      conversationId: 'c1',
      text: 'new answer',
      turnStatus: 'complete',
    });
  });

  test('missing terminal is honest error once, then replay completion replaces it', async () => {
    transportMocks.sendMessage.mockReturnValueOnce(stream([meta(), delta('partial')]));
    transportMocks.attach.mockReturnValueOnce(stream([meta(), delta('final'), done()]));

    const { result } = renderHook(() => useHarness([user('user-1')]), { wrapper });

    await act(async () => {
      await result.current.engine.submitMessage('Tell me about MIT.');
    });

    await waitFor(() => {
      const cards = assistantCards(result.current.messages);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        messageId: 'asst-1',
        text: 'partial',
        turnStatus: 'error',
      });
    });

    await act(async () => {
      await result.current.engine.attachTurn('c1');
    });

    await waitFor(() => {
      const cards = assistantCards(result.current.messages);
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        messageId: 'asst-1',
        text: 'final',
        turnStatus: 'complete',
      });
    });
  });
});
