import type { PropsWithChildren } from "react";
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createTestQueryClient } from "@/test/render-app";
import { TransportError } from "@/api/http/errors";
import type {
  ChatTransport,
  ProtocolEvent,
  SourceConfig,
  SseFrame,
} from "@/api/chat/types";

import { useTurnEngine } from "./useTurnEngine";
import type { ChatMessage } from "./model";

function sourceConfig(): SourceConfig {
  return {
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
  };
}

function meta(
  messageId = "a1",
  userMessageId = "u1",
  sessionId = "s1",
): ProtocolEvent {
  return {
    v: 1,
    type: "meta",
    data: {
      trace_id: "trace-1",
      session_id: sessionId,
      model: "test-model",
      message_id: messageId,
      user_message_id: userMessageId,
    },
  };
}

function delta(text: string): ProtocolEvent {
  return { v: 1, type: "delta", data: { text } };
}

function done(
  status: "complete" | "cancelled" | "awaiting_input" = "complete",
): ProtocolEvent {
  return { v: 1, type: "done", data: { status } };
}

function userMessageEvent(
  text: string,
  userMessageId = "steer-1",
  injected = true,
): ProtocolEvent {
  return {
    v: 1,
    type: "user_message",
    data: { text, user_message_id: userMessageId, injected },
  };
}

async function* stream(
  events: ProtocolEvent[],
): AsyncGenerator<SseFrame<ProtocolEvent>, void, undefined> {
  for (const event of events) {
    yield { data: event };
  }
}

async function* streamThenThrow(
  events: ProtocolEvent[],
  error: Error,
): AsyncGenerator<SseFrame<ProtocolEvent>, void, undefined> {
  for (const event of events) {
    yield { data: event };
  }
  throw error;
}

function gatedStream(events: ProtocolEvent[]) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  async function* iterable(): AsyncGenerator<SseFrame<ProtocolEvent>, void, undefined> {
    await gate;
    yield* stream(events);
  }

  return { release, iterable: iterable() };
}

function user(messageId: string, conversationId = "s1"): ChatMessage {
  return {
    kind: "user",
    messageId,
    conversationId,
    parentMessageId: null,
    text: "Question",
    isCreatedByUser: true,
    sender: "",
    hasBackendId: true,
    ts: "2026-07-06T12:00:00Z",
  };
}

function assistant(messageId: string, conversationId = "s1"): ChatMessage {
  return {
    kind: "assistant",
    messageId,
    conversationId,
    parentMessageId: "u1",
    text: "Old",
    isCreatedByUser: false,
    sender: "Counselle",
    blocks: [{ kind: "markdown", text: "Old" }],
    runMarkdown: "Old",
    segments: [{ type: "answer", text: "Old" }],
    turnStatus: "complete",
    hasBackendId: true,
    ts: "2026-07-06T12:00:01Z",
  };
}

function createTransport(overrides: Partial<ChatTransport> = {}): ChatTransport {
  return {
    getChatConfig: vi.fn(),
    createSession: vi.fn(async () => ({
      sessionId: "created-session",
      sourceConfig: sourceConfig(),
    })),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
    sendMessage: vi.fn(() => stream([meta(), delta("final"), done()])),
    steerMessage: vi.fn(async () => ({
      status: "queued" as const,
      userMessageId: "steer-1",
    })),
    attachStream: vi.fn(async () => ({ active: false as const })),
    streamFirstMessage: vi.fn(),
    cancelActiveTurn: vi.fn(),
    setMessageFeedback: vi.fn(),
    ...overrides,
  };
}

