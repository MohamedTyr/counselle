import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  createWorkspaceFetchPreset,
  jsonResponse,
  renderApp,
} from "@/test/render-app";

const skillModes = [
  {
    name: "focused-answer",
    display_name: "Focused Answer",
    description: "Clear, direct help.",
    order: 10,
    default: true,
  },
  {
    name: "deep-research",
    display_name: "Deep Research",
    description: "Investigate carefully.",
    order: 20,
    default: false,
  },
  {
    name: "guided-counselor",
    display_name: "Guided Counselor",
    description: "Work through it together.",
    order: 30,
    default: false,
  },
];

function aiFetchHandler(
  input: RequestInfo | URL,
  init?: RequestInit,
): Response | Promise<Response> {
  const url = String(input);

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
      skills: [
        {
          name: "school-comparison",
          display_name: "School comparison",
          description: "Compare schools side by side.",
        },
      ],
      max_selected_skills: 3,
    });
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
    );
  }
  if (
    url.endsWith("/v1/sessions/60000000-0000-4000-8000-000000000001") &&
    (!init?.method || init.method === "GET")
  ) {
    return jsonResponse({
      session_id: "60000000-0000-4000-8000-000000000001",
      title: null,
      created_at: "2026-07-06T10:00:00Z",
      source_config: {
        web: true,
        edu: false,
        reddit: true,
        reddit_subreddits: null,
      },
      transcript: [],
    });
  }
  if (
    url.endsWith("/v1/sessions/60000000-0000-4000-8000-000000000001/stream") &&
    (!init?.method || init.method === "GET")
  ) {
    return new Response(null, { status: 204 });
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
    );
  }

  return createWorkspaceFetchPreset()(input, init);
}

function aiFetchHandlerWithModes(
  input: RequestInfo | URL,
  init?: RequestInit,
): Response | Promise<Response> {
  const url = String(input);
  if (url.endsWith("/v1/config")) {
    return jsonResponse({
      greeting: "What should we untangle first?",
      season_note: "Ignored here",
      conversation_starters: [],
      default_source_config: null,
      skills: [
        {
          name: "school-comparison",
          display_name: "School comparison",
          description: "Compare schools side by side.",
        },
      ],
      skill_modes: skillModes,
      max_selected_skills: 3,
    });
  }
  return aiFetchHandler(input, init);
}

