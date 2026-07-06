import { render } from "@testing-library/react"
import { vi } from "vitest"

import App from "@/App"
import { createAppRouter } from "@/app/router"
import { createQueryClient } from "@/app/query-client"
import type { MeData } from "@/api/http/auth"
import type {
  Activity,
  ApplicationView,
  ChangeEvent,
  EssaySummary,
  Honor,
  SchoolSearchResult,
  Task,
} from "@/api/workspace/types"

export const authUserFixture: MeData = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "student@counselle.test",
  name: "Student User",
  has_password: true,
  google_connected: false,
  settings: {},
}

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>

type RenderAppOptions = {
  fetchHandler?: FetchHandler
}

export function createTestQueryClient() {
  return createQueryClient()
}

export function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
}

export function emptyResponse(init?: ResponseInit) {
  return new Response(null, { status: 204, ...init })
}

export const workspaceApplicationFixture: ApplicationView = {
  id: "10000000-0000-4000-8000-000000000001",
  user_id: authUserFixture.id,
  school_unitid: 166027,
  school_name: "Harvard University",
  school_city: "Cambridge",
  school_state: "MA",
  website_url: "https://www.harvard.edu",
  status: "Considering",
  list_type: "Target",
  round: "RD",
  deadline: null,
  progress: { completed: 0, total: 6 },
  essays: { completed: 0, total: 1 },
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
  archived_at: null,
}

export const workspaceSchoolSearchFixture: SchoolSearchResult = {
  unitid: 166027,
  name: "Harvard University",
  city: "Cambridge",
  state: "MA",
  website_url: "https://www.harvard.edu",
  on_list: false,
}

export const workspaceTaskFixture: Task = {
  id: "20000000-0000-4000-8000-000000000001",
  user_id: authUserFixture.id,
  application_id: workspaceApplicationFixture.id,
  essay_id: null,
  title: "Request transcript",
  notes: null,
  status: "todo",
  category: "form",
  priority: "med",
  assignee: "student",
  needs_input: false,
  due_at: null,
  planned_for: null,
  reminder_at: null,
  completed_at: null,
  archived_via_application: null,
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
  archived_at: null,
}

export const workspaceEssayFixture: EssaySummary = {
  id: "30000000-0000-4000-8000-000000000001",
  user_id: authUserFixture.id,
  application_id: workspaceApplicationFixture.id,
  title: "Supplemental essay",
  essay_type: "Supplement",
  status: "Not started",
  prompt: null,
  preview: "",
  word_count: 0,
  word_limit: null,
  comment_count: 0,
  suggestion_count: 0,
  archived_via_application: null,
  school_name: "Harvard University",
  school_city: "Cambridge",
  school_state: "MA",
  deadline: null,
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
  archived_at: null,
}

export const workspaceActivityFixture: Activity = {
  id: "40000000-0000-4000-8000-000000000001",
  user_id: authUserFixture.id,
  sort_order: 1,
  activity_type: "Robotics",
  position: "Founder",
  organization: "Robotics Club",
  description: "Led robot design",
  grades: ["11", "12"],
  timing: ["school_year"],
  hours_per_week: 5,
  weeks_per_year: 30,
  continue_in_college: true,
  story: null,
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
  archived_at: null,
}

export const workspaceHonorFixture: Honor = {
  id: "50000000-0000-4000-8000-000000000001",
  user_id: authUserFixture.id,
  sort_order: 1,
  title: "National Physics Olympiad",
  grades: ["12"],
  levels: ["national"],
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
  archived_at: null,
}

export type WorkspaceFetchPreset = Partial<{
  applications: ApplicationView[]
  schoolSearch: SchoolSearchResult[]
  tasks: Task[]
  essays: EssaySummary[]
  activities: Activity[]
  honors: Honor[]
}>