function renderEngine({
  sessionId = "s1",
  initialMessages = [],
  transport = createTransport(),
  cancelWaitTimeoutMs,
  onSendStart,
}: {
  sessionId?: string | null;
  initialMessages?: ChatMessage[];
  transport?: ChatTransport;
  cancelWaitTimeoutMs?: number;
  onSendStart?: () => void;
} = {}) {
  const queryClient = createTestQueryClient();
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  const { result, unmount } = renderHook(
    () => {
      const [persistedMessages, setPersistedMessages] =
        useState(initialMessages);
      return useTurnEngine({
        sessionId,
        sourceConfig: sourceConfig(),
        persistedMessages,
        setPersistedMessages,
        transport,
        cancelWaitTimeoutMs,
        onSendStart,
      });
    },
    { wrapper: Wrapper },
  );

  return { result, transport, unmount };
}

describe("useTurnEngine", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test("send appends optimistic user, reconciles meta ids, and persists one assistant", async () => {
    const transport = createTransport({
      sendMessage: vi.fn(() => stream([meta("a1", "u1"), delta("final"), done()])),
    });
    const onSendStart = vi.fn();
    const { result } = renderEngine({ transport, onSendStart });

    await act(async () => {
      await result.current.submitMessage("Tell me about MIT.");
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      kind: "user",
      messageId: "u1",
      hasBackendId: true,
    });
    expect(result.current.messages[1]).toMatchObject({
      kind: "assistant",
      messageId: "a1",
      text: "final",
      turnStatus: "complete",
      hasBackendId: true,
    });
    expect(onSendStart).toHaveBeenCalledTimes(1);
  });

  test("pre-meta failure keeps text and does not create an assistant card", async () => {
    const transport = createTransport({
      sendMessage: vi.fn(() => streamThenThrow([], new Error("offline"))),
    });
    const { result } = renderEngine({ transport });

    let sent;
    await act(async () => {
      sent = await result.current.submitMessage("Keep me");
    });

    expect(sent).toEqual({ ok: false, keepText: "Keep me" });
    expect(result.current.pendingText).toBe("Keep me");
    expect(result.current.messages.filter((message) => message.kind === "assistant")).toEqual([]);
  });

  test("post-meta failure persists one partial errored assistant card", async () => {
    const transport = createTransport({
      sendMessage: vi.fn(() =>
        streamThenThrow([meta("a1", "u1"), delta("partial")], new Error("closed")),
      ),
    });
    const { result } = renderEngine({ transport });

    let sent;
    await act(async () => {
      sent = await result.current.submitMessage("Question");
    });

    expect(sent).toEqual({ ok: true, sessionId: "s1" });
    expect(result.current.pendingText).toBeNull();
    expect(result.current.messages.at(-1)).toMatchObject({
      kind: "assistant",
      messageId: "a1",
      text: "partial",
      turnStatus: "error",
    });
  });

  test("attach replay replaces an accepted-then-failed persisted error card", async () => {
    const transport = createTransport({
      attachStream: vi.fn(async () => ({
        active: true,
        stream: stream([meta("a1", "u1"), delta("final"), done()]),
      })),
    });
    const errored = {
      ...assistant("a1"),
      text: "partial",
      blocks: [{ kind: "markdown" as const, text: "partial" }],
      turnStatus: "error" as const,
    };
    const { result } = renderEngine({
      transport,
      initialMessages: [user("u1"), errored],
    });

    await act(async () => {
      await result.current.attachActiveTurn("s1");
    });

    const assistants = result.current.messages.filter(
      (message) => message.kind === "assistant",
    );
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({
      messageId: "a1",
      text: "final",
      turnStatus: "complete",
    });
  });

  test("send while streaming steers instead of cancelling the active turn", async () => {
    const first = gatedStream([meta("a1", "u1"), delta("first"), done()]);
    const transport = createTransport({
      sendMessage: vi
        .fn()
        .mockReturnValueOnce(first.iterable),
      steerMessage: vi.fn(async () => ({
        status: "queued",
        userMessageId: "steer-1",
      })),
      cancelActiveTurn: vi.fn(),
    });
    const { result } = renderEngine({ transport });

    act(() => {
      void result.current.submitMessage("First");
    });

    await waitFor(() => expect(result.current.liveTurn).not.toBeNull());

    await act(async () => {
      await result.current.submitMessage("Second");
    });

    expect(transport.steerMessage).toHaveBeenCalledWith({
      sessionId: "s1",
      text: "Second",
    });
    expect(transport.cancelActiveTurn).not.toHaveBeenCalled();
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    first.release();
  });

  test("idle steer fallback sends a normal next turn after the live stream settles", async () => {
    const first = gatedStream([meta("a1", "u1"), delta("first"), done()]);
    const transport = createTransport({
      sendMessage: vi
        .fn()
        .mockReturnValueOnce(first.iterable)
        .mockReturnValueOnce(stream([meta("a2", "u2"), delta("second"), done()])),
      steerMessage: vi.fn(async () => ({ status: "idle" })),
      cancelActiveTurn: vi.fn(),
    });
    const { result } = renderEngine({ transport });

    act(() => {
      void result.current.submitMessage("First");
    });
    await waitFor(() => expect(result.current.liveTurn).not.toBeNull());

    let second!: Promise<unknown>;
    act(() => {
      second = result.current.submitMessage("Second");
    });
    first.release();
    await act(async () => {
      await second;
    });

    expect(transport.cancelActiveTurn).not.toHaveBeenCalled();
    expect(transport.sendMessage).toHaveBeenCalledTimes(2);
    expect(result.current.messages.at(-1)).toMatchObject({
      kind: "assistant",
      messageId: "a2",
      text: "second",
    });
  });

  test("409 send conflict cancels and retries once", async () => {
    const transport = createTransport({
      sendMessage: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new TransportError("conflict", "busy");
        })
        .mockReturnValueOnce(stream([meta("a1", "u1"), delta("retried"), done()])),
      cancelActiveTurn: vi.fn(),
    });
    const { result } = renderEngine({ transport });

    await act(async () => {
      await result.current.submitMessage("Retry");
    });

    expect(transport.cancelActiveTurn).toHaveBeenCalledWith("s1");
    expect(transport.sendMessage).toHaveBeenCalledTimes(2);
    expect(result.current.messages.at(-1)).toMatchObject({ text: "retried" });
  });

  test("409 after creating a first session retries against the created session", async () => {
    const transport = createTransport({
      createSession: vi.fn(async () => ({
        sessionId: "created-session",
        sourceConfig: sourceConfig(),
      })),
      sendMessage: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new TransportError("conflict", "busy");
        })
        .mockReturnValueOnce(
          stream([meta("a1", "u1", "created-session"), delta("retried"), done()]),
        ),
      cancelActiveTurn: vi.fn(),
    });
    const { result } = renderEngine({ sessionId: null, transport });

    await act(async () => {
      await result.current.submitMessage("Retry");
    });

    expect(transport.createSession).toHaveBeenCalledTimes(1);
    expect(transport.cancelActiveTurn).toHaveBeenCalledWith("created-session");
    expect(transport.sendMessage).toHaveBeenCalledTimes(2);
    expect(result.current.messages.at(-1)).toMatchObject({ text: "retried" });
  });

  test("replace send hides the stale transcript branch while streaming", async () => {
    const replacement = gatedStream([
      meta("replacement", "u1"),
      delta("new answer"),
      done(),
    ]);
    const transport = createTransport({
      sendMessage: vi.fn().mockReturnValue(replacement.iterable),
    });
    const { result } = renderEngine({
      transport,
      initialMessages: [user("u1"), assistant("old-answer"), user("u2")],
    });

    let send!: Promise<unknown>;
    act(() => {
      send = result.current.submitMessage("Edited question", "u1");
    });
    await waitFor(() => expect(result.current.liveTurn).not.toBeNull());

    expect(result.current.messages.map((message) => message.messageId)).toEqual(
      ["u1", expect.stringMatching(/^temp-asst-/)],
    );

    replacement.release();
    await act(async () => {
      await send;
    });
  });

  test("failed replace retry keeps the replace target", async () => {
    const transport = createTransport({
      sendMessage: vi
        .fn()
        .mockImplementationOnce(() => streamThenThrow([], new Error("offline")))
        .mockReturnValueOnce(stream([meta("a2", "u1"), delta("edited"), done()])),
    });
    const { result } = renderEngine({
      transport,
      initialMessages: [user("u1"), assistant("a1")],
    });

    await act(async () => {
      await result.current.submitMessage("Edited question", "u1");
    });
    expect(result.current.pendingText).toBe("Edited question");

    await act(async () => {
      result.current.retryLastSend();
    });
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        messageId: "a2",
        text: "edited",
      }),
    );

    expect(transport.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: "Edited question",
        replaceMessageId: "u1",
      }),
    );
  });

  test("replace send still cancels an active turn before editing", async () => {
    const first = gatedStream([meta("a1", "u1"), delta("first"), done()]);
    const transport = createTransport({
      sendMessage: vi.fn().mockReturnValue(first.iterable),
      cancelActiveTurn: vi.fn(async () => undefined),
    });
    const { result } = renderEngine({
      transport,
      cancelWaitTimeoutMs: 1,
    });

    act(() => {
      void result.current.submitMessage("First");
    });
    await waitFor(() => expect(result.current.liveTurn).not.toBeNull());

    let second: Promise<unknown>;
    act(() => {
      second = result.current.submitMessage("Edited", "u1");
    });
    await act(async () => {
      await second;
    });

    expect(result.current.pendingText).toBe("Edited");
    expect(result.current.turnError?.message).toBe(
      "Couldn't stop the previous response. Try again.",
    );
    expect(transport.cancelActiveTurn).toHaveBeenCalledWith("s1");
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    first.release();
  });

  test("injected false user_message is auto-forwarded once as a normal next turn", async () => {
    const transport = createTransport({
      sendMessage: vi
        .fn()
        .mockReturnValueOnce(
          stream([
            meta("a1", "u1"),
            delta("first"),
            userMessageEvent("Second", "steer-late", false),
            done(),
          ]),
        )
        .mockReturnValueOnce(stream([meta("a2", "u2"), delta("second"), done()])),
    });
    const { result } = renderEngine({ transport });

    await act(async () => {
      await result.current.submitMessage("First");
    });

    await waitFor(() => expect(transport.sendMessage).toHaveBeenCalledTimes(2));
    expect(transport.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: "Second" }),
    );
    const firstAssistant = result.current.messages.find(
      (message) => message.kind === "assistant" && message.messageId === "a1",
    );
    expect(firstAssistant).toMatchObject({
      kind: "assistant",
      segments: [{ type: "answer", text: "first" }],
    });
    expect(result.current.messages.at(-1)).toMatchObject({
      kind: "assistant",
      messageId: "a2",
      text: "second",
    });
  });

  test("retry after replace cancel timeout does not delete the first user turn", async () => {
    const first = gatedStream([meta("a1", "u1"), delta("first"), done()]);
    const transport = createTransport({
      sendMessage: vi
        .fn()
        .mockReturnValueOnce(first.iterable)
        .mockReturnValueOnce(stream([meta("a2", "u2"), delta("second"), done()])),
      cancelActiveTurn: vi.fn(async () => undefined),
    });
    const { result } = renderEngine({
      transport,
      cancelWaitTimeoutMs: 1,
    });

    let firstSend: Promise<unknown>;
    act(() => {
      firstSend = result.current.submitMessage("First");
    });
    await waitFor(() => expect(result.current.liveTurn).not.toBeNull());

    await act(async () => {
      await result.current.submitMessage("Edited", "u1");
    });

    first.release();
    await act(async () => {
      await firstSend;
    });
    await act(async () => {
      result.current.retryLastSend();
    });
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        messageId: "a2",
        text: "second",
      }),
    );

    const userMessages = result.current.messages.filter(
      (message) => message.kind === "user",
    );
    expect(userMessages.map((message) => message.text)).toEqual([
      "First",
    ]);
  });

  test("attach opening failure silently degrades, leaving the loaded transcript in place", async () => {
    const transport = createTransport({
      attachStream: vi.fn(async () => {
        throw new TransportError("network", "offline");
      }),
    });
    const { result } = renderEngine({
      transport,
      initialMessages: [user("u1"), assistant("a1")],
    });

    await act(async () => {
      await result.current.attachActiveTurn("s1");
    });

    // Old behavior (clone fidelity): an attach-OPEN failure is an ordinary
    // network hiccup on an already-complete conversation -- it must not
    // surface an error banner or disturb the loaded transcript.
    expect(result.current.turnError).toBeNull();
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages.at(-1)).toMatchObject({
      messageId: "a1",
      turnStatus: "complete",
    });
  });

  test("attach failure mid-accepted-stream (after meta) still surfaces an error", async () => {
    // Distinct from the attach-OPEN failure above: once the attach stream is
    // accepted (open succeeded) and starts emitting events, a failure while
    // consuming it is a real interrupted turn and must be surfaced -- same
    // as the post-meta send failure path.
    const transport = createTransport({
      attachStream: vi.fn(async () => ({
        active: true,
        stream: streamThenThrow(
          [meta("a1", "u1"), delta("partial")],
          new Error("closed"),
        ),
      })),
    });
    const { result } = renderEngine({
      transport,
      initialMessages: [user("u1")],
    });

    await act(async () => {
      await result.current.attachActiveTurn("s1");
    });

    expect(result.current.messages.at(-1)).toMatchObject({
      kind: "assistant",
      messageId: "a1",
      text: "partial",
      turnStatus: "error",
    });
  });

  test("stopGenerating settles the active turn to cancelled state", async () => {
    const active = gatedStream([meta("a1", "u1"), delta("partial"), done("cancelled")]);
    const transport = createTransport({
      sendMessage: vi.fn().mockReturnValue(active.iterable),
      cancelActiveTurn: vi.fn(async () => undefined),
    });
    const { result } = renderEngine({ transport });

    act(() => {
      void result.current.submitMessage("First");
    });
    await waitFor(() => expect(result.current.liveTurn).not.toBeNull());

    act(() => {
      result.current.stopGenerating();
    });
    await waitFor(() => expect(transport.cancelActiveTurn).toHaveBeenCalledWith("s1"));

    active.release();
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        kind: "assistant",
        messageId: "a1",
        turnStatus: "cancelled",
      }),
    );
  });

  test("clarify event followed by awaiting_input pauses the turn, and a normal composer submit resumes it as the clarify answer", async () => {
    const clarifySpec = {
      v: 1,
      question: "Which campus?",
      header: "Pick one",
      multi_select: false,
      options: [
        { label: "Main", hint: "" },
        { label: "Satellite", hint: "" },
      ],
    };
    const transport = createTransport({
      sendMessage: vi
        .fn()
        .mockReturnValueOnce(
          stream([
            meta("a1", "u1"),
            { v: 1, type: "clarify", data: clarifySpec },
            done("awaiting_input"),
          ]),
        )
        .mockReturnValueOnce(
          stream([meta("a2", "u2"), delta("final answer"), done()]),
        ),
    });
    const { result } = renderEngine({ transport });

    await act(async () => {
      await result.current.submitMessage("What's the best campus?");
    });

    expect(result.current.awaitingClarify).toBe(true);
    expect(result.current.messages.at(-1)).toMatchObject({
      kind: "assistant",
      messageId: "a1",
      turnStatus: "awaiting_input",
      clarify: clarifySpec,
    });

    // A normal composer submit while awaiting clarify is accepted as the
    // clarify answer -- no special "answer" API, just the regular send path.
    await act(async () => {
      await result.current.submitMessage("Main");
    });

    expect(result.current.awaitingClarify).toBe(false);
    expect(result.current.messages.at(-1)).toMatchObject({
      kind: "assistant",
      messageId: "a2",
      text: "final answer",
      turnStatus: "complete",
    });
  });

  test("submitMessage refuses a replaceMessageId that is still a temp/optimistic id", async () => {
    const transport = createTransport();
    const { result } = renderEngine({
      transport,
      initialMessages: [user("temp-user-abc"), assistant("temp-asst-abc")],
    });

    let sent;
    await act(async () => {
      sent = await result.current.submitMessage(
        "Regenerate this",
        "temp-user-abc",
      );
    });

    expect(sent).toEqual({ ok: false, keepText: "Regenerate this" });
    expect(transport.sendMessage).not.toHaveBeenCalled();
  });

  test("submitMessage threads an AbortSignal into sendMessage, and unmount aborts it", async () => {
    const first = gatedStream([meta("a1", "u1"), delta("first"), done()]);
    const transport = createTransport({
      sendMessage: vi.fn().mockReturnValue(first.iterable),
    });
    const { result, unmount } = renderEngine({ transport });

    act(() => {
      void result.current.submitMessage("First");
    });
    await waitFor(() => expect(result.current.liveTurn).not.toBeNull());

    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    const sentInput = (transport.sendMessage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(sentInput.signal).toBeInstanceOf(AbortSignal);
    expect(sentInput.signal.aborted).toBe(false);

    unmount();

    expect(sentInput.signal.aborted).toBe(true);
    first.release();
  });

  test("attachActiveTurn threads an AbortSignal into attachStream", async () => {
    const attachStream = vi.fn<ChatTransport["attachStream"]>(async () => ({
      active: true,
      stream: stream([meta("a1", "u1"), delta("final"), done()]),
    }));
    const transport = createTransport({ attachStream });
    const { result } = renderEngine({ transport });

    await act(async () => {
      await result.current.attachActiveTurn("s1");
    });

    expect(attachStream).toHaveBeenCalledTimes(1);
    const attachInput = attachStream.mock.calls[0]?.[0];
    if (attachInput === undefined) {
      throw new Error("attachStream was not called");
    }
    expect(attachInput.signal).toBeInstanceOf(AbortSignal);
  });

  test("missing terminal event with meta seen classifies as a network error and persists a partial errored assistant", async () => {
    // Regression test for clone fidelity: the missing-terminal case used to
    // throw a plain Error, which turnErrorOf misclassified as kind:"stream".
    // It must throw a TransportError("network", ...) so it classifies the
    // same way the old code did.
    const transport = createTransport({
      // No `done`/`error` event is ever emitted -- the generator just ends.
      sendMessage: vi.fn(() => stream([meta("a1", "u1"), delta("partial")])),
    });
    const { result } = renderEngine({ transport });

    let sent;
    await act(async () => {
      sent = await result.current.submitMessage("Question");
    });

    expect(sent).toEqual({ ok: true, sessionId: "s1" });
    expect(result.current.turnError).toMatchObject({ kind: "network" });
    expect(result.current.messages.at(-1)).toMatchObject({
      kind: "assistant",
      messageId: "a1",
      text: "partial",
      turnStatus: "error",
    });
  });

  test("missing terminal event with no meta seen restores the composer text", async () => {
    const transport = createTransport({
      // No events at all, and never a done/error terminal frame.
      sendMessage: vi.fn(() => stream([])),
    });
    const { result } = renderEngine({ transport });

    let sent;
    await act(async () => {
      sent = await result.current.submitMessage("Keep me");
    });

    expect(sent).toEqual({ ok: false, keepText: "Keep me" });
    expect(result.current.pendingText).toBe("Keep me");
    expect(result.current.turnError).toMatchObject({ kind: "network" });
    expect(
      result.current.messages.filter((message) => message.kind === "assistant"),
    ).toEqual([]);
  });
});
