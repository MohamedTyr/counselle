import { useCallback, useRef, useState, type DragEvent } from "react"

// Shared drag-to-reorder wiring for the activity and honor lists. Drags are
// only armed from the grip handle (onArmDrag) so a plain row click still opens
// the drawer instead of starting a drag.
export function useReorderDrag(
  onReorder: (draggingId: string, targetId: string) => void
) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragArmedRef = useRef(false)

  const armDrag = useCallback(() => {
    dragArmedRef.current = true
  }, [])

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLElement>, id: string) => {
      if (!dragArmedRef.current) {
        event.preventDefault()
        return
      }

      setDraggingId(id)
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", id)
    },
    []
  )

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLElement>, targetId: string) => {
      if (!draggingId) {
        return
      }

      event.preventDefault()
      event.dataTransfer.dropEffect = "move"

      if (draggingId !== targetId) {
        onReorder(draggingId, targetId)
      }
    },
    [draggingId, onReorder]
  )

  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    dragArmedRef.current = false
  }, [])

  return {
    armDrag,
    draggingId,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
  }
}
