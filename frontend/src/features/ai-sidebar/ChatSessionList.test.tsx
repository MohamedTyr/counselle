import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  defaultAuthenticatedFetch,
  emptyResponse,
  jsonResponse,
  renderApp,
} from "@/test/render-app";

const brownSession = {
  session_id: "60000000-0000-4000-8000-000000000001",
  title: "Financial aid for Brown",
  created_at: "2026-07-06T10:00:00Z",
  updated_at: "2026-07-06T10:10:00Z",
  source_config: null,
  is_generating: false,
};

const mitSession = {
  session_id: "60000000-0000-4000-8000-000000000002",
  title: "MIT essay plan",
  created_at: "2026-07-06T09:00:00Z",
  updated_at: "2026-07-06T09:10:00Z",
  source_config: null,
  is_generating: true,
};

function chatFetch(calls: string[] = []) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);

    if (url.endsWith("/v1/sessions?limit=50")) {
      return jsonResponse({
        sessions: [brownSession, mitSession],
        next_cursor: null,
      });
    }

    if (url.includes("/v1/sessions/")) {
      const sessionId = url.split("/v1/sessions/")[1]?.split(/[/?]/)[0];
      const session =
        sessionId === mitSession.session_id ? mitSession : brownSession;

      if (url.endsWith("/stream")) {
        return emptyResponse();
      }
      if (init?.method === "PATCH") {
        return jsonResponse({ ok: true });
      }
      if (init?.method === "DELETE") {
        return emptyResponse();
      }
      return jsonResponse({ ...session, transcript: [] });
    }

    return defaultAuthenticatedFetch(input, init);
  };
}

function sidebarElement() {
  const sidebar = document.querySelector('[data-slot="sidebar"]');
  if (!(sidebar instanceof HTMLElement)) {
    throw new Error("Sidebar was not rendered");
  }
  return sidebar;
}

async function waitForSidebar() {
  await waitFor(() => {
    expect(document.querySelector('[data-slot="sidebar"]')).toBeInstanceOf(
      HTMLElement,
    );
  });
  return sidebarElement();
}

function sidebarMenuButtonFor(link: HTMLElement) {
  const button = link.closest('[data-slot="sidebar-menu-button"]');
  if (!(button instanceof HTMLElement)) {
    throw new Error("Sidebar menu button was not rendered");
  }
  return button;
}

