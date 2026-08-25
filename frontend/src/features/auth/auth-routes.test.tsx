import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppProviders } from "@/app/AppProviders";
import { safeAuthDestination } from "@/app/auth/redirects";
import { createTestQueryClient } from "@/test/render-app";
import {
  anonymousFetch,
  authErrorFetch,
  authUserFixture,
  defaultAuthenticatedFetch,
  emptyResponse,
  jsonResponse,
  renderApp,
} from "@/test/render-app";
import { LoginRoute } from "@/features/auth/LoginRoute";

describe("auth routes", () => {
  it("redirects anonymous workspace visits to login", async () => {
    renderApp("/app/tasks", { fetchHandler: anonymousFetch });

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
  });

  it("redirects authenticated guests into the workspace", async () => {
    renderApp("/login");

    await waitFor(() => expect(window.location.pathname).toBe("/app/ai"));
  });

  it("renders a retry state for /me server errors on protected routes", async () => {
    renderApp("/app/tasks", { fetchHandler: authErrorFetch });

    expect(
      await screen.findByRole("heading", {
        name: "Could not check your session",
      }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/tasks");
  });

  it("shows a non-blocking session-check warning on guest routes", async () => {
    renderApp("/login", { fetchHandler: authErrorFetch });

    expect(
      await screen.findByText("Could not check your current session."),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });

  it("logs in and restores the intended internal destination", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) {
        const loginCalled = fetchMock.mock.calls.some(
          ([calledInput, calledInit]) =>
            String(calledInput).endsWith("/v1/auth/login") &&
            calledInit?.method === "POST",
        );
        return loginCalled
          ? jsonResponse(authUserFixture)
          : jsonResponse({}, { status: 401 });
      }
      if (url.endsWith("/v1/auth/login") && init?.method === "POST") {
        return emptyResponse();
      }
      return jsonResponse({});
    });
    renderApp("/app/schools?tab=list#target", { fetchHandler: fetchMock });
    await waitFor(() => expect(window.location.pathname).toBe("/login"));

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(await screen.findByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      ).toBe("/app/schools?tab=list#target"),
    );
  });

  it("rejects external or non-app destinations", async () => {
    expect(
      safeAuthDestination({
        from: { pathname: "https://evil.example", search: "?x=1", hash: "#a" },
      }),
    ).toEqual({ pathname: "/app/ai", search: "", hash: "" });
    expect(
      safeAuthDestination({
        from: { pathname: "/schools", search: "", hash: "" },
      }),
    ).toEqual({ pathname: "/app/ai", search: "", hash: "" });
  });

  it("registers, logs in, and lands in the workspace", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) {
        const loginCalled = fetchMock.mock.calls.some(([calledInput]) =>
          String(calledInput).endsWith("/v1/auth/login"),
        );
        return loginCalled
          ? jsonResponse(authUserFixture)
          : jsonResponse({}, { status: 401 });
      }
      if (url.endsWith("/v1/auth/register") && init?.method === "POST") {
        return jsonResponse({}, { status: 201 });
      }
      if (url.endsWith("/v1/auth/login") && init?.method === "POST") {
        return emptyResponse();
      }
      return defaultAuthenticatedFetch(input, init);
    });
    renderApp("/register", { fetchHandler: fetchMock });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Ada Lovelace");
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(await screen.findByLabelText("Password"), "password123");
    await user.type(
      await screen.findByLabelText("Confirm password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(window.location.pathname).toBe("/app/ai"));
  });

  it("preserves the intended destination when switching from login to register", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) {
        const loginCalled = fetchMock.mock.calls.some(([calledInput]) =>
          String(calledInput).endsWith("/v1/auth/login"),
        );
        return loginCalled
          ? jsonResponse(authUserFixture)
          : jsonResponse({}, { status: 401 });
      }
      if (url.endsWith("/v1/auth/register") && init?.method === "POST") {
        return jsonResponse({}, { status: 201 });
      }
      if (url.endsWith("/v1/auth/login") && init?.method === "POST") {
        return emptyResponse();
      }
      return jsonResponse({});
    });
    renderApp("/app/schools?tab=list#target", { fetchHandler: fetchMock });
    await waitFor(() => expect(window.location.pathname).toBe("/login"));

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("link", { name: "Create account" }),
    );
    await waitFor(() => expect(window.location.pathname).toBe("/register"));
    await user.type(await screen.findByLabelText("Name"), "Ada Lovelace");
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(await screen.findByLabelText("Password"), "password123");
    await user.type(
      await screen.findByLabelText("Confirm password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() =>
      expect(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      ).toBe("/app/schools?tab=list#target"),
    );
  });

  it("sends users to login when register succeeds but auto-login fails", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) {
        return jsonResponse({}, { status: 401 });
      }
      if (url.endsWith("/v1/auth/register") && init?.method === "POST") {
        return jsonResponse({}, { status: 201 });
      }
      if (url.endsWith("/v1/auth/login") && init?.method === "POST") {
        return jsonResponse(
          { detail: "LOGIN_BAD_CREDENTIALS" },
          { status: 400 },
        );
      }
      return jsonResponse({});
    });
    renderApp("/register", { fetchHandler: fetchMock });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Ada Lovelace");
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(await screen.findByLabelText("Password"), "password123");
    await user.type(
      await screen.findByLabelText("Confirm password"),
      "password123",
    );
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(
      await screen.findByText("Your account was created. Please log in."),
    ).toBeInTheDocument();
  });

  it("logs out and lands on login", async () => {
    const user = userEvent.setup();
    renderApp("/app/tasks");

    // The account row identifies the user; the menu holds the action.
    await user.click(
      await screen.findByRole("button", { name: /Account menu/ }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /Log out/ }));

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
  });

  it("keeps the session visible when logout fails", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) {
        return jsonResponse(authUserFixture);
      }
      if (url.endsWith("/v1/auth/logout") && init?.method === "POST") {
        return jsonResponse({}, { status: 500 });
      }
      return defaultAuthenticatedFetch(input, init);
    });
    const user = userEvent.setup();
    renderApp("/app/tasks", { fetchHandler: fetchMock });

    // The account row identifies the user; the menu holds the action.
    await user.click(
      await screen.findByRole("button", { name: /Account menu/ }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /Log out/ }));

    await waitFor(() => expect(window.location.pathname).toBe("/app/tasks"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not log out. Please try again.",
    );
  });

  it("falls back to /app/ai when login state carries a non-app route", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/login") && init?.method === "POST") {
        return emptyResponse();
      }
      if (url.endsWith("/v1/me")) {
        return jsonResponse(authUserFixture);
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const router = createMemoryRouter(
      [{ path: "/login", element: <LoginRoute /> }],
      {
        initialEntries: [
          {
            pathname: "/login",
            state: { from: { pathname: "/schools", search: "", hash: "" } },
          },
        ],
      },
    );
    render(
      <AppProviders queryClient={createTestQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(await screen.findByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/app/ai"),
    );
  });
});
