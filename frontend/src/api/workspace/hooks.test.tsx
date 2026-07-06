import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import type { PropsWithChildren } from "react"

import {
  useArchiveEssay,
  useCreateEssay,
  useCreateTask,
  useUpdateApplication,
  useUpdateEssay,
  useUpdateTask,
} from "@/api/workspace/hooks"
import { workspaceKeys } from "@/api/workspace/keys"
import type {
  ApplicationDetail,
  ApplicationView,
  Essay,
  EssaySummary,
  Task,
} from "@/api/workspace/types"
import {
  createTestQueryClient,
  emptyResponse,
  jsonResponse,
  workspaceApplicationFixture,
  workspaceEssayFixture,
  workspaceTaskFixture,
} from "@/test/render-app"

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe("workspace mutation hooks", () => {
  it("optimistically inserts a created task and replaces it with the server row", async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(workspaceKeys.tasks.list(), [])
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const deferred = deferredResponse()
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise))

    const { result } = renderHook(() => useCreateTask(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ title: "Draft supplement" })
    })

    await waitFor(() => {
      const tasks = queryClient.getQueryData(workspaceKeys.tasks.list())
      expect(tasks).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^temp-/),
          title: "Draft supplement",
        }),
      ])
    })

    deferred.resolve(
      jsonResponse({ ...workspaceTaskFixture, title: "Draft supplement" }),
    )

    await waitFor(() => {
      const tasks = queryClient.getQueryData(workspaceKeys.tasks.list())
      expect(tasks).toEqual([
        expect.objectContaining({
          id: workspaceTaskFixture.id,
          title: "Draft supplement",
        }),
      ])
    })

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workspaceKeys.applications.detail(
          workspaceTaskFixture.application_id!,
        ),
      })
    })
  })

  it("optimistically sets completed_at when a single task update marks it done", async () => {
    const queryClient = createTestQueryClient()
    const openTask: Task = { ...workspaceTaskFixture, completed_at: null }
    queryClient.setQueryData(workspaceKeys.tasks.list(), [openTask])
    const deferred = deferredResponse()
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise))

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ id: openTask.id, patch: { status: "done" } })
    })

    await waitFor(() => {
      const tasks = queryClient.getQueryData<Task[]>(workspaceKeys.tasks.list())
      expect(tasks?.[0]?.status).toBe("done")
      expect(tasks?.[0]?.completed_at).not.toBeNull()
    })

    deferred.resolve(jsonResponse({ ...openTask, status: "done" }))
  })

  it("optimistically clears completed_at when a task is moved out of done", async () => {
    const queryClient = createTestQueryClient()
    const doneTask: Task = {
      ...workspaceTaskFixture,
      status: "done",
      completed_at: "2026-01-01T00:00:00.000Z",
    }
    queryClient.setQueryData(workspaceKeys.tasks.list(), [doneTask])
    const deferred = deferredResponse()
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise))

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ id: doneTask.id, patch: { status: "todo" } })
    })

    await waitFor(() => {
      const tasks = queryClient.getQueryData<Task[]>(workspaceKeys.tasks.list())
      expect(tasks?.[0]?.status).toBe("todo")
      expect(tasks?.[0]?.completed_at).toBeNull()
    })

    deferred.resolve(jsonResponse({ ...doneTask, status: "todo", completed_at: null }))
  })

  it("rolls back optimistic application list and detail patches on error", async () => {
    const queryClient = createTestQueryClient()
    const detail: ApplicationDetail = {
      application: workspaceApplicationFixture,
      tasks: [],
      essays: [],
    }
    queryClient.setQueryData(workspaceKeys.applications.list(), [
      workspaceApplicationFixture,
    ])
    queryClient.setQueryData(
      workspaceKeys.applications.detail(workspaceApplicationFixture.id),
      detail,
    )
    const deferred = deferredResponse()
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise))

    const { result } = renderHook(() => useUpdateApplication(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      result.current.mutate({
        id: workspaceApplicationFixture.id,
        patch: { status: "Applying" },
      })
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ApplicationDetail>(
          workspaceKeys.applications.detail(workspaceApplicationFixture.id),
        )?.application.status,
      ).toBe("Applying")
    })

    deferred.resolve(jsonResponse({ detail: "failed" }, { status: 500 }))

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ApplicationDetail>(
          workspaceKeys.applications.detail(workspaceApplicationFixture.id),
        )?.application.status,
      ).toBe(workspaceApplicationFixture.status)
    })
    expect(
      queryClient.getQueryData<ApplicationView[]>(
        workspaceKeys.applications.list(),
      )?.[0]?.status,
    ).toBe(workspaceApplicationFixture.status)
  })

  it("rolls back optimistic essay list and detail patches on error", async () => {
    const queryClient = createTestQueryClient()
    const essay: Essay = {
      ...workspaceEssayFixture,
      content: {},
      comments: [],
      suggestions: [],
    }
    queryClient.setQueryData(workspaceKeys.essays.list(), [
      workspaceEssayFixture,
    ])
    queryClient.setQueryData(workspaceKeys.essays.detail(essay.id), essay)
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const deferred = deferredResponse()
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise))

    const { result } = renderHook(() => useUpdateEssay(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      result.current.mutate({
        id: essay.id,
        patch: { title: "Changed title" },
      })
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Essay>(workspaceKeys.essays.detail(essay.id))
          ?.title,
      ).toBe("Changed title")
    })

    deferred.resolve(jsonResponse({ detail: "failed" }, { status: 500 }))

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Essay>(workspaceKeys.essays.detail(essay.id))
          ?.title,
      ).toBe(workspaceEssayFixture.title)
    })
    expect(
      queryClient.getQueryData<EssaySummary[]>(
        workspaceKeys.essays.list(),
      )?.[0]?.title,
    ).toBe(workspaceEssayFixture.title)
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: workspaceKeys.applications.detail(
        workspaceEssayFixture.application_id!,
      ),
    })
  })

  it("invalidates application detail after creating an application essay", async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(workspaceKeys.essays.list(), [])
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse(workspaceEssayFixture)))

    const { result } = renderHook(() => useCreateEssay(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      result.current.mutate({
        application_id: workspaceApplicationFixture.id,
        title: "Supplemental essay",
      })
    })

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workspaceKeys.applications.detail(
          workspaceApplicationFixture.id,
        ),
      })
    })
  })

  it("removes archived essay detail cache before any SSE echo", async () => {
    const queryClient = createTestQueryClient()
    const essay: Essay = {
      ...workspaceEssayFixture,
      content: {},
      comments: [],
      suggestions: [],
    }
    queryClient.setQueryData(workspaceKeys.essays.list(), [
      workspaceEssayFixture,
    ])
    queryClient.setQueryData(workspaceKeys.essays.detail(essay.id), essay)
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const deferred = deferredResponse()
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise))

    const { result } = renderHook(() => useArchiveEssay(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      result.current.mutate(essay.id)
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<Essay>(workspaceKeys.essays.detail(essay.id)),
      ).toBeUndefined()
    })
    expect(queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list()))
      .toEqual([])

    deferred.resolve(emptyResponse())

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workspaceKeys.essays.detail(essay.id),
      })
    })
    expect(
      queryClient.getQueryData<Essay>(workspaceKeys.essays.detail(essay.id)),
    ).toBeUndefined()
  })

  it("rolls back archived essay list and detail caches on error", async () => {
    const queryClient = createTestQueryClient()
    const previousList: EssaySummary[] = [workspaceEssayFixture]
    const previousDetail: Essay = {
      ...workspaceEssayFixture,
      content: {},
      comments: [],
      suggestions: [],
    }
    queryClient.setQueryData(workspaceKeys.essays.list(), previousList)
    queryClient.setQueryData(
      workspaceKeys.essays.detail(previousDetail.id),
      previousDetail,
    )
    const deferred = deferredResponse()
    vi.stubGlobal("fetch", vi.fn(() => deferred.promise))

    const { result } = renderHook(() => useArchiveEssay(), {
      wrapper: wrapper(queryClient),
    })

    act(() => {
      result.current.mutate(previousDetail.id)
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list()),
      ).toEqual([])
      expect(
        queryClient.getQueryData<Essay>(
          workspaceKeys.essays.detail(previousDetail.id),
        ),
      ).toBeUndefined()
    })

    deferred.resolve(jsonResponse({ detail: "failed" }, { status: 500 }))

    await waitFor(() => {
      expect(
        queryClient.getQueryData<EssaySummary[]>(workspaceKeys.essays.list()),
      ).toEqual(previousList)
      expect(
        queryClient.getQueryData<Essay>(
          workspaceKeys.essays.detail(previousDetail.id),
        ),
      ).toEqual(previousDetail)
    })
  })
})
