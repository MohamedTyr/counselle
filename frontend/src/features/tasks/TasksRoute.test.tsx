import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"

import type { ApplicationView, Task } from "@/api/workspace/types"
import {
  createWorkspaceFetchPreset,
  renderApp,
  workspaceApplicationFixture,
  workspaceTaskFixture,
} from "@/test/render-app"

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  const { id, title, ...rest } = overrides

  return {
    ...workspaceTaskFixture,
    id,
    title,
    ...rest,
  }
}

const georgiaTechTask = task({
  application_id: null,
  id: "20000000-0000-4000-8000-000000000001",
  planned_for: "2026-07-01T09:00:00.000Z",
  status: "todo",
  title: "Revise Georgia Tech scholarship essay",
})
const berkeleyTask = task({
  application_id: null,
  due_at: "2026-07-05T23:59:00.000Z",
  id: "20000000-0000-4000-8000-000000000002",
  planned_for: "2026-07-01T09:00:00.000Z",
  status: "doing",
  title: "Submit CSS Profile correction for Berkeley",
})

function dataTransferMock() {
  let payload = ""

  return {
    dropEffect: "",
    effectAllowed: "",
    getData: vi.fn(() => payload),
    setData: vi.fn((_type: string, value: string) => {
      payload = value
    }),
    setDragImage: vi.fn(),
  }
}

async function renderTasks(tasks: Task[] = [georgiaTechTask, berkeleyTask]) {
  renderApp("/app/tasks", {
    fetchHandler: createWorkspaceFetchPreset({ tasks }),
  })
  await screen.findByRole("tab", { name: /Today/ })
}

describe("TasksPage", () => {
  it("renders the today workspace and switches task views", async () => {
    const user = userEvent.setup()
    await renderTasks()

    expect(
      screen.getByRole("button", { name: "New task" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Today/ })).toHaveAttribute(
      "data-active",
      "",
    )

    await user.click(screen.getByRole("tab", { name: /Upcoming/ }))

    expect(
      await screen.findByRole("heading", { name: "Upcoming" }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: /All/ }))

    expect(
      await screen.findByRole("heading", { name: "All tasks" }),
    ).toBeInTheDocument()
  })

  it("filters tasks from the route search control", async () => {
    const user = userEvent.setup()
    await renderTasks()

    await user.type(
      screen.getByRole("searchbox", { name: "Search tasks" }),
      "Georgia Tech",
    )

    expect(
      screen.getByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: "Open Submit CSS Profile correction for Berkeley details",
        }),
      ).not.toBeInTheDocument()
    })
  })

  it("opens the detail sheet from an existing task", async () => {
    const user = userEvent.setup()
    await renderTasks()

    await user.click(
      screen.getByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    )

    expect(
      await screen.findByRole("textbox", { name: "Task title" }),
    ).toHaveValue("Revise Georgia Tech scholarship essay")
  })

  it("opens the detail sheet from the all tasks table action", async () => {
    const user = userEvent.setup()
    await renderTasks()

    await user.click(screen.getByRole("tab", { name: /All/ }))
    const table = await screen.findByRole("table")

    await user.click(
      within(table).getByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    )

    expect(
      await screen.findByRole("textbox", { name: "Task title" }),
    ).toHaveValue("Revise Georgia Tech scholarship essay")
  })

  it("creates a task from the shared page header action", async () => {
    const user = userEvent.setup()
    await renderTasks()

    await user.click(screen.getByRole("button", { name: "New task" }))

    expect(
      await screen.findByRole("textbox", { name: /Task title/ }),
    ).toHaveValue("Untitled task")
  })

  it("renders the plan-with-agent button disabled with a tooltip", async () => {
    await renderTasks()

    const planButton = screen.getByRole("button", { name: /Plan with agent/ })

    expect(planButton).toBeDisabled()
    expect(planButton).toHaveAttribute(
      "title",
      "Counselle agent — coming soon",
    )
  })

  it("renders the first-run empty state when there are no tasks", async () => {
    renderApp("/app/tasks", {
      fetchHandler: createWorkspaceFetchPreset({ tasks: [] }),
    })

    expect(await screen.findByText("No tasks yet")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Add your first task" }),
    ).toBeInTheDocument()
  })
})

