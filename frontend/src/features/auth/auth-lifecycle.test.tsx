import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderApp,
  anonymousFetch,
  authUserFixture,
  defaultAuthenticatedFetch,
  emptyResponse,
  jsonResponse,
} from "@/test/render-app";
import { safeAuthPath } from "@/app/auth/redirects";

describe("launch authentication", () => {
  it.each([
    "//evil.test",
    "/\\evil.test",
    "/app/../../login",
    "/application",
    "/app/%2f%2fevil.test",
  ])("rejects unsafe destination %s", (path) => {
    expect(safeAuthPath(path)).toBe("/app/ai");
  });
  it("keeps account settings available to an unverified student", async () => {
    renderApp("/account", {
      fetchHandler: (input, init) =>
        String(input).endsWith("/v1/me")
          ? jsonResponse({ ...authUserFixture, is_verified: false })
          : defaultAuthenticatedFetch(input, init),
    });
    expect(
      await screen.findByRole("heading", { name: "Account and security" }),
    ).toBeInTheDocument();
  });
  it("routes an unverified workspace visit to verification", async () => {
    renderApp("/app/ai", {
      fetchHandler: (input, init) =>
        String(input).endsWith("/v1/me")
          ? jsonResponse({ ...authUserFixture, is_verified: false })
          : defaultAuthenticatedFetch(input, init),
    });
    expect(
      await screen.findByRole("heading", { name: "Verify your email" }),
    ).toBeInTheDocument();
  });
  it("acknowledges recovery without revealing account membership", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/auth/forgot-password")
        ? emptyResponse({ status: 202 })
        : anonymousFetch(input, init),
    );
    renderApp("/forgot-password", { fetchHandler: fetchMock });
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("Email"),
      "student@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If an account exists",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/auth/forgot-password",
      expect.objectContaining({
        body: JSON.stringify({ email: "student@example.com" }),
      }),
    );
  });
  it("offers a new link for an expired password reset", async () => {
    renderApp("/reset-password?token=expired", {
      fetchHandler: (input, init) =>
        String(input).endsWith("/auth/reset-password")
          ? jsonResponse(
              { detail: "RESET_PASSWORD_BAD_TOKEN" },
              { status: 400 },
            )
          : anonymousFetch(input, init),
    });
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("New password"),
      "new-password-123",
    );
    await user.type(
      screen.getByLabelText("Confirm password"),
      "new-password-123",
    );
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("expired");
    expect(
      screen.getByRole("link", { name: "Request a new reset link" }),
    ).toHaveAttribute("href", "/forgot-password");
  });
  it("confirms verification on another device without requiring login first", async () => {
    renderApp("/verify-email?token=valid", {
      fetchHandler: (input, init) =>
        String(input).endsWith("/auth/verify")
          ? jsonResponse(authUserFixture)
          : anonymousFetch(input, init),
    });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Verify email" }),
    );
    expect(
      await screen.findByText("student@counselle.test is verified."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
  });
  it("requires confirmation before deleting an account", async () => {
    const fetchMock = vi.fn(defaultAuthenticatedFetch);
    renderApp("/account", { fetchHandler: fetchMock });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Delete account" }),
    );
    expect(screen.getByLabelText("Type DELETE to confirm")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(
      screen.getByRole("button", { name: "Permanently delete account" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/me") && init?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });
});

describe("account security journeys", () => {
  it("keeps a staged email change separate from the current address", async () => {
    let staged = false;
    renderApp("/account", {
      fetchHandler: (input, init) => {
        if (String(input).endsWith("/auth/email/change")) {
          staged = true;
          return emptyResponse({ status: 202 });
        }
        if (String(input).endsWith("/v1/me"))
          return jsonResponse({
            ...authUserFixture,
            pending_email: staged ? "new@example.com" : null,
          });
        return defaultAuthenticatedFetch(input, init);
      },
    });
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("New email"),
      "new@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Change email" }));
    expect(
      await screen.findByText(/Waiting for confirmation at new@example.com/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/student@counselle.test · Verified/),
    ).toBeInTheDocument();
  });

  it("shows identity confirmation after an expired recent-auth window", async () => {
    renderApp("/account", {
      fetchHandler: (input, init) =>
        String(input).endsWith("/auth/password")
          ? jsonResponse(
              { detail: "REAUTHENTICATION_REQUIRED" },
              { status: 403 },
            )
          : defaultAuthenticatedFetch(input, init),
    });
    const user = userEvent.setup();
    await user.type(
      await screen.findByLabelText("New password"),
      "new-long-password",
    );
    await user.type(
      screen.getByLabelText("Confirm password"),
      "new-long-password",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      await screen.findByLabelText("Current password"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Confirm identity" }),
    ).toHaveFocus();
    expect(screen.getByLabelText("New password")).toHaveValue(
      "new-long-password",
    );
  });

  it("offers email confirmation to a Google-only account", async () => {
    renderApp("/account", {
      fetchHandler: (input, init) =>
        String(input).endsWith("/v1/me")
          ? jsonResponse({
              ...authUserFixture,
              has_password: false,
              google_connected: true,
              reauthentication_required: true,
            })
          : String(input).endsWith("/config/public")
            ? jsonResponse({ auth: { google_enabled: true } })
            : defaultAuthenticatedFetch(input, init),
    });
    expect(
      await screen.findByRole("button", { name: "Confirm identity by email" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm with Google" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add password" }),
    ).toBeInTheDocument();
  });

  it("does not consume an email confirmation token when merely opening its URL", async () => {
    const fetchMock = vi.fn(defaultAuthenticatedFetch);
    renderApp("/reauthenticate?token=proof", { fetchHandler: fetchMock });
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Confirm identity" });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));
    expect(
      await screen.findByText(/Your identity is confirmed/),
    ).toBeInTheDocument();
  });

  it("hides registration when disabled by server configuration", async () => {
    renderApp("/register", {
      fetchHandler: (input, init) =>
        String(input).endsWith("/config/public")
          ? jsonResponse({ auth: { signup_enabled: false } })
          : anonymousFetch(input, init),
    });
    expect(
      await screen.findByText("New accounts are currently unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("explains an OAuth collision and offers existing-account recovery", async () => {
    renderApp("/auth/callback?error=account_exists&next=%2Fapp%2Fschools", {
      fetchHandler: anonymousFetch,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "existing method",
    );
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Log in with email" }),
    ).toBeInTheDocument();
  });
});

it("requires the supplied verification token even when another account is already verified", async () => {
  const fetchMock = vi.fn(defaultAuthenticatedFetch);
  renderApp("/verify-email?token=another-account", { fetchHandler: fetchMock });
  expect(
    await screen.findByRole("button", { name: "Verify email" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Your email is verified.")).not.toBeInTheDocument();
});

it("retains verification retry after a temporary network failure", async () => {
  let attempts = 0;
  renderApp("/verify-email?token=valid", {
    fetchHandler: (input, init) => {
      if (String(input).endsWith("/auth/verify")) {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new TypeError("network"))
          : jsonResponse(authUserFixture);
      }
      return anonymousFetch(input, init);
    },
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Verify email" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("connection");
  await user.click(screen.getByRole("button", { name: "Verify email" }));
  expect(
    await screen.findByText("student@counselle.test is verified."),
  ).toBeInTheDocument();
});

it("directs unsupported Google reauthentication to email confirmation", async () => {
  renderApp("/auth/callback?error=oauth_reauth_required&next=%2Faccount");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "confirm your identity by email",
  );
  expect(
    screen.getByRole("link", { name: "Back to account settings" }),
  ).toHaveAttribute("href", "/account");
});

it("offers verification instead of Google linking for an unverified account", async () => {
  renderApp("/account", {
    fetchHandler: (input, init) =>
      String(input).endsWith("/v1/me")
        ? jsonResponse({ ...authUserFixture, is_verified: false })
        : String(input).endsWith("/config/public")
          ? jsonResponse({ auth: { google_enabled: true } })
          : defaultAuthenticatedFetch(input, init),
  });
  expect(
    await screen.findByRole("link", {
      name: "Verify your email to connect Google",
    }),
  ).toHaveAttribute("href", "/verify-email");
  expect(
    screen.queryByRole("button", { name: "Connect Google" }),
  ).not.toBeInTheDocument();
});

it("names the verified account and switches through logout when another student is signed in", async () => {
  let signedOut = false;
  const { queryClient } = renderApp("/verify-email?token=owner-a", {
    fetchHandler: (input, init) => {
      if (String(input).endsWith("/auth/logout")) {
        signedOut = true;
        return emptyResponse();
      }
      if (signedOut && String(input).endsWith("/v1/me"))
        return jsonResponse({}, { status: 401 });
      return String(input).endsWith("/auth/verify")
        ? jsonResponse({
            ...authUserFixture,
            id: "owner-a",
            email: "a@example.com",
          })
        : defaultAuthenticatedFetch(input, init);
    },
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Verify email" }));
  expect(
    await screen.findByText("a@example.com is verified."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Continue" }),
  ).not.toBeInTheDocument();
  queryClient.setQueryData(["chat", "sessions"], "B conversations");
  await user.click(
    screen.getByRole("button", { name: "Sign out and switch accounts" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Log in" }),
  ).toBeInTheDocument();
  expect(signedOut).toBe(true);
  expect(queryClient.getQueryData(["chat", "sessions"])).toBeUndefined();
});

it("offers retry when the identity confirmation session check fails", async () => {
  let failed = true;
  renderApp("/reauthenticate?token=proof", {
    fetchHandler: (input, init) =>
      failed && String(input).endsWith("/v1/me")
        ? jsonResponse({}, { status: 503 })
        : defaultAuthenticatedFetch(input, init),
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not check your session",
  );
  failed = false;
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("button", { name: "Confirm identity" }),
  ).toBeInTheDocument();
});

it("rejects a stale account page's deletion and shows the current account without retrying", async () => {
  let activeUser = authUserFixture;
  let deleteRequests = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/v1/me") && init?.method === "DELETE") {
      deleteRequests += 1;
      expect(new Headers(init.headers).get("X-Expected-User-Id")).toBe(
        authUserFixture.id,
      );
      return jsonResponse({ detail: "ACCOUNT_CHANGED" }, { status: 409 });
    }
    if (String(input).endsWith("/v1/me")) return jsonResponse(activeUser);
    return defaultAuthenticatedFetch(input, init);
  });
  renderApp("/account", { fetchHandler: fetchMock });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Delete account" }),
  );
  await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
  activeUser = {
    ...authUserFixture,
    id: "another-user",
    email: "b@example.com",
    name: "B",
  };
  await user.click(
    screen.getByRole("button", { name: "Permanently delete account" }),
  );
  expect(
    await screen.findByText(/Your signed-in account changed in another tab/),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(/b@example.com · Verified/),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Type DELETE to confirm"),
  ).not.toBeInTheDocument();
  expect(deleteRequests).toBe(1);
});
