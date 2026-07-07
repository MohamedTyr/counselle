import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type {
  Activity as ApiActivity,
  Honor as ApiHonor,
} from "@/api/workspace/types";
import { UndoToast } from "@/components/undo-toast";
import {
  createWorkspaceFetchPreset,
  jsonResponse,
  renderApp,
  workspaceActivityFixture,
  workspaceHonorFixture,
} from "@/test/render-app";

const activityFixtures: ApiActivity[] = [
  {
    ...workspaceActivityFixture,
    id: "robotics-founder",
    sort_order: 1,
    activity_type: "Robotics",
    position: "Founder & President",
    organization: "Robotics Club, Al-Noor High School",
    description:
      "Led 12-member team to national finals; built the training program that runs every season.",
    grades: ["10", "11", "12"],
    timing: ["school_year"],
    hours_per_week: 12,
    weeks_per_year: 30,
    continue_in_college: true,
    story:
      "Started the club, mentored younger students, and raised entry fees.",
    created_at: "2026-06-12T09:00:00",
    updated_at: "2026-07-01T18:20:00",
  },
  {
    ...workspaceActivityFixture,
    id: "refugee-tutor",
    sort_order: 2,
    activity_type: "Community Service (Volunteer)",
    position: "Volunteer Tutor",
    organization: "Ma'an Refugee Learning Center",
    description: "",
    grades: ["11", "12"],
    timing: ["all_year"],
    hours_per_week: 4,
    weeks_per_year: 45,
    continue_in_college: false,
    story: "Tutor math and English on Saturday mornings.",
    created_at: "2026-05-30T10:00:00",
    updated_at: "2026-06-28T14:05:00",
  },
  {
    ...workspaceActivityFixture,
    id: "physics-research",
    sort_order: 3,
    activity_type: "Research",
    position: "Research Intern",
    organization: "Department of Physics, National University",
    description:
      "Ran spectroscopy measurements and cleaned the dataset for a graduate study on thin-film solar cells, then co-wrote the methods section.",
    grades: ["11", "12"],
    timing: ["break"],
    hours_per_week: 20,
    weeks_per_year: 8,
    continue_in_college: true,
    story: "Eight-week summer internship after Grade 11.",
    created_at: "2026-06-18T11:30:00",
    updated_at: "2026-07-02T09:15:00",
  },
];

const honorFixtures: ApiHonor[] = [
  {
    ...workspaceHonorFixture,
    id: "physics-olympiad",
    sort_order: 1,
    title: "National Physics Olympiad - Silver Medal",
    grades: ["11"],
    levels: ["national", "state_regional"],
    created_at: "2026-06-12T09:10:00",
    updated_at: "2026-06-30T17:00:00",
  },
  {
    ...workspaceHonorFixture,
    id: "principals-list",
    sort_order: 2,
    title: "Principal's Honor List",
    grades: ["10", "11", "12"],
    levels: ["school"],
    created_at: "2026-06-12T09:12:00",
    updated_at: "2026-06-30T17:02:00",
  },
];

function renderActivities({
  activities = activityFixtures,
  honors = honorFixtures,
  fetchHandler = createWorkspaceFetchPreset({
    activities,
    honors,
  }),
  path = "/app/activities",
}: {
  activities?: ApiActivity[];
  fetchHandler?: Parameters<typeof renderApp>[1]["fetchHandler"];
  honors?: ApiHonor[];
  path?: string;
} = {}) {
  return renderApp(path, { fetchHandler });
}

