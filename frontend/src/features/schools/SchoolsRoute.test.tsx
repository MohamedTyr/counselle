import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { School } from "@/domain/school"
import { SchoolsPage } from "@/features/schools/SchoolsRoute"

function school(overrides: Partial<School> & Pick<School, "id">): School {
  const { id, ...rest } = overrides

  return {
    id,
    name: `School ${id}`,
    shortName: id.slice(0, 2).toUpperCase(),
    location: "Somewhere, US",
    websiteUrl: "https://example.edu",
    logoUrl: "https://example.edu/favicon.ico",
    status: "Considering",
    listType: "Target",
    round: "RD",
    nextDeadline: "Jan 5, 2027",
    nextDeadlineDate: "2027-01-05",
    deadlineUrgency: "normal",
    progress: { completed: 0, total: 0 },
    essays: { completed: 0, total: 0 },
    ...rest,
  }
}

const testSchools: School[] = [
  school({
    id: "beta",
    name: "Beta University",
    status: "Submitted",
    listType: "Target",
    nextDeadline: "Mar 1, 2027",
    nextDeadlineDate: "2027-03-01",
  }),
  school({
    id: "alpha",
    name: "Alpha College",
    status: "Applying",
    listType: "Reach",
    nextDeadline: "Jan 5, 2027",
    nextDeadlineDate: "2027-01-05",
  }),
  school({
    id: "gamma",
    name: "Gamma Institute",
    status: "Considering",
    listType: "Safety",
    nextDeadline: "Feb 1, 2027",
    nextDeadlineDate: "2027-02-01",
  }),
  school({
    id: "delta",
    name: "Delta Academy",
    status: "Submitted",
    listType: "Reach",
    nextDeadline: "Apr 1, 2027",
    nextDeadlineDate: "2027-04-01",
  }),
]

function renderSchools(schools = testSchools) {
  return render(<SchoolsPage schools={schools} />)
}

function tableSchoolNames() {
  const table = screen.getByRole("table")
  return within(table)
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label"))
}

describe("SchoolsPage", () => {
  it("filters schools by list type tabs", async () => {
    const user = userEvent.setup()
    renderSchools()

    await user.click(screen.getByRole("tab", { name: /Reach/ }))

    expect(screen.getByText("2 schools shown")).toBeInTheDocument()
  })

  it("filters schools from the view dropdown", async () => {
    const user = userEvent.setup()
    renderSchools()

    await user.click(
      screen.getByRole("button", {
        name: "Choose application view filter",
      })
    )
    await user.click(screen.getByRole("menuitemradio", { name: /Submitted/ }))

    expect(screen.getByText("2 schools shown")).toBeInTheDocument()
  })

  it("sorts the desktop table by header controls", async () => {
    const user = userEvent.setup()
    renderSchools()

    const table = screen.getByRole("table")
    const schoolHeader = within(table).getByRole("button", {
      name: "School",
    })

    await user.click(schoolHeader)

    expect(tableSchoolNames()).toEqual([
      "Open Alpha College website",
      "Open Beta University website",
      "Open Delta Academy website",
      "Open Gamma Institute website",
    ])

    await user.click(schoolHeader)

    expect(tableSchoolNames()).toEqual([
      "Open Gamma Institute website",
      "Open Delta Academy website",
      "Open Beta University website",
      "Open Alpha College website",
    ])
  })

  it("exposes sort controls outside the desktop table", async () => {
    const user = userEvent.setup()
    renderSchools()

    await user.click(
      screen.getByRole("button", {
        name: "Choose school sort column",
      })
    )
    await user.click(screen.getByRole("menuitemradio", { name: "School" }))
    await user.click(screen.getByRole("button", { name: "Sort ascending" }))

    expect(
      screen.getByRole("button", { name: "Sort descending" })
    ).toBeInTheDocument()
  })

  it("renders the empty state when filters remove every school", async () => {
    const user = userEvent.setup()
    renderSchools([school({ id: "only", listType: "Target" })])

    await user.click(screen.getByRole("tab", { name: /Reach/ }))

    expect(screen.getAllByText("No schools match these filters.")).not.toEqual(
      []
    )
  })

  it("resizes columns by keyboard and cleans up pointer drag state", () => {
    const { container, unmount } = renderSchools()
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
