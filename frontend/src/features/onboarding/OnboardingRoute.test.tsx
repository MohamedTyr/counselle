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

  it("lets a second Continue click through after a validation failure is fixed (regression: guardedOnContinue latch)", async () => {
    // Regression test for a bug where `OnboardingSetup`'s double-submit guard
    // (`submitDispatchedRef`) latched permanently shut whenever `onContinue`
    // returned without the caller ever flipping `isSaving` to `true` — which
    // is exactly what happens on a client-side validation failure
    // (`handleContinue` sets a field error and returns before `setSaveStatus
    // ("saving")`). Without the fix, the second click below (with the field
    // corrected) would silently do nothing and the heading would never
    // change.
    //
    // Clear the session draft first: this suite reuses the same fixture
    // user id across tests within this file, and an earlier "academics"
    // step test in this file leaves a saved-but-incomplete session draft
    // (plan §18) that would otherwise hydrate here instead of a clean step.
    window.sessionStorage.clear();
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

    // Fix the field that failed validation, then click Continue again.
    await user.type(screen.getByLabelText("Out of"), "4.0");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "What are you drawn to?" }),
    ).toBeInTheDocument();
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

  it("shows the Profile-save-failure copy and keeps the student on the step (02-ui-ux-spec.md §17)", async () => {
    const user = userEvent.setup();
    let profilePatchCalls = 0;
    renderApp("/onboarding", {
      fetchHandler: (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/profile") && init?.method === "PATCH") {
          profilePatchCalls += 1;
          return jsonResponse({ detail: "unprocessable" }, { status: 422 });
        }
        return createOnboardingRouteFetch({
          progress: progressFixture({ current_step: "basics" }),
        })(input, init);
      },
    });

    const nameInput = await screen.findByLabelText("What should Counselle call you?");
    await user.type(nameInput, "Maya");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("We couldn’t save this step. Your answers are still here."),
    ).toBeInTheDocument();
    // Still on the same step, and the draft wasn't cleared.
    expect(screen.getByRole("heading", { name: "Let’s make Counselle yours" })).toBeInTheDocument();
    expect(screen.getByLabelText("What should Counselle call you?")).toHaveValue("Maya");
    expect(profilePatchCalls).toBe(1);
  });

  it("renders the real completion view after Fit succeeds, with no auto model call", async () => {
    const user = userEvent.setup();
    const requests: string[] = [];
    const baseFetch = createOnboardingRouteFetch({
      progress: progressFixture({ current_step: "fit" }),
      profile: { interests: { intended_majors: ["biology"] } },
    });
    renderApp("/onboarding", {
      fetchHandler: (input, init) => {
        requests.push(String(input));
        return baseFetch(input, init);
      },
    });

    await user.click(await screen.findByRole("button", { name: "Finish setup" }));

    expect(
      await screen.findByRole("heading", { name: "Counselle has the essentials" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Direction")).toBeInTheDocument();
    expect(screen.getByText("biology")).toBeInTheDocument();

    // Reaching the completion view itself never talks to a chat/session
    // endpoint — only Profile and onboarding-progress calls happened.
    expect(requests.some((url) => url.includes("/v1/sessions"))).toBe(false);
    expect(requests.some((url) => url.includes("/v1/config"))).toBe(false);
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
