import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import { taskFromApi } from "@/domain/task";
import { TaskDetailPanel } from "@/features/tasks/TaskDetailPanel";
import {
  workspaceApplicationFixture,
  workspaceTaskFixture,
} from "@/test/render-app";

const mutate = vi.fn();

vi.mock("@/api/workspace/hooks", () => ({
  useUpdateTask: () => ({ mutate }),
  useScheduleTask: () => ({ mutate }),
}));

/*
 * spec §2.4 — deadline inheritance is an honesty surface: when a task has no
 * `deadline_on` of its own but its linked application has a deadline, the
 * panel *displays* that date, attributed to the school, and never writes it
 * to the task. This is the one test this file gets (plan §P5.6) — everything
 * else in this component follows CLAUDE.md's no-reflexive-tests stance.
 */
describe("TaskDetailPanel — deadline inheritance (spec §2.4)", () => {
  beforeEach(() => {
    // Pins the panel's reference year so `formatMonthDay` doesn't append a
    // year suffix, keeping the assertion below ("Jan 1") independent of
    // whatever year the test happens to run in.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the linked application's deadline as inherited and attributed, and never sends it in a patch", () => {
    const application: ApplicationView = {
      ...workspaceApplicationFixture,
      deadline: "2026-01-01",
      school_name: "Berkeley",
    };
    const task = taskFromApi({
      ...workspaceTaskFixture,
      application_id: application.id,
      deadline_on: null,
      essay_id: null,
    });
    const applicationsById = new Map([[application.id, application]]);
    const essaysById = new Map<string, EssaySummary>();

    render(
      <TaskDetailPanel
        applicationsById={applicationsById}
        essaysById={essaysById}
        onOpenChange={() => {}}
        open
        task={task}
      />,
    );

    // Displayed: the inherited date, attributed to the school it came from.
    expect(screen.getByText("Jan 1")).toBeInTheDocument();
    expect(screen.getByText("· from Berkeley")).toBeInTheDocument();

    // Never written: the task's own field stays unset, and no patch was
    // ever sent (mounting alone must not autosave anything).
    expect(task.deadline_on).toBeUndefined();
    expect(mutate).not.toHaveBeenCalled();
  });
});
