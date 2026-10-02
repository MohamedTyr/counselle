import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/api/workspace/types";
import {
  createWorkspaceFetchPreset,
  renderApp,
  workspaceTaskFixture,
} from "@/test/render-app";

const { testNowIso } = vi.hoisted(() => ({
  // Local noon on Thursday, October 1, 2026.
  testNowIso: "2026-10-01T12:00:00",
}));

vi.mock("@/lib/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/time")>()),
  getNowDate: () => new Date(testNowIso),
}));

const draftTask: Task = {
  ...workspaceTaskFixture,
  application_id: null,
  id: "20000000-0000-4000-8000-0000000000c1",
  title: "Draft the Stanford short answers",
  when_on: "2026-10-01",
};

function gridCell(dayKey: string): HTMLElement {
  const cell = document.querySelector<HTMLElement>(
    `[role="gridcell"][data-day-key="${dayKey}"]`,
  );
  if (!cell) {
    throw new Error(`No cell for ${dayKey}`);
  }
  return cell;
}

async function renderCalendar(
  fetchHandler = createWorkspaceFetchPreset({ tasks: [draftTask] }),
) {
  renderApp("/app/calendar?view=month&date=2026-10-01", { fetchHandler });
  // The rail's mini-month is a grid too; the calendar's own sits in the sheet.
  await waitFor(() =>
    expect(
      document.querySelector('[data-calendar-sheet] [role="grid"]'),
    ).not.toBeNull(),
  );
}

describe("CalendarPage", () => {
  beforeEach(() => {
    localStorage.clear();
    window.innerWidth = 1440;
  });

  it("marks today in the grid", async () => {
    await renderCalendar();
    const today = gridCell("2026-10-01");
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAccessibleName(/Thursday, October 1, 2026, today/);
  });

  it("opens the task panel from a task chip", async () => {
    const user = userEvent.setup();
    await renderCalendar();
    const cell = gridCell("2026-10-01");
    await user.click(
      await within(cell).findByRole("button", { name: draftTask.title }),
    );
    await waitFor(() =>
      expect(window.location.search).toContain(`task=${draftTask.id}`),
    );
  });

  it("drops task chips when the Tasks calendar is turned off", async () => {
    const user = userEvent.setup();
    await renderCalendar();
    const cell = gridCell("2026-10-01");
    await within(cell).findByRole("button", { name: draftTask.title });
    await user.click(screen.getAllByRole("checkbox", { name: "Tasks" })[0]);
    expect(
      within(cell).queryByRole("button", { name: draftTask.title }),
    ).not.toBeInTheDocument();
  });

  it("opens a day in Schedule, switching view and date together", async () => {
    const user = userEvent.setup();
    await renderCalendar();
    await user.click(
      within(gridCell("2026-10-15")).getByRole("button", {
        hidden: true,
        name: /Open .*October 15.* in Schedule/,
      }),
    );
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get("view")).toBe("schedule");
      expect(params.get("date")).toBe("2026-10-15");
    });
  });

  it("pages to the next month on j", async () => {
    const user = userEvent.setup();
    await renderCalendar();
    expect(document.getElementById("calendar-range-title")).toHaveTextContent(
      "October 2026",
    );
    await user.keyboard("j");
    await waitFor(() =>
      expect(document.getElementById("calendar-range-title")).toHaveTextContent(
        "November 2026",
      ),
    );
  });

  it("never shows an empty state while a source is still loading", async () => {
    const preset = createWorkspaceFetchPreset({
      applications: [],
      essays: [],
      tasks: [],
    });
    let releaseTasks: (() => void) | undefined;
    const fetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/v1/tasks")) {
        return new Promise<Response>((resolve) => {
          releaseTasks = () => resolve(preset(input, init) as Response);
        });
      }
      return preset(input, init);
    };
    await renderCalendar(fetchHandler as typeof preset);

    expect(
      screen.queryByText(/Add schools to your list/),
    ).not.toBeInTheDocument();

    releaseTasks?.();
    expect(
      await screen.findByText(/Add schools to your list/),
    ).toBeInTheDocument();
  });
});