describe("AiComposerRoute", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.innerWidth = 1280;
  });

  it("redirects /app to /app/ai and marks the AI nav item active", async () => {
    renderApp("/app", { fetchHandler: aiFetchHandler });

    await waitFor(() => expect(window.location.pathname).toBe("/app/ai"));
    expect(
      await screen.findByRole("heading", {
        name: "What should we untangle first?",
      }),
    ).toBeInTheDocument();

    const aiLink = screen.getByRole("link", { name: "AI" });
    expect(aiLink.closest('[data-slot="sidebar-menu-button"]')).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("does not flash fallback greeting while config is loading", async () => {
    let resolveConfig!: (response: Response) => void;
    const configPromise = new Promise<Response>((resolve) => {
      resolveConfig = resolve;
    });
    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/config")) {
          return configPromise;
        }
        return createWorkspaceFetchPreset()(input, init);
      },
    });

    expect(
      screen.queryByRole("heading", { name: "Where should we begin?" }),
    ).not.toBeInTheDocument();

    resolveConfig(
      jsonResponse({
        greeting: "Ready when you are.",
        season_note: null,
        conversation_starters: [],
        default_source_config: null,
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Ready when you are." }),
    ).toBeInTheDocument();
  });

  it("shows fallback greeting only after config failure", async () => {
    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/config")) {
          return jsonResponse(
            { error: { message: "failed" } },
            { status: 500 },
          );
        }
        return createWorkspaceFetchPreset()(input, init);
      },
    });

    expect(
      await screen.findByRole("heading", { name: "Where should we begin?" }),
    ).toBeInTheDocument();
  });

  it("submits on Enter and inserts a newline on Shift+Enter", async () => {
    const user = userEvent.setup();
    const requests: { url: string; body: unknown }[] = [];

    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        const url = String(input);
        if (init?.body) {
          requests.push({ url, body: JSON.parse(String(init.body)) });
        }
        return aiFetchHandler(input, init);
      },
    });

    const textarea = await screen.findByRole("combobox", {
      name: "Message Counselle",
    });
    await waitFor(() => expect(textarea).not.toBeDisabled());

    await user.type(textarea, "Compare aid");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(textarea).toHaveValue("Compare aid\n");

    await user.type(textarea, "at UCLA{Enter}");

    await waitFor(() =>
      expect(
        requests.find((request) => request.url.endsWith("/messages"))?.body,
      ).toEqual({
        text: "Compare aid\nat UCLA",
        skills: [],
        source_config: {
          web: true,
          edu: false,
          reddit: true,
          reddit_subreddits: null,
        },
      }),
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/app/ai/60000000-0000-4000-8000-000000000001",
      ),
    );
    expect(textarea).toHaveValue("");
  });

  it("offers source choices from the composer menu", async () => {
    renderApp("/app/ai", { fetchHandler: aiFetchHandler });
    await screen.findByRole("heading", {
      name: "What should we untangle first?",
    });

    const form = await screen.findByRole("form", {
      name: "Start an AI conversation",
    });

    fireEvent.click(within(form).getByRole("button", { name: /Sources:/ }));

    const menu = screen.getByRole("menu");
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "Web search" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: ".edu sources" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      within(menu).getByRole("menuitemcheckbox", {
        name: "Reddit communities",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "ApplyingToCollege" }),
    ).toBeInTheDocument();
  });

  it("carries a selected skill through the first-message handoff", async () => {
    const user = userEvent.setup();
    const requests: { url: string; body: unknown }[] = [];
    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        if (init?.body) {
          requests.push({
            url: String(input),
            body: JSON.parse(String(init.body)),
          });
        }
        return aiFetchHandler(input, init);
      },
    });

    const textarea = await screen.findByRole("combobox", {
      name: "Message Counselle",
    });
    await waitFor(() => expect(textarea).toBeEnabled());
    await user.type(textarea, "Compare @school");
    await screen.findByRole("listbox", { name: "Skills" });
    await user.keyboard("{Enter}");
    expect(textarea).toHaveValue("Compare  @school-comparison  ");
    expect(screen.getByText("@school-comparison")).toHaveAttribute(
      "data-slot",
      "inline-skill-mention",
    );

    await user.type(textarea, "Duke and Northwestern{Enter}");
    await waitFor(() =>
      expect(
        requests.find((request) => request.url.endsWith("/messages"))?.body,
      ).toMatchObject({
        text: "Compare  @school-comparison  Duke and Northwestern",
        skills: ["school-comparison"],
      }),
    );
  });

  it("sends the default counseling mode through the first-message handoff", async () => {
    const user = userEvent.setup();
    const requests: { url: string; body: unknown }[] = [];
    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        if (init?.body) {
          requests.push({
            url: String(input),
            body: JSON.parse(String(init.body)),
          });
        }
        return aiFetchHandlerWithModes(input, init);
      },
    });

    const textarea = await screen.findByRole("combobox", {
      name: "Message Counselle",
    });
    await waitFor(() => expect(textarea).toBeEnabled());
    expect(
      screen.getByRole("button", { name: "Counseling mode: Focused Answer" }),
    ).toBeInTheDocument();

    await user.type(textarea, "Compare aid{Enter}");

    await waitFor(() =>
      expect(
        requests.find((request) => request.url.endsWith("/messages"))?.body,
      ).toMatchObject({
        text: "Compare aid",
        skills: ["focused-answer"],
      }),
    );
  });

  it("loads the skill catalog on a direct session route", async () => {
    renderApp("/app/ai/60000000-0000-4000-8000-000000000001", {
      fetchHandler: aiFetchHandler,
    });

    expect(
      await screen.findByRole("button", { name: "Add a skill (@)" }),
    ).toBeEnabled();
  });

  it("hydrates the composer from an onboarding draftPrompt without submitting it", async () => {
    const requests: { url: string; body: unknown }[] = [];
    renderApp("/app/ai", {
      state: { draftPrompt: "Help me plan my timeline." },
      fetchHandler: (input, init) => {
        const url = String(input);
        if (init?.body) requests.push({ url, body: JSON.parse(String(init.body)) });
        return aiFetchHandler(input, init);
      },
    });

    const textarea = await screen.findByRole("combobox", {
      name: "Message Counselle",
    });
    await waitFor(() => expect(textarea).toHaveValue("Help me plan my timeline."));

    // No session/message call happened just from loading with a prefilled
    // draft — only an explicit Send creates a turn (plan §20.7).
    expect(requests.find((request) => request.url.endsWith("/sessions"))).toBeUndefined();
    expect(requests.find((request) => request.url.endsWith("/messages"))).toBeUndefined();

    // The composer stays editable: the student can change the prefilled text.
    await userEvent.setup().type(textarea, " Also mention my budget.");
    expect(textarea).toHaveValue("Help me plan my timeline. Also mention my budget.");
  });

  it("clears the draftPrompt router state after hydrating so it isn't reapplied on refresh", async () => {
    renderApp("/app/ai", {
      state: { draftPrompt: "Help me plan my timeline." },
      fetchHandler: aiFetchHandler,
    });

    const textarea = await screen.findByRole("combobox", {
      name: "Message Counselle",
    });
    await waitFor(() => expect(textarea).toHaveValue("Help me plan my timeline."));

    await waitFor(() => expect(window.history.state?.usr ?? null).toBeNull());
  });

  it("ignores a malformed draftPrompt and shows the normal empty composer", async () => {
    renderApp("/app/ai", {
      state: { draftPrompt: 12345 },
      fetchHandler: aiFetchHandler,
    });

    const textarea = await screen.findByRole("combobox", {
      name: "Message Counselle",
    });
    await waitFor(() => expect(textarea).toBeEnabled());
    expect(textarea).toHaveValue("");
  });
});
