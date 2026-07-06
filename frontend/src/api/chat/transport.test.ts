import { chatTransport } from "@/api/chat/transport"
import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config"
import { jsonResponse, emptyResponse } from "@/test/render-app"

function sseResponse() {
  return new Response(
    'id: 1\nevent: meta\ndata: {"v":1,"type":"meta","data":{"message_id":"assistant-1"}}\n\nid: 2\nevent: done\ndata: {"v":1,"type":"done","data":{"status":"complete"}}\n\n',
    {
      headers: { "Content-Type": "text/event-stream" },
    },
  )
}

describe("chatTransport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })

  it("gets chat config from /v1/config", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        greeting: "Welcome",
        season_note: null,
        conversation_starters: [],
        default_source_config: null,
      }),
    )

    await expect(chatTransport.getChatConfig()).resolves.toMatchObject({
      greeting: "Welcome",
    })
    expect(fetch).toHaveBeenCalledWith(
      "/v1/config",
      expect.objectContaining({ credentials: "same-origin" }),
    )
  })

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
    )

    await chatTransport.createSession({ sourceConfig: BUILT_IN_SOURCE_CONFIG })

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
    )
  })

  it("streams the first message with caller-owned abort signal", async () => {
    const controller = new AbortController()
    vi.mocked(fetch).mockResolvedValueOnce(sseResponse())

    await chatTransport.streamFirstMessage({
      sessionId: "session-1",
      text: " Compare aid ",
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
      signal: controller.signal,
    })

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
    )
  })

  it("rejects when a 200 SSE stream emits a protocol error event", async () => {
    const controller = new AbortController()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        'event: error\ndata: {"v":1,"type":"error","data":{"message":"Stream failed"}}\n\n',
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    )

    await expect(
      chatTransport.streamFirstMessage({
        sessionId: "session-1",
        text: "Question",
        sourceConfig: BUILT_IN_SOURCE_CONFIG,
        signal: controller.signal,
      }),
    ).rejects.toThrow("Stream failed")
  })

  it("cancels the active turn", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(emptyResponse({ status: 202 }))

    await chatTransport.cancelActiveTurn("session-1")

    expect(fetch).toHaveBeenCalledWith(
      "/v1/sessions/session-1/cancel",
      expect.objectContaining({ method: "POST" }),
    )
  })
})
