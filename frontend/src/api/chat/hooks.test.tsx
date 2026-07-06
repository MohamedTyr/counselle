import type { PropsWithChildren } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
  chatKeys,
  useChatSession,
  useChatSessions,
  useDeleteChatSession,
  useMessageFeedback,
  useRenameChatSession,
} from "@/api/chat/hooks";
import {
  createTestQueryClient,
  emptyResponse,
  jsonResponse,
} from "@/test/render-app";

function wrapperWithFetch(fetchMock: typeof fetch) {
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return { Wrapper, queryClient };
}

const sessionWire = {
  session_id: "session-1",
  title: "Aid",
  created_at: "2026-07-06T10:00:00Z",
  updated_at: "2026-07-06T10:10:00Z",
  source_config: null,
  is_generating: false,
};

describe("chat query hooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches sessions through the transport query key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        sessions: [sessionWire],
        next_cursor: null,
      }),
    );
    const { Wrapper } = wrapperWithFetch(fetchMock);

    const { result } = renderHook(() => useChatSessions({ q: "aid" }), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sessions[0]?.sessionId).toBe("session-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/sessions?limit=50&q=aid",
      expect.any(Object),
    );
  });

  it("renames cached session list and detail entries after mutation success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const { Wrapper, queryClient } = wrapperWithFetch(fetchMock);
    queryClient.setQueryData(chatKeys.sessions.list({}), {
      sessions: [
        {
          ...sessionWire,
          sessionId: "session-1",
          sourceConfig: {
            webSearch: true,
            eduSources: true,
            reddit: true,
            selectedSubreddits: [
              "r/ApplyingToCollege",
              "r/chanceme",
              "r/financialaid",
              "r/premed",
              "r/csMajors",
            ],
          },
          createdAt: sessionWire.created_at,
          updatedAt: sessionWire.updated_at,
          isGenerating: false,
        },
      ],
      nextCursor: null,
    });
    queryClient.setQueryData(chatKeys.session("session-1"), {
      ...sessionWire,
      sessionId: "session-1",
      sourceConfig: {
        webSearch: true,
        eduSources: true,
        reddit: true,
        selectedSubreddits: [
          "r/ApplyingToCollege",
          "r/chanceme",
          "r/financialaid",
          "r/premed",
          "r/csMajors",
        ],
      },
      createdAt: sessionWire.created_at,
      updatedAt: sessionWire.updated_at,
      transcript: [],
      isGenerating: false,
    });

    const { result } = renderHook(() => useRenameChatSession(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        sessionId: "session-1",
        title: "   ",
      });
    });

    expect(
      queryClient.getQueryData<{ sessions: { title: string | null }[] }>(
        chatKeys.sessions.list({}),
      )?.sessions[0]?.title,
    ).toBe("Untitled");
    expect(
      queryClient.getQueryData<{ title: string | null }>(
        chatKeys.session("session-1"),
      )?.title,
    ).toBe("Untitled");
  });

  it("removes deleted sessions from list cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse());
    const { Wrapper, queryClient } = wrapperWithFetch(fetchMock);
    queryClient.setQueryData(chatKeys.sessions.list({}), {
      sessions: [
        {
          sessionId: "session-1",
          title: "Aid",
          createdAt: sessionWire.created_at,
          updatedAt: sessionWire.updated_at,
          sourceConfig: {
            webSearch: true,
            eduSources: true,
            reddit: true,
            selectedSubreddits: [
              "r/ApplyingToCollege",
              "r/chanceme",
              "r/financialaid",
              "r/premed",
              "r/csMajors",
            ],
          },
          isGenerating: false,
        },
      ],
      nextCursor: null,
    });

    const { result } = renderHook(() => useDeleteChatSession(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync("session-1");
    });

    expect(
      queryClient.getQueryData<{ sessions: unknown[] }>(
        chatKeys.sessions.list({}),
      )?.sessions,
    ).toEqual([]);
  });

  it("updates feedback in session detail cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rating: "up" }));
    const { Wrapper, queryClient } = wrapperWithFetch(fetchMock);
    queryClient.setQueryData(chatKeys.session("session-1"), {
      ...sessionWire,
      sessionId: "session-1",
      createdAt: sessionWire.created_at,
      updatedAt: sessionWire.updated_at,
      sourceConfig: {
        webSearch: true,
        eduSources: true,
        reddit: true,
        selectedSubreddits: [
          "r/ApplyingToCollege",
          "r/chanceme",
          "r/financialaid",
          "r/premed",
          "r/csMajors",
        ],
      },
      transcript: [
        {
          role: "assistant",
          text: "Answer",
          ts: null,
          message_id: "assistant-1",
        },
      ],
      isGenerating: false,
    });

    const { result } = renderHook(() => useMessageFeedback(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        sessionId: "session-1",
        messageId: "assistant-1",
        rating: "up",
      });
    });

    const session = queryClient.getQueryData<{
      transcript: { feedback?: { rating: string } }[];
    }>(chatKeys.session("session-1"));
    expect(session?.transcript[0]?.feedback).toEqual({ rating: "up" });
  });

  it("fetches session detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ...sessionWire,
        transcript: [],
      }),
    );
    const { Wrapper } = wrapperWithFetch(fetchMock);

    const { result } = renderHook(() => useChatSession("session-1"), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sessionId).toBe("session-1");
  });
});
