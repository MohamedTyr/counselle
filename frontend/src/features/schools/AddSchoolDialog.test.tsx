import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"

import type {
  ApplicationCreate,
  ApplicationView,
  SchoolSearchResult,
} from "@/api/workspace/types"
import {
  defaultAuthenticatedFetch,
  jsonResponse,
  renderApp,
  workspaceApplicationFixture,
} from "@/test/render-app"

const princetonSearchResult: SchoolSearchResult = {
  unitid: 186131,
  name: "Princeton University",
  city: "Princeton",
  state: "NJ",
  website_url: "https://www.princeton.edu",
  on_list: false,
}

function applicationFromInput(
  input: ApplicationCreate,
  school: SchoolSearchResult,
): ApplicationView {
  return {
    ...workspaceApplicationFixture,
    id: "10000000-0000-4000-8000-000000000777",
    school_unitid: input.unitid,
    school_name: school.name,
    school_city: school.city,
    school_state: school.state,
    website_url: school.website_url,
    list_type: input.list_type,
    round: input.round,
    deadline: input.deadline ?? null,
  }
}

function statefulAddSchoolFetch(searchResult = princetonSearchResult) {
  const posts: ApplicationCreate[] = []
  let applications: ApplicationView[] = []

  const fetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)

    if (url.includes("/v1/schools/search")) {
      return jsonResponse([
        {
          ...searchResult,
          on_list:
            searchResult.on_list ||
            applications.some(
              (application) => application.school_unitid === searchResult.unitid,
            ),
        },
      ])
    }

    if (url.endsWith("/v1/applications")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as ApplicationCreate
        posts.push(body)
        const application = applicationFromInput(body, searchResult)
        applications = [application, ...applications]
        return jsonResponse({
          application,
          seeded: { task_ids: [], essay_ids: [] },
        })
      }

      return jsonResponse(applications)
    }

    if (url.includes("/v1/applications/")) {
      return jsonResponse({
        application: applications[0],
        tasks: [],
        essays: [],
      })
    }

    return defaultAuthenticatedFetch(input, init)
  }

  return { fetchHandler, posts }
}

async function openAddSchoolDialog() {
  const user = userEvent.setup()
  renderApp("/app/schools", {
    fetchHandler: statefulAddSchoolFetch().fetchHandler,
  })
  await user.click(await screen.findByRole("button", { name: "Add school" }))
  return user
}

describe("AddSchoolDialog", () => {
  it("searches, selects, confirms, and posts an application", async () => {
    const user = userEvent.setup()
    const addFetch = statefulAddSchoolFetch()
    renderApp("/app/schools", { fetchHandler: addFetch.fetchHandler })

    await user.click(await screen.findByRole("button", { name: "Add school" }))
    await user.type(screen.getByPlaceholderText("Search for a school..."), "princeton")
    await user.click(await screen.findByText("Princeton University"))

    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Princeton, NJ")).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Add school" }))

    await waitFor(() =>
      expect(addFetch.posts).toEqual([
        {
          deadline: null,
          list_type: "Target",
          round: "RD",
          unitid: 186131,
        },
      ]),
    )
    expect(await screen.findByText("1 school shown")).toBeInTheDocument()
  })

  it("opens from the keyboard shortcut", async () => {
    const user = await openAddSchoolDialog()

    await user.keyboard("{Escape}")
    await user.keyboard("{Control>}k{/Control}")

    expect(screen.getByPlaceholderText("Search for a school...")).toBeInTheDocument()
  })

  it("shows already-on-list results as disabled", async () => {
    const user = userEvent.setup()
    const onListSchool: SchoolSearchResult = {
      ...princetonSearchResult,
      on_list: true,
    }
    renderApp("/app/schools", {
      fetchHandler: statefulAddSchoolFetch(onListSchool).fetchHandler,
    })

    await user.click(await screen.findByRole("button", { name: "Add school" }))
    await user.type(screen.getByPlaceholderText("Search for a school..."), "princeton")

    expect(await screen.findByText("On your list")).toBeInTheDocument()
    expect(
      within(screen.getByRole("dialog"))
        .getByText("Princeton University")
        .closest("[cmdk-item]"),
    ).toHaveAttribute("aria-disabled", "true")
    expect(screen.queryByText("List type")).not.toBeInTheDocument()
  })

  it("shows a search error instead of the empty state", async () => {
    const user = userEvent.setup()
    renderApp("/app/schools", {
      fetchHandler: (input, init) => {
        const url = String(input)

        if (url.includes("/v1/schools/search")) {
          return jsonResponse(
            { error: { message: "Search failed" } },
            { status: 500 },
          )
        }

        return defaultAuthenticatedFetch(input, init)
      },
    })

    await user.click(await screen.findByRole("button", { name: "Add school" }))
    await user.type(screen.getByPlaceholderText("Search for a school..."), "princeton")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not search schools.",
    )
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
    expect(screen.queryByText("No schools found.")).not.toBeInTheDocument()
  })

  it("marks a cached search result as already on the list after adding it", async () => {
    const user = userEvent.setup()
    let searchCount = 0
    let resolveSecondSearch = () => undefined
    const addFetch = statefulAddSchoolFetch()
    const fetchHandler = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes("/v1/schools/search")) {
        searchCount += 1
        if (searchCount > 1) {
          return new Promise<Response>((resolve) => {
            resolveSecondSearch = () => {
              void Promise.resolve(addFetch.fetchHandler(input, init)).then(resolve)
            }
          })
        }
      }

      return addFetch.fetchHandler(input, init)
    }
    renderApp("/app/schools", { fetchHandler })

    await user.click(await screen.findByRole("button", { name: "Add school" }))
    await user.type(screen.getByPlaceholderText("Search for a school..."), "princeton")
    await user.click(await screen.findByText("Princeton University"))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add school",
      }),
    )
    await waitFor(() => expect(addFetch.posts).toHaveLength(1))
    await user.click(await screen.findByRole("button", { name: "Close" }))
    await user.click(await screen.findByRole("button", { name: "Add school" }))
    await user.type(screen.getByPlaceholderText("Search for a school..."), "princeton")

    expect(await screen.findByText("On your list")).toBeInTheDocument()
    expect(
      within(screen.getByRole("dialog"))
        .getByText("Princeton University")
        .closest("[cmdk-item]"),
    ).toHaveAttribute("aria-disabled", "true")
    expect(screen.queryByText("List type")).not.toBeInTheDocument()
    resolveSecondSearch()
  })

  it("rolls back the optimistic row when the add request fails", async () => {
    const user = userEvent.setup()
    let rejectPost: (response: Response) => void = () => undefined
    const postPromise = new Promise<Response>((resolve) => {
      rejectPost = resolve
    })
    const fetchHandler = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.includes("/v1/schools/search")) {
        return jsonResponse([princetonSearchResult])
      }

      if (url.endsWith("/v1/applications")) {
        if (init?.method === "POST") {
          return postPromise
        }

        return jsonResponse([])
      }

      return defaultAuthenticatedFetch(input, init)
    })
    renderApp("/app/schools", { fetchHandler })

    await user.click(await screen.findByRole("button", { name: "Add school" }))
    await user.type(screen.getByPlaceholderText("Search for a school..."), "princeton")
    await user.click(await screen.findByText("Princeton University"))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Add school",
      }),
    )

    expect(await screen.findByText("1 school shown")).toBeInTheDocument()

    rejectPost(jsonResponse({ error: { message: "Failed" } }, { status: 500 }))

    expect(await screen.findByText("No schools yet")).toBeInTheDocument()
  })
})