describe("chat session sidebar list", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "sidebar_state=; path=/; max-age=0";
    window.history.replaceState(null, "", "/");
    window.innerWidth = 1280;
  });

  it("fetches recent sessions, highlights the active chat, shows generating state, and filters client-side", async () => {
    const calls: string[] = [];
    const user = userEvent.setup();

    renderApp(`/app/ai/${brownSession.session_id}`, {
      fetchHandler: chatFetch(calls),
    });

    const brownLink = await screen.findByRole("link", {
      name: "Financial aid for Brown",
    });
    expect(sidebarMenuButtonFor(brownLink)).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(
      screen.getByRole("status", { name: "MIT essay plan is generating" }),
    ).toBeInTheDocument();
    expect(calls).toContain("GET /v1/sessions?limit=50");

    const searchInput = screen.getByRole("searchbox", {
      name: "Search chats",
    });
    expect(searchInput).toHaveAttribute("placeholder", "Search");

    await user.type(searchInput, "brown");

    expect(
      screen.getByRole("link", { name: "Financial aid for Brown" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "MIT essay plan" }),
    ).not.toBeInTheDocument();
    expect(calls).not.toContain("GET /v1/sessions?limit=50&q=brown");

    await user.clear(searchInput);
    await user.type(searchInput, "princeton");
    expect(screen.getByText('No chats match “princeton”.')).toBeVisible();

    await user.clear(searchInput);
    expect(
      screen.getByRole("link", { name: "Financial aid for Brown" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "MIT essay plan" })).toBeVisible();
  });

  it("lets chat titles use the full row while overlaying actions on demand", async () => {
    renderApp("/app/tasks", { fetchHandler: chatFetch() });

    const link = await screen.findByRole("link", {
      name: "Financial aid for Brown",
    });
    const row = sidebarMenuButtonFor(link);
    const action = screen.getByRole("button", {
      name: "Actions for Financial aid for Brown",
    });
    const title = link.querySelector(":scope > span");

    expect(row).toHaveClass("px-1.5", "pr-1.5!");
    expect(title).toHaveTextContent("Financial aid for Brown");
    expect(title).toHaveClass("flex-1");
    expect(action).toHaveClass(
      "sidebar-chat-action",
      "pointer-events-none",
      "group-hover/menu-item:pointer-events-auto",
      "group-focus-within/menu-item:pointer-events-auto",
      "pointer-coarse:pointer-events-auto",
      "pointer-coarse:!opacity-100",
    );
  });

  it("routes normally and opens modified clicks in a new tab only for non-generating chats", async () => {
    const openMock = vi.fn();
    vi.stubGlobal("open", openMock);
    const user = userEvent.setup();

    renderApp("/app/tasks", { fetchHandler: chatFetch() });

    await user.click(
      await screen.findByRole("link", { name: "Financial aid for Brown" }),
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        `/app/ai/${brownSession.session_id}`,
      ),
    );

    window.history.replaceState(null, "", "/app/tasks");
    fireEvent.click(
      screen.getByRole("link", { name: "Financial aid for Brown" }),
      {
        metaKey: true,
      },
    );

    expect(openMock).toHaveBeenCalledWith(
      `/app/ai/${brownSession.session_id}`,
      "_blank",
      "noopener,noreferrer",
    );
    expect(window.location.pathname).toBe("/app/tasks");

    fireEvent.click(screen.getByRole("link", { name: "MIT essay plan" }), {
      metaKey: true,
    });

    expect(openMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/app/ai/${mitSession.session_id}`),
    );
  });

  it("renames blank titles as the untitled fallback before PATCH", async () => {
    const requests: RequestInit[] = [];
    const user = userEvent.setup();
    renderApp("/app/tasks", {
      fetchHandler: (input, init) => {
        if (String(input).includes("/v1/sessions/")) {
          requests.push(init ?? {});
        }
        return chatFetch()(input, init);
      },
    });

    const sidebar = await waitForSidebar();
    await user.click(
      await within(sidebar).findByRole("button", {
        name: "Actions for Financial aid for Brown",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

    const titleInput = await screen.findByRole("textbox", {
      name: "Chat title",
    });
    await user.clear(titleInput);
    await user.type(titleInput, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.method === "PATCH" &&
            request.body === JSON.stringify({ title: "Untitled" }),
        ),
      ).toBe(true),
    );
  });

  it("re-enables actions after a successful rename", async () => {
    const user = userEvent.setup();
    renderApp("/app/tasks", { fetchHandler: chatFetch() });

    const sidebar = await waitForSidebar();
    const actionButton = await within(sidebar).findByRole("button", {
      name: "Actions for Financial aid for Brown",
    });
    await user.click(actionButton);
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actionButton).not.toBeDisabled());
  });

  it("keeps the rename dialog open and reports an error when PATCH fails", async () => {
    const user = userEvent.setup();
    renderApp("/app/tasks", {
      fetchHandler: (input, init) => {
        if (String(input).includes("/v1/sessions/") && init?.method === "PATCH") {
          return Promise.resolve(
            new Response(JSON.stringify({ detail: "failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return chatFetch()(input, init);
      },
    });

    const sidebar = await waitForSidebar();
    await user.click(
      await within(sidebar).findByRole("button", {
        name: "Actions for Financial aid for Brown",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Could not rename this chat. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Rename chat" })).toBeInTheDocument();
  });

  it("deletes the active chat and returns to the AI start page", async () => {
    const calls: string[] = [];
    const user = userEvent.setup();
    renderApp(`/app/ai/${brownSession.session_id}`, {
      fetchHandler: chatFetch(calls),
    });

    const sidebar = await waitForSidebar();
    await user.click(
      await within(sidebar).findByRole("button", {
        name: "Actions for Financial aid for Brown",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    await waitFor(() => expect(window.location.pathname).toBe("/app/ai"));
    expect(calls).toContain(`DELETE /v1/sessions/${brownSession.session_id}`);
  });

  it("keeps the active route when delete fails", async () => {
    const user = userEvent.setup();
    renderApp(`/app/ai/${brownSession.session_id}`, {
      fetchHandler: (input, init) => {
        if (String(input).includes("/v1/sessions/") && init?.method === "DELETE") {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return chatFetch()(input, init);
      },
    });

    const sidebar = await waitForSidebar();
    await user.click(
      await within(sidebar).findByRole("button", {
        name: "Actions for Financial aid for Brown",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    await waitFor(() =>
      expect(window.location.pathname).toBe(`/app/ai/${brownSession.session_id}`),
    );
  });
});