export function createWorkspaceFetchPreset(
  preset: WorkspaceFetchPreset = {},
): FetchHandler {
  let applications = preset.applications ?? [workspaceApplicationFixture]
  let archivedApplications: ApplicationView[] = []
  let tasks = preset.tasks ?? [workspaceTaskFixture]
  let archivedTasks: Task[] = []
  const data = {
    schoolSearch: preset.schoolSearch ?? [workspaceSchoolSearchFixture],
    essays: preset.essays ?? [workspaceEssayFixture],
    activities: preset.activities ?? [workspaceActivityFixture],
    honors: preset.honors ?? [workspaceHonorFixture],
  }

  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/v1/schools/search")) return jsonResponse(data.schoolSearch)
    if (url.endsWith("/v1/applications")) {
      if (init?.method === "POST") {
        const inputBody = JSON.parse(String(init.body ?? "{}"))
        const searchResult = data.schoolSearch.find(
          (school) => school.unitid === inputBody.unitid,
        )
        const application: ApplicationView = {
          ...workspaceApplicationFixture,
          id: "10000000-0000-4000-8000-000000000099",
          school_unitid: inputBody.unitid,
          school_name: searchResult?.name ?? "Added School",
          school_city: searchResult?.city ?? null,
          school_state: searchResult?.state ?? null,
          website_url: searchResult?.website_url ?? null,
          list_type: inputBody.list_type,
          round: inputBody.round,
          deadline: inputBody.deadline ?? null,
        }
        applications = [application, ...applications]
        return jsonResponse({
          application,
          seeded: { task_ids: [], essay_ids: [] },
        })
      }

      return jsonResponse(applications)
    }
    if (url.includes("/v1/applications/")) {
      const applicationId = url.split("/v1/applications/")[1]?.split("/")[0]
      if (init?.method === "DELETE") {
        const archivedApplication = applications.find(
          (application) => application.id === applicationId,
        )
        applications = applications.filter((application) => application.id !== applicationId)
        if (archivedApplication) {
          archivedApplications = [
            { ...archivedApplication, archived_at: new Date().toISOString() },
            ...archivedApplications.filter(
              (application) => application.id !== applicationId,
            ),
          ]
        }
        return emptyResponse()
      }
      if (url.endsWith("/restore")) {
        const restoredApplication = archivedApplications.find(
          (application) => application.id === applicationId,
        )
        if (restoredApplication) {
          applications = [
            { ...restoredApplication, archived_at: null },
            ...applications.filter((application) => application.id !== applicationId),
          ]
          archivedApplications = archivedApplications.filter(
            (application) => application.id !== applicationId,
          )
        }
        return emptyResponse()
      }
      if (init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body ?? "{}"))
        applications = applications.map((application) =>
          application.id === applicationId ? { ...application, ...patch } : application,
        )
        return jsonResponse(
          applications.find((application) => application.id === applicationId) ??
            applications[0],
        )
      }
      const application =
        applications.find((item) => item.id === applicationId) ?? applications[0]
      return jsonResponse({
        application,
        tasks,
        essays: data.essays,
      })
    }
    if (url.endsWith("/v1/tasks/bulk-status")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        ids: string[]
        status: Task["status"]
      }
      const movingIds = new Set(body.ids)
      const timestamp = new Date().toISOString()
      tasks = tasks.map((task) =>
        movingIds.has(task.id)
          ? {
              ...task,
              status: body.status,
              completed_at:
                body.status === "done" ? (task.completed_at ?? timestamp) : null,
            }
          : task,
      )
      return jsonResponse(tasks.filter((task) => movingIds.has(task.id)))
    }
    if (url.endsWith("/v1/tasks/bulk-archive")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { ids: string[] }
      const removingIds = new Set(body.ids)
      const timestamp = new Date().toISOString()
      const archived = tasks
        .filter((task) => removingIds.has(task.id))
        .map((task) => ({ ...task, archived_at: timestamp }))
      archivedTasks = [
        ...archived,
        ...archivedTasks.filter((task) => !removingIds.has(task.id)),
      ]
      tasks = tasks.filter((task) => !removingIds.has(task.id))
      return jsonResponse(archived)
    }
    if (url.endsWith("/v1/tasks")) {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"))
        const task: Task = {
          ...workspaceTaskFixture,
          id: crypto.randomUUID(),
          application_id: body.application_id ?? null,
          essay_id: body.essay_id ?? null,
          title: body.title,
          notes: body.notes ?? null,
          status: body.status ?? "todo",
          category: body.category ?? "other",
          priority: body.priority ?? "med",
          assignee: body.assignee ?? "student",
          needs_input: body.needs_input ?? false,
          due_at: body.due_at ?? null,
          planned_for: body.planned_for ?? null,
          reminder_at: body.reminder_at ?? null,
          completed_at: null,
          archived_via_application: null,
        }
        tasks = [task, ...tasks]
        return jsonResponse(task)
      }

      return jsonResponse(tasks)
    }
    if (url.includes("/v1/tasks/")) {
      const taskId = url.split("/v1/tasks/")[1]?.split("/")[0]
      if (init?.method === "DELETE") {
        const archivedTask = tasks.find((task) => task.id === taskId)
        tasks = tasks.filter((task) => task.id !== taskId)
        if (archivedTask) {
          archivedTasks = [
            { ...archivedTask, archived_at: new Date().toISOString() },
            ...archivedTasks.filter((task) => task.id !== taskId),
          ]
        }
        return emptyResponse()
      }
      if (url.endsWith("/restore")) {
        const restoredTask = archivedTasks.find((task) => task.id === taskId)
        if (restoredTask) {
          const restored = { ...restoredTask, archived_at: null }
          tasks = [restored, ...tasks.filter((task) => task.id !== taskId)]
          archivedTasks = archivedTasks.filter((task) => task.id !== taskId)
          return jsonResponse(restored)
        }
        return jsonResponse(tasks[0])
      }
      if (init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body ?? "{}"))
        tasks = tasks.map((task) =>
          task.id === taskId ? { ...task, ...patch } : task,
        )
        return jsonResponse(
          tasks.find((task) => task.id === taskId) ?? tasks[0],
        )
      }
      return jsonResponse(tasks.find((task) => task.id === taskId) ?? tasks[0])
    }
    if (url.endsWith("/v1/essays")) return jsonResponse(data.essays)
    if (url.includes("/v1/essays/")) {
      if (init?.method === "DELETE") return emptyResponse()
      return jsonResponse({ ...data.essays[0], content: {}, comments: [], suggestions: [] })
    }
    if (url.endsWith("/v1/activities")) return jsonResponse(data.activities)
    if (url.includes("/v1/activities/")) {
      if (init?.method === "DELETE") return emptyResponse()
      return jsonResponse(data.activities[0])
    }
    if (url.endsWith("/v1/honors")) return jsonResponse(data.honors)
    if (url.includes("/v1/honors/")) {
      if (init?.method === "DELETE") return emptyResponse()
      return jsonResponse(data.honors[0])
    }
    return defaultAuthenticatedFetch(input, init)
  }
}

