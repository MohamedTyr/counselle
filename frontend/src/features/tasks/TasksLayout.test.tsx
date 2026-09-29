import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";

import type { Task } from "@/api/workspace/types";
import {
  createWorkspaceFetchPreset,
  renderApp,
  workspaceTaskFixture,
} from "@/test/render-app";
import { getDateKey } from "@/features/tasks/task-dates";

const { nextClientId, testNowIso } = vi.hoisted(() => {
  let clientIdSequence = 0;

  return {
    nextClientId: (prefix: string) => {
      clientIdSequence += 1;
      return `${prefix}-1783348800000-${clientIdSequence}`;
    },
    testNowIso: "2026-07-06T12:00:00.000Z",
  };
});

vi.mock("@/lib/time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/time")>()),
  createClientId: (prefix: string) => nextClientId(prefix),
  createTimestamp: (date: Date = new Date(testNowIso)) => date.toISOString(),
  getNowDate: () => new Date(testNowIso),
}));

const testNow = new Date(testNowIso);
const todayKey = getDateKey(testNow);

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  const { id, title, ...rest } = overrides;

  return {
    ...workspaceTaskFixture,
    id,
    title,
    ...rest,
  };
}

// One task landing in each of the three tabbed views (plan P6.2's "a task
// appears in exactly one view" split) so the tab counts and the rendered
// rows can be checked against each other without any duplicated filtering.
const todayTask = task({
  id: "20000000-0000-4000-8000-000000000001",
  title: "Revise Georgia Tech scholarship essay",
  when_on: todayKey,
});
const upcomingTask = task({
  id: "20000000-0000-4000-8000-000000000002",
  title: "Submit CSS Profile correction for Berkeley",
  when_on: getDateKey(new Date(testNow.getFullYear(), testNow.getMonth(), testNow.getDate() + 3)),
});
const anytimeTask = task({
  id: "20000000-0000-4000-8000-000000000003",
  title: "Draft the UPenn supplement outline",
});

async function renderTasks(
  tasks: Task[] = [todayTask, upcomingTask, anytimeTask],
  // Render directly on the "today" child route rather than the bare
  // "/app/tasks" index, which redirects via <Navigate> on mount. That
  // redirect changes `location.pathname` a beat after the initial render,
  // and `WorkspaceOutlet`'s route-level `AnimatePresence` (keyed on
  // pathname) then keeps the pre-redirect tree mounted during its exit
  // animation — doubling every element it contains, tabs included.
  path = "/app/tasks/today",
) {
  renderApp(path, {
    fetchHandler: createWorkspaceFetchPreset({ tasks }),
  });
  // The tab row renders immediately, before `useTasks()` resolves — the
  // loading skeleton the `Outlet` shows in the meantime has no accessible
  // role tied to it, so wait for `todayTask`'s own row instead (every case
  // below includes it, and every path lands on the Today view first).
  await screen.findByRole("button", { name: todayTask.title });
}

describe("TasksLayout", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = "sidebar_state=; path=/; max-age=0";
    window.history.replaceState(null, "", "/");
    window.innerWidth = 1280;
  });

  it("renders each view with the row that belongs to it, and keeps the tab count in sync", async () => {
    const user = userEvent.setup();
    await renderTasks();

    // Today: one row, tab count 1.
    expect(screen.getByRole("tab", { name: /^Today\s*1$/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("button", { name: todayTask.title }),
    ).toBeInTheDocument();

    // Upcoming: switching tabs shows only that view's row, count 1. The
    // outgoing Today row lingers briefly under `WorkspaceOutlet`'s route
    // transition (its exit animation keeps the previous route's tree
    // mounted for a beat), so wait for it to actually leave rather than
    // asserting its absence synchronously.
    await user.click(screen.getByRole("tab", { name: /^Upcoming\s*1$/ }));
    expect(
      await screen.findByRole("button", { name: upcomingTask.title }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: todayTask.title }),
      ).not.toBeInTheDocument();
    });

    // Anytime: same check, count 1.
    await user.click(screen.getByRole("tab", { name: /^Anytime\s*1$/ }));
    expect(
      await screen.findByRole("button", { name: anytimeTask.title }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: upcomingTask.title }),
      ).not.toBeInTheDocument();
    });
  });

  it("completes a task from its row checkbox and drops it out of Today's count", async () => {
    const user = userEvent.setup();
    await renderTasks([todayTask]);

    expect(
      screen.getByRole("tab", { name: /^Today\s*1$/ }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: `Complete "${todayTask.title}"` }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: /^Today\s*0$/ }),
      ).toBeInTheDocument();
    });
  });

  it("opens the detail panel for the task named in the ?task= query param", async () => {
    await renderTasks([todayTask], `/app/tasks/today?task=${todayTask.id}`);

    expect(
      await screen.findByRole("textbox", { name: "Task title" }),
    ).toHaveValue(todayTask.title);
  });

  it("opens the detail panel when a row title is clicked", async () => {
    const user = userEvent.setup();
    await renderTasks([todayTask]);

    await user.click(screen.getByRole("button", { name: todayTask.title }));

    expect(
      await screen.findByRole("textbox", { name: "Task title" }),
    ).toHaveValue(todayTask.title);
  });

  // Regression: `CommandDialog` supplies only the Dialog shell, so a
  // `CommandInput` rendered without a `Command` root threw
  // "Cannot read properties of undefined (reading 'subscribe')" from cmdk
  // and took the whole route down through the error boundary.
  it("opens search without crashing and filters the cached tasks", async () => {
    const user = userEvent.setup();
    await renderTasks();

    await user.keyboard("/");

    const input = await screen.findByPlaceholderText("Search tasks…");
    await user.type(input, "Georgia");

    expect(
      await screen.findByRole("button", { name: todayTask.title }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: anytimeTask.title }),
      ).not.toBeInTheDocument();
    });
  });
});
