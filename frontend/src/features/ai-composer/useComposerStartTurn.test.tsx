import { act, renderHook, waitFor } from "@testing-library/react";

import type { ChatTransport } from "@/api/chat/types";
import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import { useComposerStartTurn } from "@/features/ai-composer/useComposerStartTurn";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function transportMock(overrides: Partial<ChatTransport> = {}): ChatTransport {
  return {
    getChatConfig: vi.fn(),
    createSession: vi.fn().mockResolvedValue({
      sessionId: "session-1",
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
    }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    getSession: vi.fn(),
    renameSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    attachStream: vi.fn().mockResolvedValue({ active: false }),
    streamFirstMessage: vi.fn().mockResolvedValue({ accepted: true }),
    cancelActiveTurn: vi.fn().mockResolvedValue(undefined),
    setMessageFeedback: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("useComposerStartTurn", () => {
  it("ignores empty and whitespace submits", async () => {
    const transport = transportMock();
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    await expect(
      act(async () => result.current.submit("   ", BUILT_IN_SOURCE_CONFIG)),
    ).resolves.toEqual({ ok: false });

    expect(transport.createSession).not.toHaveBeenCalled();
  });

  it("creates a session before streaming the first message", async () => {
    const transport = transportMock();
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    await expect(
      act(async () =>
        result.current.submit(
          "  Compare aid at UCLA  ",
          BUILT_IN_SOURCE_CONFIG,
        ),
      ),
    ).resolves.toEqual({ ok: true, sessionId: "session-1" });

    expect(transport.createSession).toHaveBeenCalledWith({
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
    });
    expect(transport.streamFirstMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        text: "Compare aid at UCLA",
        sourceConfig: BUILT_IN_SOURCE_CONFIG,
      }),
    );
    expect(
      vi.mocked(transport.createSession).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(transport.streamFirstMessage).mock.invocationCallOrder[0]!,
    );
  });

  it("blocks duplicate submits while a stream is pending", async () => {
    const stream = deferred<{ accepted: boolean }>();
    const transport = transportMock({
      streamFirstMessage: vi.fn(() => stream.promise),
    });
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    act(() => {
      void result.current.submit("First", BUILT_IN_SOURCE_CONFIG);
    });
    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    await act(async () => {
      await expect(
        result.current.submit("Second", BUILT_IN_SOURCE_CONFIG),
      ).resolves.toEqual({ ok: false });
    });

    expect(transport.createSession).toHaveBeenCalledTimes(1);
    stream.resolve({ accepted: true });
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
  });

  it("returns false when session creation fails", async () => {
    const transport = transportMock({
      createSession: vi.fn().mockRejectedValue(new Error("create failed")),
    });
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    await expect(
      act(async () =>
        result.current.submit("Question", BUILT_IN_SOURCE_CONFIG),
      ),
    ).resolves.toEqual({ ok: false });

    expect(result.current.error).toBe("Could not start the conversation.");
  });

  it("returns false when pre-stream send fails", async () => {
    const transport = transportMock({
      streamFirstMessage: vi.fn().mockRejectedValue(new Error("send failed")),
    });
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    await expect(
      act(async () =>
        result.current.submit("Question", BUILT_IN_SOURCE_CONFIG),
      ),
    ).resolves.toEqual({ ok: false });

    expect(result.current.error).toBe("Could not send that message.");
  });

  it("cancels only when an active session has a stream", async () => {
    const stream = deferred<{ accepted: boolean }>();
    const transport = transportMock({
      streamFirstMessage: vi.fn(() => stream.promise),
    });
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    await act(async () => {
      await result.current.cancel();
    });
    expect(transport.cancelActiveTurn).not.toHaveBeenCalled();

    act(() => {
      void result.current.submit("Question", BUILT_IN_SOURCE_CONFIG);
    });
    await waitFor(() => expect(result.current.canCancel).toBe(true));

    await act(async () => {
      await result.current.cancel();
    });

    expect(transport.cancelActiveTurn).toHaveBeenCalledWith("session-1");
    stream.resolve({ accepted: true });
  });

  it("maps cancel failures to hook error state", async () => {
    const stream = deferred<{ accepted: boolean }>();
    const transport = transportMock({
      streamFirstMessage: vi.fn(() => stream.promise),
      cancelActiveTurn: vi.fn().mockRejectedValue(new Error("cancel failed")),
    });
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    act(() => {
      void result.current.submit("Question", BUILT_IN_SOURCE_CONFIG);
    });
    await waitFor(() => expect(result.current.canCancel).toBe(true));

    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.error).toBe("Could not stop the response.");
    stream.resolve({ accepted: true });
  });
});
