import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { OnboardingProgress } from "@/api/http/onboarding";
import {
  authUserFixture,
  defaultAuthenticatedFetch,
  jsonResponse,
  renderApp,
} from "@/test/render-app";

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

function progressFixture(
  overrides: Partial<OnboardingProgress>,
): OnboardingProgress {
  return {
    version: 1,
    status: "not_started",
    current_step: "basics",
    updated_at: "2026-07-21T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

/** Builds a fetch mock whose `/v1/me` reflects `progress` (`undefined` means
 * a grandfathered account: the key is entirely absent) and whose
 * `PATCH /v1/onboarding` applies a minimal version of the real backend
 * transition table (`app/onboarding.py`) so the stub route's start/defer
 * calls behave like the server would. */
function createOnboardingFetch(
  progress: OnboardingProgress | undefined | "malformed",
): FetchHandler {
  let current: unknown =
    progress === "malformed"
      ? { status: "not_a_real_status" }
      : progress;

  return (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/me")) {
      return jsonResponse({
        ...authUserFixture,
        settings: current === undefined ? {} : { onboarding: current },
      });
    }
    if (url.endsWith("/v1/onboarding") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body ?? "{}")) as {
        action: string;
      };
      const existing =
        current && typeof current === "object" && "status" in current
          ? (current as OnboardingProgress)
          : null;
      if (body.action === "start") {
        current = progressFixture({
          status: "in_progress",
          current_step: existing?.current_step ?? "basics",
        });
      } else if (body.action === "defer") {
        current = progressFixture({
          status: "deferred",
          current_step: existing?.current_step ?? "basics",
        });
      }
      return jsonResponse(current);
    }
    return defaultAuthenticatedFetch(input, init);
  };
}

describe("OnboardingGate", () => {
  it("allows a grandfathered (absent-key) user into the workspace", async () => {
    renderApp("/app/tasks", { fetchHandler: createOnboardingFetch(undefined) });

    await waitFor(() => expect(window.location.pathname).toBe("/app/tasks"));
    expect(
      await screen.findByRole("button", { name: "New task" }),
    ).toBeInTheDocument();
  });

  it("redirects a not_started user from /app/* to /onboarding and starts it", async () => {
    renderApp("/app/tasks", {
      fetchHandler: createOnboardingFetch(
        progressFixture({ status: "not_started", current_step: "basics" }),
      ),
    });

    await waitFor(() => expect(window.location.pathname).toBe("/onboarding"));
    expect(
      await screen.findByRole("heading", { name: "Let’s make Counselle yours" }),
    ).toBeInTheDocument();
  });

  it("redirects and resumes an in_progress user at their persisted step", async () => {
    renderApp("/app/schools", {
      fetchHandler: createOnboardingFetch(
        progressFixture({ status: "in_progress", current_step: "direction" }),
      ),
    });

    await waitFor(() => expect(window.location.pathname).toBe("/onboarding"));
    expect(
      await screen.findByRole("heading", { name: "What are you drawn to?" }),
    ).toBeInTheDocument();
  });

  it("allows a grandfathered user opening /onboarding directly and starts it", async () => {
    renderApp("/onboarding", { fetchHandler: createOnboardingFetch(undefined) });

    expect(
      await screen.findByRole("heading", { name: "Let’s make Counselle yours" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/onboarding");
  });

  it("does not nag a deferred user visiting the workspace", async () => {
    renderApp("/app/tasks", {
      fetchHandler: createOnboardingFetch(
        progressFixture({ status: "deferred", current_step: "context" }),
      ),
    });

    await waitFor(() => expect(window.location.pathname).toBe("/app/tasks"));
    expect(
      await screen.findByRole("button", { name: "New task" }),
    ).toBeInTheDocument();
  });

  it("resumes the deferred step from Guided setup on Profile", async () => {
    const user = userEvent.setup();
    renderApp("/app/profile", {
      fetchHandler: createOnboardingFetch(
        progressFixture({ status: "deferred", current_step: "context" }),
      ),
    });

    await user.click(await screen.findByRole("link", { name: "Guided setup" }));

    await waitFor(() => expect(window.location.pathname).toBe("/onboarding"));
    expect(
      await screen.findByRole("heading", { name: "Context that changes the advice" }),
    ).toBeInTheDocument();
  });

  it("does not show Guided setup for a completed user", async () => {
    renderApp("/app/profile", {
      fetchHandler: createOnboardingFetch(
        progressFixture({
          status: "completed",
          current_step: "fit",
          completed_at: "2026-07-21T00:00:00Z",
        }),
      ),
    });

    await screen.findByRole("heading", { name: "Profile" });
    expect(
      screen.queryByRole("link", { name: "Guided setup" }),
    ).not.toBeInTheDocument();
  });

  it("redirects a completed user opening /onboarding directly to Profile", async () => {
    renderApp("/onboarding", {
      fetchHandler: createOnboardingFetch(
        progressFixture({
          status: "completed",
          current_step: "fit",
          completed_at: "2026-07-21T00:00:00Z",
        }),
      ),
    });

    await waitFor(() => expect(window.location.pathname).toBe("/app/profile"));
  });

  it("allows a completed user with the one-time completion flag", async () => {
    renderApp("/onboarding", {
      fetchHandler: createOnboardingFetch(
        progressFixture({
          status: "completed",
          current_step: "fit",
          completed_at: "2026-07-21T00:00:00Z",
        }),
      ),
      state: { onboardingCompletion: true },
    });

    // `defaultAuthenticatedFetch` returns an empty Profile for this fixture,
    // so the truthful (no-facts) completion heading is the correct one here
    // (plan §9 "Completion state") — this test is about the Gate keeping
    // the completion view mounted, not about receipt content.
    expect(
      await screen.findByRole("heading", { name: "You’re ready to start" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/onboarding");
  });

  it("sends a reloaded completion screen to Profile instead", async () => {
    // A page refresh drops the ephemeral history state by design (README §7.5).
    renderApp("/onboarding", {
      fetchHandler: createOnboardingFetch(
        progressFixture({
          status: "completed",
          current_step: "fit",
          completed_at: "2026-07-21T00:00:00Z",
        }),
      ),
    });

    await waitFor(() => expect(window.location.pathname).toBe("/app/profile"));
  });

  it("never traps a malformed state on /app/* and shows a recoverable error on /onboarding", async () => {
    renderApp("/app/tasks", { fetchHandler: createOnboardingFetch("malformed") });
    await waitFor(() => expect(window.location.pathname).toBe("/app/tasks"));
    expect(
      await screen.findByRole("button", { name: "New task" }),
    ).toBeInTheDocument();

    renderApp("/onboarding", { fetchHandler: createOnboardingFetch("malformed") });
    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t read your setup progress",
      }),
    ).toBeInTheDocument();
  });

  it("redirects an unauthenticated visitor away from /onboarding", async () => {
    renderApp("/onboarding", {
      fetchHandler: (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/me")) {
          return jsonResponse({ detail: "Unauthorized" }, { status: 401 });
        }
        return jsonResponse({});
      },
    });

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
  });
});
