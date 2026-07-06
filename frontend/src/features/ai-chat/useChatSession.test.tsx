import type { PropsWithChildren } from "react";
import { act } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import type {
  ChatSession,
  ChatTransport,
  ProtocolEvent,
  SseFrame,
} from "@/api/chat/types";
import { createTestQueryClient } from "@/test/render-app";

import {
  clearChatSessionSourceConfigCacheForTests,
  useChatSession,
} from "./useChatSession";

type SessionQueryState = {
  data?: ChatSession;
  error: Error | null;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: () => Promise<unknown>;
};

const mockedQuery = vi.hoisted(() => ({
  state: undefined as SessionQueryState | undefined,
  useChatSessionQuery: vi.fn(),
}));

vi.mock("@/api/chat/hooks", () => ({
  chatKeys: {
    all: ["chat"] as const,
    sessions: {
      all: () => ["chat", "sessions"] as const,
    },
    session: (sessionId: string) => ["chat", "session", sessionId] as const,
  },
  useChatSession: mockedQuery.useChatSessionQuery,
}));

function session(sessionId: string, answer: string): ChatSession {
  return sessionWithSourceConfig(sessionId, answer, BUILT_IN_SOURCE_CONFIG);
}

function sessionWithSourceConfig(
  sessionId: string,
  answer: string,
  sourceConfig: ChatSession["sourceConfig"],
): ChatSession {
  return {
    sessionId,
    title: null,
    createdAt: "2026-07-06T12:00:00Z",
    updatedAt: "2026-07-06T12:00:01Z",
    sourceConfig,
    isGenerating: false,
    transcript: [
      {
        role: "user",
        message_id: `${sessionId}-user`,
        text: "Question",
        ts: "2026-07-06T12:00:00Z",
      },
      {
        role: "assistant",
        message_id: `${sessionId}-assistant`,
        text: answer,
        status: "complete",
        ts: "2026-07-06T12:00:01Z",
      },
    ],
  };
}

function delta(text: string): ProtocolEvent {
  return { v: 1, type: "delta", data: { text } };
}

function done(): ProtocolEvent {
  return { v: 1, type: "done", data: { status: "complete" } };
}

async function* replayStream(
  events: ProtocolEvent[],
): AsyncGenerator<SseFrame<ProtocolEvent>, void, undefined> {
  for (const event of events) {
    yield { data: event };
  }
}

function loadingQuery(): SessionQueryState {
  return {
    error: null,
    isLoading: true,
    isSuccess: false,
    refetch: vi.fn(),
  };
}

function successQuery(data: ChatSession): SessionQueryState {
  return {
    data,
    error: null,
    isLoading: false,
    isSuccess: true,
    refetch: vi.fn(),
  };
}

function createTransport(): ChatTransport {
  return {
    getChatConfig: vi.fn(),
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
    sendMessage: vi.fn(),
    attachStream: vi.fn(async () => ({ active: false as const })),
    streamFirstMessage: vi.fn(),
    cancelActiveTurn: vi.fn(),
    setMessageFeedback: vi.fn(),
  };
}

function wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