function makeApiActivity(index: number): ApiActivity {
  return {
    ...workspaceActivityFixture,
    id: `activity-${index}`,
    sort_order: index + 1,
    activity_type: "Other Club/Activity",
    position: `Activity ${index}`,
    organization: `Organization ${index}`,
    description: `Completed activity ${index} with measurable impact.`,
    grades: ["11"],
    timing: ["school_year"],
    hours_per_week: 2,
    weeks_per_year: 10,
    continue_in_college: false,
    story: null,
    created_at: "2026-06-01T09:00:00.000Z",
    updated_at: "2026-06-01T09:00:00.000Z",
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

function fetchMock() {
  return vi.mocked(globalThis.fetch);
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("ActivitiesPage", () => {
  it("renders the activities workspace with shared header and status controls", async () => {
    renderActivities();

    expect(
      await screen.findByRole("heading", { name: "Activities" }),
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

    await user.click(await screen.findByRole("tab", { name: /Honors/ }));

    expect(
      screen.getByRole("button", { name: "Add honor" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: /Honor 1: National Physics Olympiad - Silver Medal/,
      }),
    ).toBeInTheDocument();
  });

  it("opens and edits an activity drawer from a row", async () => {
    const user = userEvent.setup();
    renderActivities();

    await user.click(
      await screen.findByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    );

    expect(
      await screen.findByRole("textbox", { name: "Position" }),
    ).toHaveValue("Founder & President");
    expect(window.location.search).toBe("?activity=robotics-founder");

    const description = screen.getByRole("textbox", { name: "Description" });
    fireEvent.change(description, { target: { value: "x".repeat(151) } });

    await waitFor(() => {
      expect(screen.getAllByText("151/150 · 1 over")).not.toEqual([]);
    });
    await waitFor(() => {
      expect(fetchMock()).toHaveBeenCalledWith(
        "/v1/activities/robotics-founder",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    const hours = screen.getByRole("textbox", { name: "Hours per week" });
    fireEvent.change(hours, { target: { value: "0" } });

    await waitFor(() => expect(hours).toHaveValue("1"));
  });

  it("normalizes invalid backend enum values before rendering", async () => {
    const user = userEvent.setup();
    renderActivities({
      activities: [
        {
          ...activityFixtures[0],
          activity_type: "Made Up Activity",
          grades: ["11", "college"],
          timing: ["weekends"],
        },
      ],
      honors: [
        {
          ...honorFixtures[0],
          grades: ["10", "college"],
          levels: ["national", "planetary"],
        },
      ],
    });

    expect(await screen.findByText("Grade 11")).toBeInTheDocument();
    expect(screen.getByText("No timing")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    );

    expect(screen.getByLabelText("Activity type")).toHaveTextContent(
      "Other Club/Activity",
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("tab", { name: /Honors/ }));

    expect(await screen.findByText("National")).toBeInTheDocument();
    expect(screen.getByText("Grade 10")).toBeInTheDocument();
  });

  it("normalizes missing backend activity fields before computing status", async () => {
    renderActivities({
      activities: [
        {
          ...activityFixtures[0],
          activity_type: undefined,
          description: undefined,
          grades: undefined,
          organization: undefined,
          position: undefined,
          timing: undefined,
        } as unknown as ApiActivity,
      ],
      honors: [
        {
          ...honorFixtures[0],
          grades: undefined,
          levels: undefined,
          title: undefined,
        } as unknown as ApiHonor,
      ],
    });

    expect(
      await screen.findByRole("heading", { name: "Activities" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0 paste-ready")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Activity 1: Untitled/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("No timing")).toBeInTheDocument();
  });

  it("does not let an older activity PATCH response overwrite newer input", async () => {
    const user = userEvent.setup();
    const olderPatch = deferredResponse();
    let currentActivity = activityFixtures[0];
    const preset = createWorkspaceFetchPreset({
      activities: activityFixtures,
      honors: honorFixtures,
    });
    const handler = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/v1/activities")) {
        return jsonResponse([currentActivity, ...activityFixtures.slice(1)]);
      }

      if (
        url.endsWith("/v1/activities/robotics-founder") &&
        init?.method === "PATCH"
      ) {
        const patch = JSON.parse(String(init.body ?? "{}"));
        if (patch.position === "First edit") {
          return olderPatch.promise;
        }
        currentActivity = {
          ...currentActivity,
          ...patch,
          updated_at: "2026-07-02T00:00:00Z",
        };
        return jsonResponse(currentActivity);
      }

      return preset(input, init);
    };

    renderActivities({ fetchHandler: handler });

    await user.click(
      await screen.findByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    );

    const position = await screen.findByRole("textbox", { name: "Position" });
    fireEvent.change(position, { target: { value: "First edit" } });
    fireEvent.change(position, { target: { value: "Second edit" } });

    await waitFor(() => expect(position).toHaveValue("Second edit"));

    await act(async () => {
      olderPatch.resolve(
        jsonResponse({
          ...activityFixtures[0],
          position: "First edit",
          updated_at: "2026-07-01T00:00:00Z",
        }),
      );
      await olderPatch.promise;
    });

    await waitFor(() => expect(position).toHaveValue("Second edit"));
  });

  it("opens rows from the keyboard", async () => {
    const user = userEvent.setup();
    renderActivities();

    const row = await screen.findByRole("button", {
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

    await user.click(await screen.findByRole("tab", { name: /Honors/ }));
    await user.click(
      await screen.findByRole("button", {
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

  it("shows skeletons and supports retry when an activities query fails", async () => {
    let activitiesCalls = 0;
    const handler = (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/activities")) {
        activitiesCalls += 1;
        return activitiesCalls === 1
          ? jsonResponse({ error: { message: "Failed" } }, { status: 500 })
          : jsonResponse(activityFixtures);
      }
      return createWorkspaceFetchPreset({
        activities: activityFixtures,
        honors: honorFixtures,
      })(input);
    };

    renderActivities({ fetchHandler: handler });

    expect(
      await screen.findByText("Could not load activities"),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    ).toBeInTheDocument();
  });

  it("covers honors loading, error, and empty states", async () => {
    const user = userEvent.setup();
    const honorsLoading = deferredResponse();

    const loadingView = renderActivities({
      fetchHandler: (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/honors")) {
          return honorsLoading.promise;
        }
        return createWorkspaceFetchPreset({
          activities: activityFixtures,
          honors: honorFixtures,
        })(input, init);
      },
    });

    await user.click(await screen.findByRole("tab", { name: /Honors/ }));
    expect(screen.getByRole("button", { name: "Add honor" })).toBeDisabled();

    await act(async () => {
      honorsLoading.resolve(jsonResponse(honorFixtures));
      await honorsLoading.promise;
    });
    loadingView.unmount();

    let honorCalls = 0;
    const errorView = renderActivities({
      fetchHandler: (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/honors")) {
          honorCalls += 1;
          return honorCalls === 1
            ? jsonResponse({ error: { message: "Failed" } }, { status: 500 })
            : jsonResponse(honorFixtures);
        }
        return createWorkspaceFetchPreset({
          activities: activityFixtures,
          honors: honorFixtures,
        })(input, init);
      },
    });

    await user.click(await screen.findByRole("tab", { name: /Honors/ }));
    expect(
      await screen.findByText("Could not load honors"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", {
        name: /Honor 1: National Physics Olympiad - Silver Medal/,
      }),
    ).toBeInTheDocument();
    errorView.unmount();

    renderActivities({ honors: [] });
    await user.click(await screen.findByRole("tab", { name: /Honors/ }));
    expect(await screen.findByText("No honors yet")).toBeInTheDocument();
  });

  it("does not keep drag armed after clicking a reorder grip without dragging", async () => {
    renderActivities();

    const grip = await screen.findByRole("button", {
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

  it("restores the original activity order when a drag is canceled", async () => {
    renderActivities();

    const grip = await screen.findByRole("button", {
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

  it("persists activity drag reorder through the workspace order endpoint", async () => {
    renderActivities();

    const grip = await screen.findByRole("button", {
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
    await waitFor(() => {
      expect(fetchMock()).toHaveBeenCalledWith(
        "/v1/activities/order",
        expect.objectContaining({
          body: JSON.stringify({
            ids: ["refugee-tutor", "robotics-founder", "physics-research"],
          }),
          method: "PUT",
        }),
      );
    });
  });

  it("persists honor move up and down through the honors order endpoint", async () => {
    const user = userEvent.setup();
    renderActivities();

    await user.click(await screen.findByRole("tab", { name: /Honors/ }));
    await user.click(
      await screen.findByRole("button", {
        name: /Honor 2: Principal's Honor List/,
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Move up" }));

    await waitFor(() => {
      expect(fetchMock()).toHaveBeenCalledWith(
        "/v1/honors/order",
        expect.objectContaining({
          body: JSON.stringify({
            ids: ["principals-list", "physics-olympiad"],
          }),
          method: "PUT",
        }),
      );
    });
  });

  it("rolls activity and honor reorders back when the server rejects them", async () => {
    const user = userEvent.setup();
    const handler = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        (url.endsWith("/v1/activities/order") ||
          url.endsWith("/v1/honors/order")) &&
        init?.method === "PUT"
      ) {
        return jsonResponse({ error: { message: "Failed" } }, { status: 500 });
      }
      return createWorkspaceFetchPreset({
        activities: activityFixtures,
        honors: honorFixtures,
      })(input, init);
    };

    renderActivities({ fetchHandler: handler });

    await user.click(
      await screen.findByRole("button", {
        name: "Actions for Founder & President",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /Activity \d:/ })[0],
      ).toHaveAccessibleName(/Activity 1: Founder & President/);
    });

    await user.click(screen.getByRole("tab", { name: /Honors/ }));
    await user.click(
      await screen.findByRole("button", {
        name: "Actions for National Physics Olympiad - Silver Medal",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /Honor \d:/ })[0],
      ).toHaveAccessibleName(
        /Honor 1: National Physics Olympiad - Silver Medal/,
      );
    });
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
      await screen.findByRole("button", {
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

    await user.click(
      await screen.findByRole("button", { name: "Add activity" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Untitled activity" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("textbox", { name: "Position" }),
    ).toHaveValue("");
  });

  it("rolls back failed activity creation", async () => {
    const user = userEvent.setup();
    renderActivities({
      activities: [],
      fetchHandler: (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/activities") && init?.method === "POST") {
          return jsonResponse(
            { error: { message: "Failed" } },
            { status: 500 },
          );
        }
        return createWorkspaceFetchPreset({
          activities: [],
          honors: honorFixtures,
        })(input, init);
      },
    });

    await user.click(
      await screen.findByRole("button", { name: "Add activity" }),
    );

    expect(await screen.findByText("No activities yet")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Untitled activity" }),
    ).not.toBeInTheDocument();
  });

  it("archives an activity and restores it through undo", async () => {
    const user = userEvent.setup();
    renderActivities();

    await user.click(
      await screen.findByRole("button", {
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
    expect(fetchMock()).toHaveBeenCalledWith(
      "/v1/activities/robotics-founder",
      expect.objectContaining({ method: "DELETE" }),
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(fetchMock()).toHaveBeenCalledWith(
        "/v1/activities/robotics-founder/restore",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(
      await screen.findByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    ).toBeInTheDocument();
  });

  it("restores a middle activity to its sort order", async () => {
    const user = userEvent.setup();
    renderActivities();

    await user.click(
      await screen.findByRole("button", {
        name: /Activity 2: Volunteer Tutor/,
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Activity 2: Volunteer Tutor/ }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => {
      const rows = screen.getAllByRole("button", { name: /Activity \d:/ });
      expect(rows[0]).toHaveAccessibleName(/Activity 1: Founder & President/);
      expect(rows[1]).toHaveAccessibleName(/Activity 2: Volunteer Tutor/);
      expect(rows[2]).toHaveAccessibleName(/Activity 3: Research Intern/);
    });
  });

  it("waits for activity archive to settle before restoring from immediate undo", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const deleteResponse = deferredResponse();
    const preset = createWorkspaceFetchPreset({
      activities: activityFixtures,
      honors: honorFixtures,
    });

    renderActivities({
      fetchHandler: (input, init) => {
        const url = String(input);
        if (
          url.endsWith("/v1/activities/robotics-founder") &&
          init?.method === "DELETE"
        ) {
          calls.push("delete-start");
          return deleteResponse.promise;
        }
        if (url.endsWith("/v1/activities/robotics-founder/restore")) {
          calls.push(
            calls.includes("delete-resolve")
              ? "restore-after-delete"
              : "restore-before-delete",
          );
        }
        return preset(input, init);
      },
    });

    await user.click(
      await screen.findByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Activity deleted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(calls).not.toContain("restore-before-delete");

    await act(async () => {
      calls.push("delete-resolve");
      deleteResponse.resolve(new Response(null, { status: 204 }));
      await deleteResponse.promise;
    });

    await waitFor(() => expect(calls).toContain("restore-after-delete"));
  });

  it("rolls back failed activity delete", async () => {
    const user = userEvent.setup();
    renderActivities({
      fetchHandler: (input, init) => {
        const url = String(input);
        if (
          url.endsWith("/v1/activities/robotics-founder") &&
          init?.method === "DELETE"
        ) {
          return jsonResponse(
            { error: { message: "Failed" } },
            { status: 500 },
          );
        }
        return createWorkspaceFetchPreset({
          activities: activityFixtures,
          honors: honorFixtures,
        })(input, init);
      },
    });

    await user.click(
      await screen.findByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    );
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    expect(
      await screen.findByRole("button", {
        name: /Activity 1: Founder & President/,
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Undo" }),
      ).not.toBeInTheDocument();
    });
  });

  it("disables activity creation at the Common App limit", async () => {
    renderActivities({
      activities: Array.from({ length: 10 }, (_, index) =>
        makeApiActivity(index),
      ),
    });

    expect(
      await screen.findByRole("button", { name: "Common App limit reached" }),
    ).toBeDisabled();
    expect(screen.queryByText(/open slot/)).not.toBeInTheDocument();
  });

  it("opens valid activity deep links and clears params on close", async () => {
    const user = userEvent.setup();
    renderActivities({
      path: "/app/activities?activity=robotics-founder",
    });

    expect(
      await screen.findByRole("textbox", { name: "Position" }),
    ).toHaveValue("Founder & President");

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("opens valid honor deep links and ignores invalid ids", async () => {
    const { unmount } = renderActivities({
      path: "/app/activities?honor=physics-olympiad",
    });

    expect(
      await screen.findByRole("heading", {
        name: "National Physics Olympiad - Silver Medal",
      }),
    ).toBeInTheDocument();

    unmount();
    renderActivities({ path: "/app/activities?activity=missing" });
    await screen.findByRole("heading", { name: "Activities" });

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