export class MockWorkspaceEventSource {
  static instances: MockWorkspaceEventSource[] = []

  readonly listeners = new Map<string, Set<EventListener>>()
  onerror: ((event: Event) => void) | null = null
  readonly url: string
  readonly withCredentials: boolean | undefined
  closed = false

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url)
    this.withCredentials = init?.withCredentials
    MockWorkspaceEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener)
  }

  close() {
    this.closed = true
  }

  emit(type: ChangeEvent["type"], data: ChangeEvent) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }

  emitError() {
    this.onerror?.(new Event("error"))
  }
}

export function installMockEventSource() {
  MockWorkspaceEventSource.instances = []
  vi.stubGlobal("EventSource", MockWorkspaceEventSource)
}

export function defaultAuthenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const url = String(input)
  if (url.endsWith("/v1/me")) {
    return jsonResponse(authUserFixture)
  }
  if (url.endsWith("/v1/auth/logout") && init?.method === "POST") {
    return emptyResponse()
  }
  if (url.endsWith("/v1/config")) {
    return jsonResponse({
      greeting: "Where should we begin?",
      season_note: null,
      conversation_starters: [],
      default_source_config: null,
    })
  }
  if (url.endsWith("/v1/sessions?limit=50")) {
    return jsonResponse({ sessions: [], next_cursor: null })
  }
  if (url.includes("/v1/schools/search")) {
    return jsonResponse([workspaceSchoolSearchFixture])
  }
  if (url.endsWith("/v1/applications")) {
    return jsonResponse([workspaceApplicationFixture])
  }
  if (url.includes("/v1/applications/")) {
    if (init?.method === "DELETE") return emptyResponse()
    if (url.endsWith("/restore")) return emptyResponse()
    if (init?.method === "PATCH") {
      return jsonResponse({
        ...workspaceApplicationFixture,
        ...JSON.parse(String(init.body ?? "{}")),
      })
    }
    return jsonResponse({
      application: workspaceApplicationFixture,
      tasks: [workspaceTaskFixture],
      essays: [workspaceEssayFixture],
    })
  }
  if (url.endsWith("/v1/tasks")) return jsonResponse([workspaceTaskFixture])
  if (url.endsWith("/v1/essays")) return jsonResponse([workspaceEssayFixture])
  if (url.endsWith("/v1/activities")) {
    return jsonResponse([workspaceActivityFixture])
  }
  if (url.endsWith("/v1/honors")) return jsonResponse([workspaceHonorFixture])
  return jsonResponse({})
}

function createDefaultAuthenticatedFetch() {
  let loggedOut = false
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/v1/me")) {
      return loggedOut
        ? jsonResponse({ detail: "Unauthorized" }, { status: 401 })
        : jsonResponse(authUserFixture)
    }
    if (url.endsWith("/v1/auth/logout") && init?.method === "POST") {
      loggedOut = true
      return emptyResponse()
    }
    return defaultAuthenticatedFetch(input, init)
  }
}

export function anonymousFetch(input: RequestInfo | URL) {
  const url = String(input)
  if (url.endsWith("/v1/me")) {
    return jsonResponse({ detail: "Unauthorized" }, { status: 401 })
  }
  return jsonResponse({})
}

export function authErrorFetch(input: RequestInfo | URL) {
  const url = String(input)
  if (url.endsWith("/v1/me")) {
    return jsonResponse({ error: { message: "Server failed" } }, { status: 500 })
  }
  return jsonResponse({})
}

export function renderApp(path = "/", options: RenderAppOptions = {}) {
  window.history.replaceState(null, "", path)
  const queryClient = createTestQueryClient()
  installMockEventSource()
  vi.stubGlobal(
    "fetch",
    vi.fn(options.fetchHandler ?? createDefaultAuthenticatedFetch()),
  )
  return {
    queryClient,
    ...render(
      <App queryClient={queryClient} routerInstance={createAppRouter()} />,
    ),
  }
}
