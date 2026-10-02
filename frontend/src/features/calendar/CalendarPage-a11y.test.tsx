import { screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/api/workspace/types";
import {
  createWorkspaceFetchPreset,
  renderApp,
  workspaceTaskFixture,
} from "@/test/render-app";

expect.extend(toHaveNoViolations);

/**
 * axe over each calendar view. jsdom cannot judge colour contrast or drive a
 * screen reader; this catches nested interactive controls (the chip anatomy
 * exists to avoid them), unlabeled controls, invalid ARIA in the APG grid and
 * duplicate ids.
 */

vi.mock("@/lib/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/time")>()),
  getNowDate: () => new Date("2026-10-01T12:00:00"),
}));

const tasks: Task[] = [
  {
    ...workspaceTaskFixture,
    id: "20000000-0000-4000-8000-0000000000a1",
    title: "Draft the Stanford short answers",
    when_on: "2026-10-01",
    flagged: true,
  },
  {
    ...workspaceTaskFixture,
    id: "20000000-0000-4000-8000-0000000000a2",
    title: "Finish the activities list",
    when_on: "2026-10-03",
    deadline_on: "2026-10-09",
  },
];

describe("Calendar accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
    window.innerWidth = 1440;
  });

  it.each(["month", "week", "schedule"])(
    "%s view has no axe violations",
    async (view) => {
      const { container } = renderApp(
        `/app/calendar?view=${view}&date=2026-10-01`,
        {
          fetchHandler: createWorkspaceFetchPreset({ tasks }),
        },
      );
      await screen.findAllByText("Draft the Stanford short answers");
      await waitFor(() =>
        expect(document.querySelector("[data-calendar-sheet]")).not.toBeNull(),
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
