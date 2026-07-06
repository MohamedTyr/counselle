import { act, renderHook } from "@testing-library/react"

import { useUndoableDelete } from "@/hooks/useUndoableDelete"

describe("useUndoableDelete", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("archives immediately and restores the pending item on undo", () => {
    const archiveMutation = { mutate: vi.fn() }
    const restoreMutation = { mutate: vi.fn() }
    const { result } = renderHook(() =>
      useUndoableDelete({
        archiveMutation,
        getLabel: (item: { id: string; name: string }) => item.name,
        restoreMutation,
        windowMs: 100,
      }),
    )

    act(() => {
      result.current.archive({ id: "activity-1", name: "Robotics" })
    })

    expect(archiveMutation.mutate).toHaveBeenCalledWith(
      "activity-1",
      expect.objectContaining({ onError: expect.any(Function) }),
    )
    expect(result.current.pending).toEqual({
      id: "activity-1",
      item: { id: "activity-1", name: "Robotics" },
      label: "Robotics",
    })

    act(() => {
      result.current.undo()
    })

    expect(restoreMutation.mutate).toHaveBeenCalledWith("activity-1")
    expect(result.current.pending).toBeNull()
  })

  it("clears pending undo after the undo window", () => {
    const { result } = renderHook(() =>
      useUndoableDelete({
        archiveMutation: { mutate: vi.fn() },
        getLabel: (item: { id: string }) => item.id,
        restoreMutation: { mutate: vi.fn() },
        windowMs: 100,
      }),
    )

    act(() => {
      result.current.archive({ id: "activity-1" })
    })

    expect(result.current.pending).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.pending).toBeNull()
  })

  it("clears pending undo if the archive mutation fails", () => {
    const archiveMutation = {
      mutate: vi.fn(
        (_id: string, options?: { onError?: (error: Error) => void }) => {
          options?.onError?.(new Error("failed"))
        },
      ),
    }
    const { result } = renderHook(() =>
      useUndoableDelete({
        archiveMutation,
        getLabel: (item: { id: string }) => item.id,
        restoreMutation: { mutate: vi.fn() },
        windowMs: 100,
      }),
    )

    act(() => {
      result.current.archive({ id: "activity-1" })
    })

    expect(result.current.pending).toBeNull()
  })
})
