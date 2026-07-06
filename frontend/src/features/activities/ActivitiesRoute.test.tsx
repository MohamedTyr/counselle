import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";

import type { Activity } from "@/domain/activity";
import { ActivitiesPage } from "@/features/activities/ActivitiesRoute";
import { UndoToast } from "@/components/undo-toast";

function renderActivities({
  activities,
  path = "/activities",
}: {
  activities?: Activity[];
  path?: string;
} = {}) {
  const router = createMemoryRouter(
    [
      {
        element: <ActivitiesPage activities={activities} />,
        path: "/activities",
      },
    ],
    { initialEntries: [path] },
  );

  const view = render(<RouterProvider router={router} />);

  return { router, view };
}

function makeActivity(index: number): Activity {
  return {
    created_at: "2026-06-01T09:00:00.000Z",
    description: `Completed activity ${index} with measurable impact.`,
    grades: ["11"],
    hours_per_week: 2,
    id: `activity-${index}`,
    order: index + 1,
    organization: `Organization ${index}`,
    position: `Activity ${index}`,
    timing: ["school_year"],
    type: "Other Club/Activity",
    updated_at: "2026-06-01T09:00:00.000Z",
    weeks_per_year: 10,
  };
}

function dataTransferMock() {
  return {
    dropEffect: "",
    effectAllowed: "",
    getData: vi.fn(),
    setData: vi.fn(),
  };
}

