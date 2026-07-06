import { chatTransport } from "@/api/chat/transport";
import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import type { SseFrame } from "@/api/chat/types";
import { jsonResponse, emptyResponse } from "@/test/render-app";

const cursorKey = "counselle:cursor:session-1";

function frame(type: string, data: unknown, id?: string) {
  return `${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify({
    v: 1,
    type,
    data,
  })}\n\n`;
}

function sseResponse(...frames: string[]) {
  return new Response(frames.join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collect(stream: AsyncIterable<SseFrame>) {
  const frames: SseFrame[] = [];
  for await (const item of stream) {
    frames.push(item);
  }
  return frames;
}

describe("chatTransport", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("gets chat config from /v1/config", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        greeting: "Welcome",
        season_note: null,
        conversation_starters: [],
        default_source_config: null,
      }),
    );

    await expect(chatTransport.getChatConfig()).resolves.toMatchObject({
      greeting: "Welcome",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/v1/config",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("creates a session with source_config", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          session_id: "session-1",
          source_config: {
            web: true,
            edu: true,
            reddit: true,
            reddit_subreddits: null,
          },
        },
        { status: 201 },
      ),
    );

    await chatTransport.createSession({ sourceConfig: BUILT_IN_SOURCE_CONFIG });

    expect(fetch).toHaveBeenCalledWith(
      "/v1/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          source_config: {
            web: true,
            edu: true,
            reddit: true,
            reddit_subreddits: null,
          },
        }),
      }),
    );
  });

  it("lists sessions with cursor and query parameters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        sessions: [
          {
            session_id: "session-1",
            title: "Aid",
            created_at: "2026-07-06T10:00:00Z",
            updated_at: "2026-07-06T10:10:00Z",
            source_config: null,
            is_generating: true,
          },
        ],
        next_cursor: "next",
      }),
    );

    await expect(
      chatTransport.listSessions({ limit: 25, q: " aid ", cursor: "abc" }),
    ).resolves.toMatchObject({
      nextCursor: "next",
      sessions: [{ sessionId: "session-1", title: "Aid", isGenerating: true }],
    });
    expect(fetch).toHaveBeenCalledWith(
      "/v1/sessions?limit=25&q=aid&cursor=abc",
      expect.any(Object),
    );
  });

  it("rejects malformed session list payloads instead of showing an empty fake list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));

    await expect(chatTransport.listSessions()).rejects.toMatchObject({
      kind: "server",
      message: "Session list response was malformed.",
    });
  });

  it("rejects malformed rows inside a session list payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ sessions: [{}], next_cursor: null }),
    );

    await expect(chatTransport.listSessions()).rejects.toMatchObject({
      kind: "server",
      message: "Session list response was malformed.",
    });
  });

  it("rejects malformed source config inside a session list row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        sessions: [
          {
            session_id: "session-1",
            title: "Aid",
            created_at: "2026-07-06T10:00:00Z",
            updated_at: "2026-07-06T10:10:00Z",
            source_config: { web: "yes" },
            is_generating: false,
          },
        ],
        next_cursor: null,
      }),
    );

    await expect(chatTransport.listSessions()).rejects.toMatchObject({
      kind: "server",
      message: "Session list response was malformed.",
    });
  });

  it("hydrates a session transcript", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        session_id: "session-1",
        title: "Aid",
        created_at: "2026-07-06T10:00:00Z",
        updated_at: "2026-07-06T10:10:00Z",
        source_config: null,
        is_generating: false,
        transcript: [{ role: "user", text: "Hi", ts: null, message_id: "u1" }],
      }),
    );

    await expect(chatTransport.getSession("session-1")).resolves.toMatchObject({
      sessionId: "session-1",
      transcript: [{ role: "user", text: "Hi" }],
    });
  });

  it("hydrates a malformed session detail payload without crashing the chat route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        session_id: "session-1",
        title: null,
        created_at: "2026-07-06T10:00:00Z",
        updated_at: "2026-07-06T10:10:00Z",
        source_config: null,
        is_generating: false,
      }),
    );

    await expect(chatTransport.getSession("session-1")).resolves.toMatchObject({
      sessionId: "session-1",
      transcript: [],
    });
  });

  it("rejects malformed session detail metadata instead of showing an empty fake chat", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}));

    await expect(chatTransport.getSession("session-1")).rejects.toMatchObject({
      kind: "server",
      message: "Session response did not match the requested conversation.",
    });
  });

  it("rejects session detail payloads that only include id and transcript", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ session_id: "session-1", transcript: [] }),
    );

    await expect(chatTransport.getSession("session-1")).rejects.toMatchObject({
      kind: "server",
      message: "Session response did not match the requested conversation.",
    });
  });

  it("rejects malformed source config inside session detail metadata", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        session_id: "session-1",
        title: null,
        created_at: "2026-07-06T10:00:00Z",
        updated_at: "2026-07-06T10:10:00Z",
        source_config: {},
        is_generating: false,
        transcript: [],
      }),
    );

    await expect(chatTransport.getSession("session-1")).rejects.toMatchObject({
      kind: "server",
      message: "Session response did not match the requested conversation.",
    });
  });

  it("sends a message and stores then clears Last-Event-ID on terminal events", async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse(
        frame(
          "meta",
          {
            trace_id: "t1",
            session_id: "session-1",
            model: "gemini",
            message_id: "assistant-1",
            user_message_id: "user-1",
          },
          "1",
        ),
        frame("done", { status: "complete" }, "2"),
      ),
    );

    const frames = await collect(
      chatTransport.sendMessage({
        sessionId: "session-1",
        text: " Compare aid ",
        sourceConfig: BUILT_IN_SOURCE_CONFIG,
        signal: controller.signal,
      }),
    );

    expect(frames.map((item) => item.id)).toEqual(["1", "2"]);
    expect(sessionStorage.getItem(cursorKey)).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/v1/sessions/session-1/messages",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          text: "Compare aid",
          source_config: {
            web: true,
            edu: true,
            reddit: true,
            reddit_subreddits: null,
          },
        }),
      }),
    );
  });

  it("includes persisted Last-Event-ID on attach and reports 204 as inactive", async () => {
    sessionStorage.setItem(cursorKey, "7");
    vi.mocked(fetch).mockResolvedValueOnce(emptyResponse({ status: 204 }));

    await expect(
      chatTransport.attachStream({ sessionId: "session-1" }),
    ).resolves.toEqual({ active: false });

    expect(fetch).toHaveBeenCalledWith(
      "/v1/sessions/session-1/stream",
      expect.objectContaining({
        method: "GET",
        headers: { "Last-Event-ID": "7" },
      }),
    );
    expect(sessionStorage.getItem(cursorKey)).toBeNull();
  });

  it("clears cursor before yielding terminal frames", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse(
        frame(
          "meta",
          {
            trace_id: "t1",
            session_id: "session-1",
            model: "gemini",
            message_id: "assistant-1",
            user_message_id: "user-1",
          },
          "1",
        ),
        frame("done", { status: "complete" }, "2"),
      ),
    );

    const iterable = chatTransport.sendMessage({
      sessionId: "session-1",
      text: "Question",
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
    });
    const stream = iterable[Symbol.asyncIterator]();

    await stream.next();
    expect(sessionStorage.getItem(cursorKey)).toBe("1");
    const terminal = await stream.next();
    expect(terminal.value?.data.type).toBe("done");
    expect(sessionStorage.getItem(cursorKey)).toBeNull();
    await stream.return?.();
  });

  it("clears cursor when attach streams end before a terminal event", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse(frame("delta", { text: "partial" }, "9")),
    );

    const result = await chatTransport.attachStream({ sessionId: "session-1" });
    expect(result.active).toBe(true);
    if (!result.active) {
      throw new Error("Expected active stream");
    }

    await expect(collect(result.stream)).rejects.toThrow("terminal event");
    expect(sessionStorage.getItem(cursorKey)).toBeNull();
  });

  it("rejects send streams that end before a terminal event", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse(frame("delta", { text: "partial" }, "1")),
    );

    await expect(
      collect(
        chatTransport.sendMessage({
          sessionId: "session-1",
          text: "Question",
          sourceConfig: BUILT_IN_SOURCE_CONFIG,
        }),
      ),
    ).rejects.toThrow("terminal event");
    expect(sessionStorage.getItem(cursorKey)).toBeNull();
  });

  it("rejects attach streams that end before a terminal event", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse(frame("delta", { text: "partial" }, "1")),
    );

    const result = await chatTransport.attachStream({ sessionId: "session-1" });
    expect(result.active).toBe(true);
    if (!result.active) {
      throw new Error("Expected active stream");
    }

    await expect(collect(result.stream)).rejects.toThrow("terminal event");
    expect(sessionStorage.getItem(cursorKey)).toBeNull();
  });

  it("rejects send streams with a successful response but no body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      collect(
        chatTransport.sendMessage({
          sessionId: "session-1",
          text: "Question",
          sourceConfig: BUILT_IN_SOURCE_CONFIG,
        }),
      ),
    ).rejects.toThrow("did not include a body");
  });

  it("rejects attach streams with a successful response but no body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      chatTransport.attachStream({ sessionId: "session-1" }),
    ).rejects.toThrow("did not include a body");
  });

  it("rejects when a 200 SSE stream emits a protocol error event", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      sseResponse(frame("error", { message: "Stream failed" })),
    );

    await expect(
      chatTransport.streamFirstMessage({
        sessionId: "session-1",
        text: "Question",
        sourceConfig: BUILT_IN_SOURCE_CONFIG,
      }),
    ).rejects.toThrow("Stream failed");
  });

  it.each([
    [
      "meta-only",
      frame(
        "meta",
        {
          trace_id: "t1",
          session_id: "session-1",
          model: "gemini",
          message_id: "assistant-1",
          user_message_id: "user-1",
        },
        "1",
      ),
    ],
    ["delta-only", frame("delta", { text: "partial" }, "1")],
  ])(
    "rejects %s streams that end before a terminal event",
    async (_name, rawFrame) => {
      vi.mocked(fetch).mockResolvedValueOnce(sseResponse(rawFrame));

      await expect(
        chatTransport.streamFirstMessage({
          sessionId: "session-1",
          text: "Question",
          sourceConfig: BUILT_IN_SOURCE_CONFIG,
        }),
      ).rejects.toThrow("terminal event");
    },
  );

  it("renames, deletes, cancels, and writes feedback", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(emptyResponse({ status: 204 }))
      .mockResolvedValueOnce(emptyResponse({ status: 202 }))
      .mockResolvedValueOnce(jsonResponse({ rating: "up" }));

    await chatTransport.renameSession("session-1", "New title");
    await chatTransport.deleteSession("session-1");
    await chatTransport.cancelActiveTurn("session-1");
    await chatTransport.setMessageFeedback({
      sessionId: "session-1",
      messageId: "message-1",
      rating: "up",
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/v1/sessions/session-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "New title" }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/v1/sessions/session-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      "/v1/sessions/session-1/cancel",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "/v1/sessions/session-1/messages/message-1/feedback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ rating: "up" }),
      }),
    );
  });

  it("normalizes blank rename titles before PATCH", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));

    await chatTransport.renameSession("session-1", "   ");

    expect(fetch).toHaveBeenCalledWith(
      "/v1/sessions/session-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "Untitled" }),
      }),
    );
  });
});