describe("useChatSession", () => {
  beforeEach(() => {
    clearChatSessionSourceConfigCacheForTests();
    mockedQuery.useChatSessionQuery.mockImplementation(
      () => mockedQuery.state,
    );
  });

  test("does not expose the previous transcript while a new session loads", async () => {
    const transport = createTransport();
    mockedQuery.state = successQuery(session("s1", "Old answer"));

    const { result, rerender } = renderHook(
      ({ sessionId }) => useChatSession({ sessionId, transport }),
      {
        initialProps: { sessionId: "s1" },
        wrapper,
      },
    );

    await waitFor(() =>
      expect(result.current.messages.map((message) => message.text)).toContain(
        "Old answer",
      ),
    );

    mockedQuery.state = loadingQuery();
    rerender({ sessionId: "s2" });

    expect(result.current.messages).toEqual([]);
    expect(result.current.transcriptError).toBeNull();
    expect(result.current.sourceConfig).toEqual(BUILT_IN_SOURCE_CONFIG);
  });

  test("reattaching a live turn reconciles onto the hydrated backend assistant id instead of duplicating the bubble", async () => {
    // Regression test for the hydrate-before-attach race: the attach effect
    // must only run once the transcript (with its real backend message
    // ids) has actually hydrated into local state. If attach ran first
    // (against an empty transcript), it would seed a fresh temp assistant
    // id and the replay below (which never re-emits `meta`) would persist
    // that temp id as a second, duplicate assistant bubble.
    const transport = createTransport();
    transport.attachStream = vi.fn(async () => ({
      active: true,
      stream: replayStream([delta(" continues"), done()]),
    }));
    mockedQuery.state = successQuery(session("s1", "Old answer"));

    const { result } = renderHook(
      ({ sessionId }) => useChatSession({ sessionId, transport }),
      {
        initialProps: { sessionId: "s1" },
        wrapper,
      },
    );

    await waitFor(() => {
      const assistants = result.current.messages.filter(
        (message) => message.kind === "assistant",
      );
      expect(assistants).toHaveLength(1);
      expect(assistants[0]).toMatchObject({
        messageId: "s1-assistant",
        text: " continues",
      });
    });
  });

  test("a setter bound to a stale sessionId does not blank the current session's transcript", async () => {
    // Regression test: setPersistedMessages/setSourceConfig used to stamp
    // their closed-over sessionId unconditionally into state. A callback
    // from an old session's in-flight stream firing after an in-place
    // session switch would overwrite localState.sessionId with the STALE
    // id, making isLocalSession false for the current session and
    // blanking its transcript.
    const transport = createTransport();
    mockedQuery.state = successQuery(session("s1", "First answer"));

    const { result, rerender } = renderHook(
      ({ sessionId }) => useChatSession({ sessionId, transport }),
      {
        initialProps: { sessionId: "s1" },
        wrapper,
      },
    );

    await waitFor(() =>
      expect(result.current.messages.map((message) => message.text)).toContain(
        "First answer",
      ),
    );

    const staleSetter = result.current.setPersistedMessages;

    mockedQuery.state = successQuery(session("s2", "Second answer"));
    rerender({ sessionId: "s2" });

    await waitFor(() =>
      expect(result.current.messages.map((message) => message.text)).toContain(
        "Second answer",
      ),
    );

    act(() => {
      staleSetter((previous) => [...previous]);
    });

    expect(
      result.current.messages.map((message) => message.text),
    ).toContain("Second answer");
  });

  test("a stale setter firing in the same tick as a session switch does not blank the transcript", async () => {
    // Tighter regression for the sessionIdRef microtask race: previously
    // sessionIdRef was synced inside a useEffect, which only flushes AFTER
    // commit. A stale setter firing in the SAME tick as the sessionId prop
    // switch (before React has flushed any effects) would still see the OLD
    // ref value, so its `sessionId !== sessionIdRef.current` guard evaluated
    // old !== old -> false, and it wrongly stamped the stale sessionId into
    // state -- transiently blanking the current transcript. Assigning the
    // ref in the render body closes that window: the ref is updated
    // synchronously as part of the same render that switches sessionId,
    // with no effect-flush gap for the stale setter to land in.
    const transport = createTransport();
    mockedQuery.state = successQuery(session("s1", "First answer"));

    const { result, rerender } = renderHook(
      ({ sessionId }) => useChatSession({ sessionId, transport }),
      {
        initialProps: { sessionId: "s1" },
        wrapper,
      },
    );

    await waitFor(() =>
      expect(result.current.messages.map((message) => message.text)).toContain(
        "First answer",
      ),
    );

    const staleSetter = result.current.setPersistedMessages;

    mockedQuery.state = successQuery(session("s2", "Second answer"));
    act(() => {
      // Switch sessions and fire the stale setter within the same act batch
      // (same tick, no effect flush in between).
      rerender({ sessionId: "s2" });
      staleSetter((previous) => [...previous]);
    });

    await waitFor(() =>
      expect(result.current.messages.map((message) => message.text)).toContain(
        "Second answer",
      ),
    );
  });

  test("keeps unsent source choices scoped to their session across route remounts", async () => {
    const transport = createTransport();
    mockedQuery.state = successQuery(session("s1", "First answer"));

    const first = renderHook(
      ({ sessionId }) => useChatSession({ sessionId, transport }),
      {
        initialProps: { sessionId: "s1" },
        wrapper,
      },
    );

    await waitFor(() =>
      expect(first.result.current.messages.map((message) => message.text)).toContain(
        "First answer",
      ),
    );

    act(() => {
      first.result.current.setSourceConfig({
        ...BUILT_IN_SOURCE_CONFIG,
        webSearch: false,
        selectedSubreddits: ["r/ApplyingToCollege"],
      });
    });

    expect(first.result.current.sourceConfig).toMatchObject({
      webSearch: false,
      selectedSubreddits: ["r/ApplyingToCollege"],
    });

    first.unmount();
    mockedQuery.state = successQuery(session("s2", "Second answer"));

    const second = renderHook(
      ({ sessionId }) => useChatSession({ sessionId, transport }),
      {
        initialProps: { sessionId: "s2" },
        wrapper,
      },
    );

    await waitFor(() =>
      expect(second.result.current.messages.map((message) => message.text)).toContain(
        "Second answer",
      ),
    );

    expect(second.result.current.sourceConfig).toEqual(BUILT_IN_SOURCE_CONFIG);

    second.unmount();
    mockedQuery.state = successQuery(session("s1", "First answer"));

    const remounted = renderHook(
      ({ sessionId }) => useChatSession({ sessionId, transport }),
      {
        initialProps: { sessionId: "s1" },
        wrapper,
      },
    );

    await waitFor(() =>
      expect(remounted.result.current.sourceConfig).toMatchObject({
        webSearch: false,
        selectedSubreddits: ["r/ApplyingToCollege"],
      }),
    );

    remounted.unmount();
  });

  test("lets backend source config win again after a local override is sent", async () => {
    const transport = createTransport();
    transport.sendMessage = vi.fn(() =>
      replayStream([delta("Sent answer"), done()]),
    );
    mockedQuery.state = successQuery(session("s1", "First answer"));

    const { result, rerender } = renderHook(
      ({ sessionId }) => useChatSession({ sessionId, transport }),
      {
        initialProps: { sessionId: "s1" },
        wrapper,
      },
    );

    await waitFor(() =>
      expect(result.current.messages.map((message) => message.text)).toContain(
        "First answer",
      ),
    );

    act(() => {
      result.current.setSourceConfig({
        ...BUILT_IN_SOURCE_CONFIG,
        webSearch: false,
      });
    });

    await act(async () => {
      await result.current.submitMessage("Use these sources");
    });

    const serverConfig = {
      ...BUILT_IN_SOURCE_CONFIG,
      eduSources: false,
    };
    mockedQuery.state = successQuery(
      sessionWithSourceConfig("s1", "Updated answer", serverConfig),
    );
    rerender({ sessionId: "s1" });

    await waitFor(() => expect(result.current.sourceConfig).toEqual(serverConfig));
  });
});
