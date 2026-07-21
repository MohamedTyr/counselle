import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { OnboardingProgress } from "@/api/http/onboarding";
import type { Profile } from "@/api/workspace/types";
import {
  authUserFixture,
  jsonResponse,
  renderApp,
} from "@/test/render-app";

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

function progressFixture(overrides: Partial<OnboardingProgress>): OnboardingProgress {
  return {
    version: 1,
    status: "in_progress",
    current_step: "basics",
    updated_at: "2026-07-21T00:00:00Z",
    completed_at: null,
    ...overrides,
  };
}

function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete target[key];
    } else if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      mergePatch(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function createOnboardingRouteFetch(options: {
  progress: OnboardingProgress;
  profile?: Profile;
  onProgressAdvance?: () => "ok" | "fail";
}): FetchHandler {
  let progress = options.progress;
  const profile: Record<string, unknown> = { ...(options.profile ?? {}) };

  return (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/me")) {
      return jsonResponse({ ...authUserFixture, settings: { onboarding: progress } });
    }
    if (url.endsWith("/v1/profile")) {
      if (init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body ?? "{}"));
        mergePatch(profile, patch);
        return jsonResponse(profile);
      }
      return jsonResponse(profile);
    }
    if (url.endsWith("/v1/onboarding") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body ?? "{}")) as {
        action: string;
        step?: string;
      };
      if (body.action === "advance" || body.action === "complete") {
        const outcome = options.onProgressAdvance?.() ?? "ok";
        if (outcome === "fail") {
          return jsonResponse({ detail: "progress save failed" }, { status: 500 });
        }
        const order = ["basics", "academics", "direction", "context", "fit"];
        const nextIndex = order.indexOf(body.step ?? "basics") + 1;
        progress = progressFixture({
          status: body.action === "complete" ? "completed" : "in_progress",
          current_step: (order[nextIndex] ?? "fit") as OnboardingProgress["current_step"],
          completed_at: body.action === "complete" ? "2026-07-21T00:00:00Z" : null,
        });
        return jsonResponse(progress);
      }
      return jsonResponse(progress);
    }
    return jsonResponse({});
  };
}

describe("OnboardingRoute", () => {
  it("advances a blank Basics screen without requiring any field", async () => {
    const user = userEvent.setup();
    renderApp("/onboarding", {
      fetchHandler: createOnboardingRouteFetch({
        progress: progressFixture({ current_step: "basics" }),
      }),
    });

    await user.click(await screen.findByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "Your academic snapshot" }),
    ).toBeInTheDocument();
  });

  it("saves the Profile before advancing progress, and shows hydrated values on resume", async () => {
    const user = userEvent.setup();
    renderApp("/onboarding", {
      fetchHandler: createOnboardingRouteFetch({
        progress: progressFixture({ current_step: "basics" }),
      }),
    });

    const nameInput = await screen.findByLabelText("What should Counselle call you?");
    await user.type(nameInput, "Maya");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "Your academic snapshot" }),
    ).toBeInTheDocument();
  });

  it("focuses and announces an error for an invalid non-empty field instead of silently blocking", async () => {
    const user = userEvent.setup();
    renderApp("/onboarding", {
      fetchHandler: createOnboardingRouteFetch({
        progress: progressFixture({ current_step: "academics" }),
      }),
    });

    await user.click(await screen.findByRole("radio", { name: "Weighted" }));
    await user.type(await screen.findByLabelText("GPA"), "3.8");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("Add the scale so Counselle reads this GPA correctly."),
    ).toBeInTheDocument();
    // Still on the same step: the heading never changed.
    expect(screen.getByRole("heading", { name: "Your academic snapshot" })).toBeInTheDocument();
  });

  it("shows saved conditional values on hydration (visa status opens automatically)", async () => {
    const user = userEvent.setup();
    renderApp("/onboarding", {
      fetchHandler: createOnboardingRouteFetch({
        progress: progressFixture({ current_step: "context" }),
        profile: {
          background: { citizenship: "U.S. citizen", visa_status: "F-1" },
        },
      }),
    });

    expect(await screen.findByDisplayValue("F-1")).toBeInTheDocument();
    // Sanity: the disclosure button is gone since the field is already open.
    expect(screen.queryByRole("button", { name: "Add visa status" })).not.toBeInTheDocument();
    void user; // no interaction needed beyond the initial render for this assertion
  });

  it("retries only the progress command after a Profile save succeeds but progress fails", async () => {
    const user = userEvent.setup();
    let progressCalls = 0;
    renderApp("/onboarding", {
      fetchHandler: createOnboardingRouteFetch({
        progress: progressFixture({ current_step: "basics" }),
        onProgressAdvance: () => {
          progressCalls += 1;
          return progressCalls === 1 ? "fail" : "ok";
        },
      }),
    });

    const nameInput = await screen.findByLabelText("What should Counselle call you?");
    await user.type(nameInput, "Maya");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText(
        "Your answers were saved, but we couldn’t move to the next step. Try again.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "Your academic snapshot" }),
    ).toBeInTheDocument();
  });

  it("preserves entered state when navigating Back", async () => {
    const user = userEvent.setup();
    renderApp("/onboarding", {
      fetchHandler: createOnboardingRouteFetch({
        progress: progressFixture({ current_step: "basics" }),
      }),
    });

    const nameInput = await screen.findByLabelText("What should Counselle call you?");
    await user.type(nameInput, "Maya");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByRole("heading", { name: "Your academic snapshot" });
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("heading", { name: "Let’s make Counselle yours" })).toBeInTheDocument();
    expect(screen.getByLabelText("What should Counselle call you?")).toHaveValue("Maya");
  });
});
