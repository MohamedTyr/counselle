import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { ApplicationView } from "@/api/workspace/types"
import {
  createWorkspaceFetchPreset,
  renderApp,
  workspaceApplicationFixture,
  workspaceTaskFixture,
} from "@/test/render-app"

function application(
  overrides: Partial<ApplicationView> & Pick<ApplicationView, "id">,
): ApplicationView {
  const { id, ...rest } = overrides

  return {
    ...workspaceApplicationFixture,
    id,
    school_unitid: Number(id.replace(/\D/g, "").slice(0, 6)) || 1,
    school_name: `School ${id}`,
    school_city: "Somewhere",
    school_state: "US",
    website_url: "https://example.edu",
    status: "Considering",
    list_type: "Target",
    round: "RD",
    deadline: "2027-01-05",
    progress: { completed: 0, total: 0 },
    essays: { completed: 0, total: 0 },
    ...rest,
  }
}

const testApplications: ApplicationView[] = [
  application({
    id: "10000000-0000-4000-8000-000000000002",
    school_name: "Beta University",
    status: "Submitted",
    list_type: "Target",
    deadline: "2027-03-01",
  }),
  application({
    id: "10000000-0000-4000-8000-000000000001",
    school_name: "Alpha College",
    status: "Applying",
    list_type: "Reach",
    deadline: "2027-01-05",
  }),
  application({
    id: "10000000-0000-4000-8000-000000000003",
    school_name: "Gamma Institute",
    status: "Considering",
    list_type: "Safety",
    deadline: "2027-02-01",
  }),
  application({
    id: "10000000-0000-4000-8000-000000000004",
    school_name: "Delta Academy",
    status: "Submitted",
    list_type: "Reach",
    deadline: "2027-04-01",
  }),
]

async function renderSchools(applications = testApplications) {
  renderApp("/app/schools", {
    fetchHandler: createWorkspaceFetchPreset({ applications }),
  })
  await screen.findByRole("table")
}

function tableSchoolNames() {
  const table = screen.getByRole("table")
  return within(table)
    .getAllByRole("button", { name: /Open .* details/ })
    .map((button) => button.getAttribute("aria-label"))
}

describe("SchoolsPage", () => {
  it("filters schools by list type tabs", async () => {
    const user = userEvent.setup()
    await renderSchools()

    await user.click(screen.getByRole("tab", { name: /Reach/ }))

    expect(screen.getByText("2 schools shown")).toBeInTheDocument()
  })

  it("filters schools from the view dropdown", async () => {
    const user = userEvent.setup()
    await renderSchools()

    await user.click(
      screen.getByRole("button", {
        name: "Choose application view filter",
      }),
    )
    await user.click(screen.getByRole("menuitemradio", { name: /Submitted/ }))

    expect(screen.getByText("2 schools shown")).toBeInTheDocument()
  })

  it("sorts the desktop table by header controls", async () => {
    const user = userEvent.setup()
    await renderSchools()

    const table = screen.getByRole("table")
    const schoolHeader = within(table).getByRole("button", {
      name: "School",
    })

    await user.click(schoolHeader)

    expect(tableSchoolNames()).toEqual([
      "Open Alpha College details",
      "Open Beta University details",
      "Open Delta Academy details",
      "Open Gamma Institute details",
    ])

    await user.click(schoolHeader)

    expect(tableSchoolNames()).toEqual([
      "Open Gamma Institute details",
      "Open Delta Academy details",
      "Open Beta University details",
      "Open Alpha College details",
    ])
  })

  it("exposes sort controls outside the desktop table", async () => {
    const user = userEvent.setup()
    await renderSchools()

    await user.click(
      screen.getByRole("button", {
        name: "Choose school sort column",
      }),
    )
    await user.click(screen.getByRole("menuitemradio", { name: "School" }))
    await user.click(screen.getByRole("button", { name: "Sort ascending" }))

    expect(
      screen.getByRole("button", { name: "Sort descending" }),
    ).toBeInTheDocument()
  })

  it("renders the first-run empty state when there are no applications", async () => {
    renderApp("/app/schools", {
      fetchHandler: createWorkspaceFetchPreset({ applications: [] }),
    })

    expect(await screen.findByText("No schools yet")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Add your first school" }),
    ).toBeInTheDocument()
  })

  it("renders the filter empty state when filters remove every school", async () => {
    const user = userEvent.setup()
    await renderSchools([
      application({
        id: "10000000-0000-4000-8000-000000000010",
        list_type: "Target",
      }),
    ])

    await user.click(screen.getByRole("tab", { name: /Reach/ }))

    expect(screen.getAllByText("No schools match these filters.")).not.toEqual(
      [],
    )
  })

  it("opens the detail sheet from the school query param and patches inline edits", async () => {
    const fetchSpy = createWorkspaceFetchPreset({ applications: testApplications })
    renderApp(
      "/app/schools?school=10000000-0000-4000-8000-000000000001",
      { fetchHandler: fetchSpy },
    )

    expect(await screen.findByText("Linked tasks")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Deadline"), {
      target: { value: "2027-02-01" },
    })

    await waitFor(() =>
      expect(screen.getByLabelText("Deadline")).toHaveValue("2027-02-01"),
    )
  })

  it("links linked tasks to the tasks route URL state", async () => {
    const user = userEvent.setup()
    const taskId = "20000000-0000-4000-8000-000000000777"
    renderApp(
      "/app/schools?school=10000000-0000-4000-8000-000000000001",
      {
        fetchHandler: createWorkspaceFetchPreset({
          applications: testApplications,
          tasks: [
            {
              ...workspaceTaskFixture,
              id: taskId,
              title: "Submit financial aid form",
            },
          ],
        }),
      },
    )

    const taskLink = await screen.findByRole("link", {
      name: "Submit financial aid form",
    })

    expect(taskLink).toHaveAttribute("href", `/app/tasks?task=${taskId}`)

    await user.click(taskLink)

    await waitFor(() => expect(window.location.pathname).toBe("/app/tasks"))
    expect(window.location.search).toBe(`?task=${taskId}`)
  })

  it("archives a school from the detail sheet with undo", async () => {
    const user = userEvent.setup()
    await renderSchools()

    await user.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "Open Alpha College details",
      }),
    )
    await screen.findByText("Linked tasks")
    await user.click(screen.getByRole("button", { name: "Archive" }))

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open Alpha College details" }),
      ).not.toBeInTheDocument(),
    )
    expect(
      screen.queryByRole("button", { name: "Open Alpha College details" }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Undo" }))

    expect(
      await screen.findAllByRole("button", {
        name: "Open Alpha College details",
      }),
    ).not.toEqual([])
  })

  it("resizes columns by keyboard and cleans up pointer drag state", async () => {
    const { container, unmount } = renderApp("/app/schools", {
      fetchHandler: createWorkspaceFetchPreset({
        applications: testApplications,
      }),
    })
    await screen.findByRole("table")
    const resizeHandle = screen.getByRole("button", {
      name: "Resize School column",
    })
    const schoolColumn = container.querySelector('col[data-column="school"]')

    fireEvent.keyDown(resizeHandle, { key: "ArrowRight" })

    expect(schoolColumn).toHaveStyle({ width: "308px" })

    fireEvent.pointerDown(resizeHandle, { clientX: 0 })
    fireEvent.pointerMove(window, { clientX: 40 })

    expect(document.body.style.cursor).toBe("col-resize")

    unmount()

    expect(document.body.style.cursor).toBe("")
    expect(document.body.style.userSelect).toBe("")
  })
})
