import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import App from "@/App"
import { createAppRouter } from "@/app/router"

function renderApp(path = "/") {
  window.history.replaceState(null, "", path)
  return render(<App routerInstance={createAppRouter()} />)
}

function findHeading(options: Parameters<typeof screen.findByRole>[1]) {
  return screen.findByRole("heading", options, { timeout: 15_000 })
}

async function openWorkspace(label: string) {
  const user = userEvent.setup()
  const sidebar = document.querySelector('[data-slot="sidebar"]')

  if (!sidebar) {
    throw new Error("Sidebar was not rendered")
  }

  await user.click(
    within(sidebar as HTMLElement).getByRole("link", { name: label })
  )
  return user
}

function createTestDataTransfer() {
  const payload = new Map<string, string>()

  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    getData: (type: string) => payload.get(type) ?? "",
    setData: (type: string, value: string) => {
      payload.set(type, value)
    },
    setDragImage: vi.fn(),
  } as unknown as DataTransfer
}

describe("MVP3 prototype smoke coverage", () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, "", "/")
  })

  it("redirects the default route to the task workspace", async () => {
    renderApp("/")

    expect(await findHeading({ name: "Today, Jul 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New task" })).toBeInTheDocument()
    expect(window.location.pathname).toBe("/tasks")
  }, 15_000)

  it.each([
    ["/tasks", "Today, Jul 1"],
    ["/calendar", "July 2026"],
    ["/schools", "Application workspace"],
    ["/activities", "Activities"],
    ["/essays", "Essay workspace"],
    ["/essays/common-app-main", "Common App Personal Statement"],
  ])("loads %s directly", async (path, heading) => {
    renderApp(path)

    expect(await findHeading({ name: heading })).toBeInTheDocument()
    expect(window.location.pathname).toBe(path)
  })

  it("navigates between the top-level workspaces with sidebar links", async () => {
    renderApp("/tasks")
    await findHeading({ name: "Today, Jul 1" })

    await openWorkspace("Schools")
    expect(window.location.pathname).toBe("/schools")
    expect(
      await findHeading({ name: "Application workspace" })
    ).toBeInTheDocument()

    await openWorkspace("Calendar")
    expect(window.location.pathname).toBe("/calendar")
    expect(await findHeading({ name: "July 2026" })).toBeInTheDocument()

    await openWorkspace("Activities")
    expect(window.location.pathname).toBe("/activities")
    expect(await findHeading({ name: "Activities" })).toBeInTheDocument()

    await openWorkspace("Essays")
    expect(window.location.pathname).toBe("/essays")
    expect(await findHeading({ name: "Essay workspace" })).toBeInTheDocument()
  })

  it("opens an essay editor route from the essay list and returns", async () => {
    const user = userEvent.setup()
    renderApp("/essays")

    await findHeading({ name: "Essay workspace" })
    await user.click(
      await screen.findByRole("button", {
        name: "Open Common App Personal Statement",
      })
    )

    expect(
      await findHeading({
        level: 1,
        name: "Common App Personal Statement",
      })
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe("/essays/common-app-main")

    await user.click(screen.getByRole("button", { name: "Back to essays" }))

    expect(await findHeading({ name: "Essay workspace" })).toBeInTheDocument()
    expect(window.location.pathname).toBe("/essays")
  })

  it("opens an activity deep link on a direct activities route load", async () => {
    renderApp("/activities?activity=robotics-founder")

    expect(
      await findHeading({ name: "Founder & President" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Position")).toHaveValue("Founder & President")
  })

  it("opens an honor deep link on a direct activities route load", async () => {
    renderApp("/activities?honor=physics-olympiad")

    expect(
      await findHeading({
        name: "National Physics Olympiad - Silver Medal",
      })
    ).toBeInTheDocument()
    expect(screen.getByText("Edit honor")).toBeInTheDocument()
  })

  it("keeps newly created task state when moving from Tasks to Calendar", async () => {
    const user = userEvent.setup()
    renderApp("/tasks")

    await user.click(await screen.findByRole("button", { name: "New task" }))
    await user.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Calendar" })).toBeVisible()
    })

    await openWorkspace("Calendar")
    expect(window.location.pathname).toBe("/calendar")
    await user.click(await screen.findByRole("tab", { name: /Work plan/i }))

    await waitFor(() => {
      expect(screen.getByText("Untitled task")).toBeInTheDocument()
    })
  })

  it("edits a task from the detail sheet", async () => {
    const user = userEvent.setup()
    renderApp("/tasks")

    await user.click(
      await screen.findByRole("group", {
        name: "Revise Georgia Tech scholarship essay",
      })
    )

    const titleInput = await screen.findByLabelText("Task title")
    await user.clear(titleInput)
    await user.type(titleInput, "Refine Georgia Tech essay")
    await user.click(screen.getByRole("button", { name: "Close" }))

    expect(
      await screen.findByRole("group", {
        name: "Refine Georgia Tech essay",
      })
    ).toBeInTheDocument()
  })

  it("adds the agent planning task from the task workspace", async () => {
    const user = userEvent.setup()
    renderApp("/tasks")

    await user.click(
      await screen.findByRole("button", { name: "Plan with agent" })
    )

    expect(
      await screen.findByText("Let Counselle plan the next application sprint")
    ).toBeInTheDocument()
  })

  it("multi-selects tasks and drags them between today lanes", async () => {
    renderApp("/tasks")

    const firstTask = await screen.findByRole("group", {
      name: "Revise Georgia Tech scholarship essay",
    })
    const secondTask = await screen.findByRole("group", {
      name: "Submit CSS Profile correction for Berkeley",
    })

    fireEvent.click(firstTask, { ctrlKey: true })
    fireEvent.click(secondTask, { ctrlKey: true })

    expect(firstTask).toHaveAttribute("data-state", "selected")
    expect(secondTask).toHaveAttribute("data-state", "selected")

    const doneColumn = document.querySelector('[data-task-column="done"]')

    if (!(doneColumn instanceof HTMLElement)) {
      throw new Error("Done column was not rendered")
    }

    const dataTransfer = createTestDataTransfer()
    fireEvent.dragStart(firstTask, { dataTransfer })
    fireEvent.dragOver(doneColumn, { dataTransfer })
    fireEvent.drop(doneColumn, { dataTransfer })

    await waitFor(() => {
      expect(
        within(doneColumn).getByText("Revise Georgia Tech scholarship essay")
      ).toBeInTheDocument()
      expect(
        within(doneColumn).getByText(
          "Submit CSS Profile correction for Berkeley"
        )
      ).toBeInTheDocument()
    })
  })
})