describe("TasksPage delete with undo", () => {
  it("deletes a single task from its card menu and restores it with undo", async () => {
    const user = userEvent.setup()
    await renderTasks()

    await user.click(
      screen.getByRole("button", {
        name: "Actions for Revise Georgia Tech scholarship essay",
      }),
    )
    await user.click(screen.getByRole("menuitem", { name: "Delete" }))

    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "Open Revise Georgia Tech scholarship essay details",
        }),
      ).not.toBeInTheDocument(),
    )

    await user.click(screen.getByRole("button", { name: "Undo" }))

    expect(
      await screen.findByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    ).toBeInTheDocument()
  })

  it("deletes multiple selected tasks with the Delete key and restores both on undo", async () => {
    const user = userEvent.setup()
    await renderTasks()

    const georgiaCard = document.querySelector(
      `[data-task-id="${georgiaTechTask.id}"]`,
    ) as HTMLElement
    const berkeleyCard = document.querySelector(
      `[data-task-id="${berkeleyTask.id}"]`,
    ) as HTMLElement

    fireEvent.click(georgiaCard, { ctrlKey: true })
    fireEvent.click(berkeleyCard, { ctrlKey: true })
    fireEvent.keyDown(window, { key: "Delete" })

    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "Open Revise Georgia Tech scholarship essay details",
        }),
      ).not.toBeInTheDocument(),
    )
    expect(await screen.findByText("2 tasks deleted")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Undo" }))

    expect(
      await screen.findByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("button", {
        name: "Open Submit CSS Profile correction for Berkeley details",
      }),
    ).toBeInTheDocument()
  })

  it("does not delete selected tasks when Backspace is pressed inside an open inline picker", async () => {
    const user = userEvent.setup()
    await renderTasks()

    const georgiaCard = document.querySelector(
      `[data-task-id="${georgiaTechTask.id}"]`,
    ) as HTMLElement
    const berkeleyCard = document.querySelector(
      `[data-task-id="${berkeleyTask.id}"]`,
    ) as HTMLElement

    fireEvent.click(georgiaCard, { ctrlKey: true })
    fireEvent.click(berkeleyCard, { ctrlKey: true })

    await user.click(
      screen.getByRole("combobox", {
        name: `Change type for ${georgiaTechTask.title}`,
      }),
    )
    const [option] = await screen.findAllByRole("option")

    fireEvent.keyDown(option, { key: "Backspace" })

    expect(
      screen.getByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Open Submit CSS Profile correction for Berkeley details",
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText("2 tasks deleted")).not.toBeInTheDocument()
  })

  it("deletes a task from the detail sheet", async () => {
    const user = userEvent.setup()
    await renderTasks()

    await user.click(
      screen.getByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    )
    await screen.findByRole("textbox", { name: "Task title" })
    await user.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "Open Revise Georgia Tech scholarship essay details",
        }),
      ).not.toBeInTheDocument(),
    )
  })
})

describe("TasksPage bulk drag persistence", () => {
  it("moves a dragged task's status via the bulk-status endpoint", async () => {
    await renderTasks()

    const sourceCard = document.querySelector(
      `[data-task-id="${georgiaTechTask.id}"]`,
    )
    const targetColumn = document.querySelector('[data-task-column="done"]')

    expect(sourceCard).not.toBeNull()
    expect(targetColumn).not.toBeNull()

    const dataTransfer = dataTransferMock()

    fireEvent.dragStart(sourceCard!, { dataTransfer })
    fireEvent.dragOver(targetColumn!, { dataTransfer })
    fireEvent.drop(targetColumn!, { dataTransfer })
    fireEvent.dragEnd(sourceCard!, { dataTransfer })

    await waitFor(() => {
      expect(
        document.querySelector(`[data-task-column="done"] [data-task-id="${georgiaTechTask.id}"]`),
      ).not.toBeNull()
    })
  })
})

describe("TasksPage school and essay link picker", () => {
  function applicationsPreset(): ApplicationView[] {
    return [workspaceApplicationFixture]
  }

  it("links a task to a school and then unlinks it", async () => {
    const user = userEvent.setup()
    renderApp("/app/tasks", {
      fetchHandler: createWorkspaceFetchPreset({
        applications: applicationsPreset(),
        tasks: [georgiaTechTask],
      }),
    })

    await user.click(
      await screen.findByRole("button", {
        name: "Open Revise Georgia Tech scholarship essay details",
      }),
    )
    await screen.findByRole("textbox", { name: "Task title" })

    await user.click(screen.getByRole("combobox", { name: "Linked school" }))
    await user.click(
      await screen.findByRole("option", {
        name: workspaceApplicationFixture.school_name,
      }),
    )

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Linked school" }),
      ).toHaveTextContent(workspaceApplicationFixture.school_name),
    )

    await user.click(screen.getByRole("combobox", { name: "Linked school" }))
    await user.click(await screen.findByRole("option", { name: "No school" }))

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Linked school" }),
      ).toHaveTextContent("No school"),
    )
  })
})
