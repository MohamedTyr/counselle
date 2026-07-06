import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import {
  createWorkspaceFetchPreset,
  jsonResponse,
  renderApp,
} from "@/test/render-app"

function aiFetchHandler(
  input: RequestInfo | URL,
  init?: RequestInit,
): Response | Promise<Response> {
  const url = String(input)

  if (url.endsWith("/v1/config")) {
    return jsonResponse({
      greeting: "What should we untangle first?",
      season_note: "Ignored here",
      conversation_starters: ["Compare UCLA and Berkeley"],
      default_source_config: {
        web: true,
        edu: false,
        reddit: true,
        reddit_subreddits: null,
      },
    })
  }
  if (url.endsWith("/v1/sessions") && init?.method === "POST") {
    return jsonResponse(
      {
        session_id: "60000000-0000-4000-8000-000000000001",
        source_config: {
          web: true,
          edu: false,
          reddit: true,
          reddit_subreddits: null,
        },
      },
      { status: 201 },
    )
  }
  if (
    url.endsWith(
      "/v1/sessions/60000000-0000-4000-8000-000000000001/messages",
    ) &&
    init?.method === "POST"
  ) {
    return new Response(
      'event: done\ndata: {"v":1,"type":"done","data":{"status":"complete"}}\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    )
  }

  return createWorkspaceFetchPreset()(input, init)
}

describe("AiComposerRoute", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/")
    window.innerWidth = 1280
  })

  it("redirects /app to /app/ai and marks the AI nav item active", async () => {
    renderApp("/app", { fetchHandler: aiFetchHandler })

    await waitFor(() => expect(window.location.pathname).toBe("/app/ai"))
    expect(
      await screen.findByRole("heading", {
        name: "What should we untangle first?",
      }),
    ).toBeInTheDocument()

    const aiLink = screen.getByRole("link", { name: "AI" })
    expect(aiLink.closest('[data-slot="sidebar-menu-button"]')).toHaveAttribute(
      "data-active",
      "true",
    )
  })

  it("does not flash fallback greeting while config is loading", async () => {
    let resolveConfig!: (response: Response) => void
    const configPromise = new Promise<Response>((resolve) => {
      resolveConfig = resolve
    })
    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        const url = String(input)
        if (url.endsWith("/v1/config")) {
          return configPromise
        }
        return createWorkspaceFetchPreset()(input, init)
      },
    })

    expect(
      screen.queryByRole("heading", { name: "Where should we begin?" }),
    ).not.toBeInTheDocument()

    resolveConfig(
      jsonResponse({
        greeting: "Ready when you are.",
        season_note: null,
        conversation_starters: [],
        default_source_config: null,
      }),
    )

    expect(
      await screen.findByRole("heading", { name: "Ready when you are." }),
    ).toBeInTheDocument()
  })

  it("shows fallback greeting only after config failure", async () => {
    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        const url = String(input)
        if (url.endsWith("/v1/config")) {
          return jsonResponse({ error: { message: "failed" } }, { status: 500 })
        }
        return createWorkspaceFetchPreset()(input, init)
      },
    })

    expect(
      await screen.findByRole("heading", { name: "Where should we begin?" }),
    ).toBeInTheDocument()
  })

  it("submits on Enter and inserts a newline on Shift+Enter", async () => {
    const user = userEvent.setup()
    const requests: { url: string; body: unknown }[] = []

    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        const url = String(input)
        if (init?.body) {
          requests.push({ url, body: JSON.parse(String(init.body)) })
        }
        return aiFetchHandler(input, init)
      },
    })

    const textarea = await screen.findByRole("textbox", {
      name: "Message Counselle",
    })
    await waitFor(() => expect(textarea).not.toBeDisabled())

    await user.type(textarea, "Compare aid")
    await user.keyboard("{Shift>}{Enter}{/Shift}")
    expect(textarea).toHaveValue("Compare aid\n")

    await user.type(textarea, "at UCLA{Enter}")

    await waitFor(() =>
      expect(
        requests.find((request) => request.url.endsWith("/messages"))?.body,
      ).toEqual({
        text: "Compare aid\nat UCLA",
        source_config: {
          web: true,
          edu: false,
          reddit: true,
          reddit_subreddits: null,
        },
      }),
    )
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/app/ai/60000000-0000-4000-8000-000000000001",
      ),
    )
    expect(textarea).toHaveValue("")
  })

  it("renders source toggles in the composer action row", async () => {
    renderApp("/app/ai", { fetchHandler: aiFetchHandler })
    await screen.findByRole("heading", {
      name: "What should we untangle first?",
    })

    const form = await screen.findByRole("form", {
      name: "Start an AI conversation",
    })

    expect(
      within(form).getByRole("button", { name: "Web search" }),
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      within(form).getByRole("button", { name: ".edu sources" }),
    ).toHaveAttribute("aria-pressed", "false")
    expect(
      within(form).getByRole("button", { name: "Reddit communities" }),
    ).toHaveAttribute("aria-pressed", "true")
  })
})
