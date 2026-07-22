import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { expect, describe, test } from "vitest";

import type { OnboardingProgress } from "@/api/http/onboarding";
import type { Profile } from "@/api/workspace/types";
import { authUserFixture, jsonResponse, renderApp } from "@/test/render-app";

expect.extend(toHaveNoViolations);

/**
 * Automated accessibility smoke test for the onboarding flow (02-ui-ux-spec.md
 * §16). axe-core in jsdom cannot verify real computed color contrast or
 * exercise a live screen reader — this only catches invalid/missing ARIA,
 * unlabeled controls, redundant roles, and duplicate ids. Covers §16's
 * required set: step 1 (Basics), the densest step (Context), an error
 * state, and the completion state.
 */

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

function createFetch(options: {
  progress: OnboardingProgress;
  profile?: Profile;
}): FetchHandler {
  let progress = options.progress;
  const profile: Record<string, unknown> = { ...(options.profile ?? {}) };

  return (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/me")) {
      return jsonResponse({ ...authUserFixture, settings: { onboarding: progress } });
    }
    if (url.endsWith("/v1/profile")) {
      return jsonResponse(profile);
    }
    if (url.endsWith("/v1/onboarding") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body ?? "{}")) as { action: string };
      if (body.action === "complete") {
        progress = progressFixture({
          status: "completed",
          current_step: "fit",
          completed_at: "2026-07-21T00:00:00Z",
        });
      }
      return jsonResponse(progress);
    }
    return jsonResponse({});
  };
}

describe("onboarding accessibility", () => {
  test("step 1 (Basics) has no automatically-detectable a11y violations", async () => {
    const { container } = renderApp("/onboarding", {
      fetchHandler: createFetch({ progress: progressFixture({ current_step: "basics" }) }),
    });

    await screen.findByRole("heading", { name: "Let’s make Counselle yours" });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test("the Context step (densest step) has no automatically-detectable a11y violations", async () => {
    const { container } = renderApp("/onboarding", {
      fetchHandler: createFetch({ progress: progressFixture({ current_step: "context" }) }),
    });

    await screen.findByRole("progressbar");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test("a field-level validation error state has no automatically-detectable a11y violations", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/onboarding", {
      fetchHandler: createFetch({ progress: progressFixture({ current_step: "academics" }) }),
    });

    await user.click(await screen.findByRole("radio", { name: "Weighted" }));
    await user.type(await screen.findByLabelText("GPA"), "3.8");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("Add the scale so Counselle reads this GPA correctly.");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test("the completion state has no automatically-detectable a11y violations", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/onboarding", {
      fetchHandler: createFetch({
        progress: progressFixture({ current_step: "fit" }),
        profile: { interests: { intended_majors: ["biology"] } },
      }),
    });

    await user.click(await screen.findByRole("button", { name: "Finish setup" }));
    await screen.findByRole("heading", { name: "Counselle has the essentials" });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
