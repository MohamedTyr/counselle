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
      responseMode: "quick",
    }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    getSession: vi.fn(),
    renameSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    steerMessage: vi.fn().mockResolvedValue({
      status: "queued",
      userMessageId: "steer-1",
    }),
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
      act(async () =>
        result.current.submit("   ", BUILT_IN_SOURCE_CONFIG, "quick"),
      ),
    ).resolves.toEqual({ ok: false });

    expect(transport.createSession).not.toHaveBeenCalled();
  });

  it("creates a session and returns it without streaming from the landing page", async () => {
    const transport = transportMock();
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    await expect(
      act(async () =>
        result.current.submit(
          "  Compare aid at UCLA  ",
          BUILT_IN_SOURCE_CONFIG,
          "quick",
        ),
      ),
    ).resolves.toEqual({
      ok: true,
      sessionId: "session-1",
      responseMode: "quick",
    });

    expect(transport.createSession).toHaveBeenCalledWith({
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
      responseMode: "quick",
    });
    expect(transport.streamFirstMessage).not.toHaveBeenCalled();
    expect(transport.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks duplicate submits while session creation is pending", async () => {
    const created = deferred<{
      sessionId: string;
      sourceConfig: typeof BUILT_IN_SOURCE_CONFIG;
      responseMode: "quick";
    }>();
    const transport = transportMock({
      createSession: vi.fn(() => created.promise),
    });
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    act(() => {
      void result.current.submit("First", BUILT_IN_SOURCE_CONFIG, "quick");
    });
    await waitFor(() => expect(result.current.isSubmitting).toBe(true));

    await act(async () => {
      await expect(
        result.current.submit("Second", BUILT_IN_SOURCE_CONFIG, "quick"),
      ).resolves.toEqual({ ok: false });
    });

    expect(transport.createSession).toHaveBeenCalledTimes(1);
    created.resolve({
      sessionId: "session-1",
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
      responseMode: "quick",
    });
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
  });

  it("returns false when session creation fails", async () => {
    const transport = transportMock({
      createSession: vi.fn().mockRejectedValue(new Error("create failed")),
    });
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    await expect(
      act(async () =>
        result.current.submit("Question", BUILT_IN_SOURCE_CONFIG, "quick"),
      ),
    ).resolves.toEqual({ ok: false });

    expect(result.current.error).toBe("Could not start the conversation.");
  });

  it("does not expose landing-page cancellation because the chat page owns the stream", async () => {
    const transport = transportMock();
    const { result } = renderHook(() => useComposerStartTurn({ transport }));

    await act(async () => {
      await result.current.cancel();
    });
    expect(transport.cancelActiveTurn).not.toHaveBeenCalled();
    expect(result.current.canCancel).toBe(false);
  });
});
