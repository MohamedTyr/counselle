import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Profile } from "@/api/workspace/types";
import { OnboardingCompletion } from "@/features/onboarding/OnboardingCompletion";

function renderCompletion(profile: Profile) {
  const onAskCounselle = vi.fn();
  const onSelectPrompt = vi.fn();
  const onReviewProfile = vi.fn();
  render(
    <OnboardingCompletion
      onAskCounselle={onAskCounselle}
      onReviewProfile={onReviewProfile}
      onSelectPrompt={onSelectPrompt}
      profile={profile}
    />,
  );
  return { onAskCounselle, onSelectPrompt, onReviewProfile };
}

describe("OnboardingCompletion", () => {
  it("shows the 'ready to start' heading when nothing was saved", () => {
    renderCompletion({});
    expect(screen.getByRole("heading", { name: "You’re ready to start" })).toBeInTheDocument();
  });

  it("shows the 'has the essentials' heading and receipt when at least one value was saved", () => {
    renderCompletion({ basics: { grade_level: "11", graduation_year: 2027 } });
    expect(
      screen.getByRole("heading", { name: "Counselle has the essentials" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByText("11th grade · Class of 2027")).toBeInTheDocument();
  });

  it("never renders an empty receipt row for data that was not entered", () => {
    renderCompletion({ basics: { grade_level: "11" } });
    expect(screen.queryByText("Academic snapshot")).not.toBeInTheDocument();
    expect(screen.queryByText("Direction")).not.toBeInTheDocument();
    expect(screen.queryByText("Context")).not.toBeInTheDocument();
    expect(screen.queryByText("Fit")).not.toBeInTheDocument();
  });

  it("never shows a completion percentage, score, or gamified chrome", () => {
    const { container } = render(
      <OnboardingCompletion
        onAskCounselle={vi.fn()}
        onReviewProfile={vi.fn()}
        onSelectPrompt={vi.fn()}
        profile={{ basics: { grade_level: "11" }, interests: { intended_majors: ["biology"] } }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/%|complete[d]?\s|score|badge|streak/i);
  });

  it("invokes onAskCounselle from the primary action", async () => {
    const user = userEvent.setup();
    const { onAskCounselle } = renderCompletion({});
    await user.click(screen.getByRole("button", { name: "Ask Counselle" }));
    expect(onAskCounselle).toHaveBeenCalledTimes(1);
  });

  it("invokes onSelectPrompt with the exact suggestion text, without submitting anything", async () => {
    const user = userEvent.setup();
    const { onSelectPrompt } = renderCompletion({
      interests: { intended_majors: ["biology"] },
    });
    await user.click(
      screen.getByRole("button", {
        name: "Help me build a starting school list around biology.",
      }),
    );
    expect(onSelectPrompt).toHaveBeenCalledWith(
      "Help me build a starting school list around biology.",
    );
  });

  it("invokes onReviewProfile from the Profile link action", async () => {
    const user = userEvent.setup();
    const { onReviewProfile } = renderCompletion({});
    await user.click(screen.getByRole("button", { name: "Review your full Profile" }));
    expect(onReviewProfile).toHaveBeenCalledTimes(1);
  });
});