describe("ActivitiesPage", () => {
  it("renders the activities workspace with shared header and status controls", () => {
    renderActivities();

    expect(
      screen.getByRole("heading", { name: "Activities" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Activities/ })).toHaveAttribute(
      "data-active",
      "",
    );
    expect(
      screen.getByRole("button", { name: "Add activity" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/paste-ready/)).toBeInTheDocument();
  });

  it("switches to honors and shows the honor controls", async () => {
    const user = userEvent.setup();
    renderActivities();

    await user.click(screen.getByRole("tab", { name: /Honors/ }));

    expect(
      screen.getByRole("button", { name: "Add honor" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Honor 1: National Physics Olympiad - Silver Medal/,
      }),
    ).toBeInTheDocument();
  });

  it("opens and edits an activity drawer from a row", async () => {
    const user = userEvent.setup();
    const { router } = renderActivities();

    await user.click(
      screen.getByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    );

    expect(
      await screen.findByRole("textbox", { name: "Position" }),
    ).toHaveValue("Founder & President");
    expect(router.state.location.search).toBe("?activity=robotics-founder");

    const description = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(description, { target: { value: "x".repeat(151) } });

    expect(screen.getAllByText("151/150 · 1 over")).not.toEqual([]);

    const hours = screen.getByRole("textbox", { name: "Hours per week" });
    fireEvent.change(hours, { target: { value: "0" } });

    expect(hours).toHaveValue("1");
  });

  it("opens rows from the keyboard", async () => {
    const user = userEvent.setup();
    renderActivities();

    const row = screen.getByRole("button", {
      name: /Activity 1: Founder & President/,
    });

    row.focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("textbox", { name: "Position" }),
    ).toHaveValue("Founder & President");
  });

  it("opens an honor drawer from the honors list", async () => {
    const user = userEvent.setup();
    renderActivities();

    await user.click(screen.getByRole("tab", { name: /Honors/ }));
    await user.click(
      screen.getByRole("button", {
        name: /Honor 1: National Physics Olympiad - Silver Medal/,
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "National Physics Olympiad - Silver Medal",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "National Physics Olympiad - Silver Medal",
    );
  });

  it("does not keep drag armed after clicking a reorder grip without dragging", () => {
    renderActivities();

    const grip = screen.getByRole("button", {
      name: "Reorder Founder & President",
    });
    const row = document.querySelector('[data-activity-id="robotics-founder"]');
    const dataTransfer = dataTransferMock();

    expect(row).toBeInstanceOf(HTMLElement);

    fireEvent.pointerDown(grip);
    fireEvent.pointerUp(window);
    fireEvent.dragStart(row!, { dataTransfer });

    expect(dataTransfer.setData).not.toHaveBeenCalled();
  });

  it("restores the original activity order when a drag is canceled", () => {
    renderActivities();

    const grip = screen.getByRole("button", {
      name: "Reorder Founder & President",
    });
    const firstRow = document.querySelector(
      '[data-activity-id="robotics-founder"]',
    );
    const secondRow = document.querySelector(
      '[data-activity-id="refugee-tutor"]',
    );
    const dataTransfer = dataTransferMock();

    expect(firstRow).toBeInstanceOf(HTMLElement);
    expect(secondRow).toBeInstanceOf(HTMLElement);

    fireEvent.pointerDown(grip);
    fireEvent.dragStart(firstRow!, { dataTransfer });
    fireEvent.dragOver(secondRow!, { dataTransfer });

    expect(
      screen.getAllByRole("button", { name: /Activity \d:/ })[0],
    ).toHaveAccessibleName(/Activity 1: Volunteer Tutor/);

    fireEvent.dragEnd(firstRow!, { dataTransfer });

    expect(
      screen.getAllByRole("button", { name: /Activity \d:/ })[0],
    ).toHaveAccessibleName(/Activity 1: Founder & President/);
  });

  it("keeps the previewed activity order after a successful drop", () => {
    renderActivities();

    const grip = screen.getByRole("button", {
      name: "Reorder Founder & President",
    });
    const firstRow = document.querySelector(
      '[data-activity-id="robotics-founder"]',
    );
    const secondRow = document.querySelector(
      '[data-activity-id="refugee-tutor"]',
    );
    const dataTransfer = dataTransferMock();

    expect(firstRow).toBeInstanceOf(HTMLElement);
    expect(secondRow).toBeInstanceOf(HTMLElement);

    fireEvent.pointerDown(grip);
    fireEvent.dragStart(firstRow!, { dataTransfer });
    fireEvent.dragOver(secondRow!, { dataTransfer });
    fireEvent.drop(secondRow!, { dataTransfer });
    fireEvent.dragEnd(firstRow!, { dataTransfer });

    expect(
      screen.getAllByRole("button", { name: /Activity \d:/ })[0],
    ).toHaveAccessibleName(/Activity 1: Volunteer Tutor/);
  });

  it("reports clipboard failures without claiming success", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderActivities();

    await user.click(
      screen.getByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Copy position" }),
    );

    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });

  it("creates a new activity and opens its drawer", async () => {
    const user = userEvent.setup();
    renderActivities();

    await user.click(screen.getByRole("button", { name: "Add activity" }));

    expect(
      await screen.findByRole("heading", { name: "Untitled activity" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Position" })).toHaveValue("");
  });

  it("uses the shared undo surface for fixture-backed activity restore", async () => {
    const user = userEvent.setup();
    renderActivities();

    await user.click(
      screen.getByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Activity deleted")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: /Activity 1: Founder & President/,
        }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(
      await screen.findByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    ).toBeInTheDocument();
  });

  it("disables activity creation at the Common App limit", () => {
    renderActivities({
      activities: Array.from({ length: 10 }, (_, index) => makeActivity(index)),
    });

    expect(
      screen.getByRole("button", { name: "Common App limit reached" }),
    ).toBeDisabled();
    expect(screen.queryByText(/open slot/)).not.toBeInTheDocument();
  });

  it("opens valid activity deep links and clears params on close", async () => {
    const user = userEvent.setup();
    const { router } = renderActivities({
      path: "/activities?activity=robotics-founder",
    });

    expect(
      await screen.findByRole("textbox", { name: "Position" }),
    ).toHaveValue("Founder & President");

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("opens valid honor deep links and ignores invalid ids", async () => {
    const { view } = renderActivities({
      path: "/activities?honor=physics-olympiad",
    });

    expect(
      await screen.findByRole("heading", {
        name: "National Physics Olympiad - Silver Medal",
      }),
    ).toBeInTheDocument();

    view.unmount();
    renderActivities({ path: "/activities?activity=missing" });

    const dialogs = screen.queryAllByRole("dialog", { hidden: true });
    expect(
      dialogs.some((dialog) =>
        within(dialog).queryByRole("heading", {
          name: /Founder|Olympiad|Untitled/,
        }),
      ),
    ).toBe(false);
  });

  it("renders undo feedback when reduced motion is requested", () => {
    render(
      <UndoToast
        onDismiss={vi.fn()}
        onUndo={vi.fn()}
        pending={{ label: "Activity" }}
        reduceMotion
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Activity deleted");
  });
});
