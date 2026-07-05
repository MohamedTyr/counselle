import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TasksPage } from "@/features/tasks/TasksRoute";

describe("TasksPage", () => {
  it("renders the today workspace and switches task views", async () => {
    const user = userEvent.setup();
    render(<TasksPage />);

    expect(
      screen.getByRole("heading", { name: "Today, Jul 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New task" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Today/ })).toHaveAttribute(
      "data-active",
      "",
    );

    await user.click(screen.getByRole("tab", { name: /Upcoming/ }));

    expect(
      await screen.findByRole("heading", { name: "Upcoming" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /All/ }));

    expect(
      await screen.findByRole("heading", { name: "All tasks" }),
    ).toBeInTheDocument();
  });

  it("filters tasks from the route search control", async () => {
    const user = userEvent.setup();
    render(<TasksPage />);

    await user.type(
      screen.getByRole("searchbox", { name: "Search tasks" }),
      "Georgia Tech",
    );

    expect(
      screen.getByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: "Open Submit CSS Profile correction for Berkeley details",
        }),
      ).not.toBeInTheDocument();
    });
  });

  it("opens the detail sheet from an existing task", async () => {
    const user = userEvent.setup();
    render(<TasksPage />);

    await user.click(
      screen.getByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    );

    expect(
      await screen.findByRole("textbox", { name: "Task title" }),
    ).toHaveValue("Revise Georgia Tech scholarship essay");
  });

  it("opens the detail sheet from the all tasks table action", async () => {
    const user = userEvent.setup();
    render(<TasksPage />);

    await user.click(screen.getByRole("tab", { name: /All/ }));
    const table = await screen.findByRole("table");

    await user.click(
      within(table).getByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    );

    expect(
      await screen.findByRole("textbox", { name: "Task title" }),
    ).toHaveValue("Revise Georgia Tech scholarship essay");
  });

  it("creates a task from the shared page header action", async () => {
    const user = userEvent.setup();
    render(<TasksPage />);

    await user.click(screen.getByRole("button", { name: "New task" }));

    expect(
      await screen.findByRole("textbox", { name: /Task title/ }),
    ).toHaveValue("Untitled task");
  });

  it("creates an agent planning task from the shared page header action", async () => {
    const user = userEvent.setup();
    render(<TasksPage />);

    await user.click(screen.getByRole("button", { name: "Plan with agent" }));

    expect(
      await screen.findByRole("button", {
        name: "Open Let Counselle plan the next application sprint details",
      }),
    ).toBeInTheDocument();
  });
});
