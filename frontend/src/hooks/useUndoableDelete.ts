import { useCallback, useEffect, useRef, useState } from "react"
export const UNDO_WINDOW_MS = 5000

type PendingUndo<TItem extends { id: string }> = {
  id: string
  item: TItem
  label: string
} | null

type UndoMutation = {
  mutate: (id: string, options?: { onError?: (error: Error) => void }) => void
}

export function useUndoableDelete<TItem extends { id: string }>({
  archiveMutation,
  getLabel,
  restoreMutation,
  windowMs = UNDO_WINDOW_MS,
}: {
  archiveMutation: UndoMutation
  getLabel: (item: TItem) => string
  restoreMutation: UndoMutation
  windowMs?: number
}) {
  const [pending, setPending] = useState<PendingUndo<TItem>>(null)
  const timeoutRef = useRef<number | undefined>(undefined)

  const clearPending = useCallback(() => {
    window.clearTimeout(timeoutRef.current)
    setPending(null)
  }, [])

  const archive = useCallback(
    (item: TItem) => {
      window.clearTimeout(timeoutRef.current)
      setPending({ id: item.id, item, label: getLabel(item) })
      archiveMutation.mutate(item.id, {
        onError: clearPending,
      })
      timeoutRef.current = window.setTimeout(clearPending, windowMs)
    },
    [archiveMutation, clearPending, getLabel, windowMs],
  )

  const undo = useCallback(() => {
    if (!pending) {
      return
    }
    restoreMutation.mutate(pending.id)
    clearPending()
  }, [clearPending, pending, restoreMutation])

  useEffect(() => clearPending, [clearPending])

  return {
    archive,
    clearPending,
    pending,
    undo,
  }
}
