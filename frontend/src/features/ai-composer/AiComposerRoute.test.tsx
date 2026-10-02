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
      default_response_mode: "quick",
      response_modes: [
        {
          id: "quick",
          model: "google-vertex:gemini-3.5-flash",
          model_display_name: "Gemini 3.5 Flash",
          preview: false,
        },
        {
          id: "think",
          model: "google-vertex:gemini-3.1-pro-preview",
          model_display_name: "Gemini 3.1 Pro",
          preview: true,
        },
      ],
    });
  }
  if (url.endsWith("/v1/sessions") && init?.method === "POST") {
    const body =
      init.body === undefined ? null : JSON.parse(String(init.body));
    return jsonResponse(
      {
        session_id: "60000000-0000-4000-8000-000000000001",
        source_config: {
          web: true,
          edu: false,
          reddit: true,
          reddit_subreddits: null,
        },
        response_mode:
          body !== null &&
          typeof body === "object" &&
          "response_mode" in body &&
          body.response_mode === "think"
            ? "think"
            : "quick",
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

const greetingPattern = /^Good (morning|afternoon|evening), Student$/;

describe("AiComposerRoute", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    window.innerWidth = 1280;
  });

  it("redirects /app to /app/ai and marks the AI nav item active", async () => {
    renderApp("/app", { fetchHandler: aiFetchHandler });

    await waitFor(() => expect(window.location.pathname).toBe("/app/ai"));
    expect(
      await screen.findByRole("heading", { name: greetingPattern }),
    ).toBeInTheDocument();

    const aiLink = screen.getByRole("link", { name: "AI" });
    expect(aiLink).toHaveAttribute("aria-current", "page");
  });

  it("greets the student by first name without waiting for config", async () => {
    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/config")) {
          return new Promise<Response>(() => undefined);
        }
        return createWorkspaceFetchPreset()(input, init);
      },
    });

    expect(
      await screen.findByRole("heading", { name: greetingPattern }),
    ).toBeInTheDocument();
  });

  it("still greets the student after config failure", async () => {
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
      await screen.findByRole("heading", { name: greetingPattern }),
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
        response_mode: "quick",
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

  it("uses the server-confirmed response mode for the first-message handoff", async () => {
    const user = userEvent.setup();
    const requests: { url: string; body: unknown }[] = [];

    renderApp("/app/ai", {
      fetchHandler: (input, init) => {
        const url = String(input);
        if (init?.body) {
          requests.push({ url, body: JSON.parse(String(init.body)) });
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
              response_mode: "think",
            },
            { status: 201 },
          );
        }
        return aiFetchHandler(input, init);
      },
    });

    const textarea = await screen.findByRole("combobox", {
      name: "Message Counselle",
    });
    await waitFor(() => expect(textarea).toBeEnabled());

    await user.type(textarea, "Compare honors colleges{Enter}");

    await waitFor(() =>
      expect(
        requests.find((request) => request.url.endsWith("/messages"))?.body,
      ).toMatchObject({
        text: "Compare honors colleges",
        response_mode: "think",
      }),
    );
  });

  it("lets the landing composer select Think for the new session and first message", async () => {
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
    await waitFor(() => expect(textarea).toBeEnabled());

    fireEvent.click(
      screen.getByRole("button", { name: /^Run settings: .*Quick$/ }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Think/ }));
    await user.type(textarea, "Compare honors colleges{Enter}");

    await waitFor(() =>
      expect(
        requests.find((request) => request.url.endsWith("/v1/sessions"))?.body,
      ).toMatchObject({ response_mode: "think" }),
    );
    await waitFor(() =>
      expect(
        requests.find((request) => request.url.endsWith("/messages"))?.body,
      ).toMatchObject({ response_mode: "think" }),
    );
  });

  it("offers source choices from the composer menu", async () => {
    renderApp("/app/ai", { fetchHandler: aiFetchHandler });
    await screen.findByRole("heading", { name: greetingPattern });

    const form = await screen.findByRole("form", {
      name: "Start an AI conversation",
    });

    fireEvent.click(within(form).getByRole("button", { name: /^Run settings/ }));

    const menu = screen.getByRole("dialog");
    expect(
      within(menu).getByRole("checkbox", { name: "Web search" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(menu).getByRole("checkbox", { name: ".edu sources" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      within(menu).getByRole("checkbox", {
        name: "Reddit communities",
      }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(menu).getByRole("checkbox", {
        name: "ApplyingToCollege",
      }),
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
      screen.getByRole("button", { name: /^Run settings: Focused Answer/ }),
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
