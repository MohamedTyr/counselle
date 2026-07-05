import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react"

import {
  defaultColumnWidths,
  tableColumns,
} from "@/features/schools/schools-config"
import type {
  ColumnId,
  ColumnWidths,
  TableColumn,
} from "@/features/schools/schools-types"

type ActiveResize = {
  onPointerMove: (event: PointerEvent) => void
  onPointerEnd: () => void
  previousCursor: string
  previousUserSelect: string
}

function clampColumnWidth(column: TableColumn, width: number) {
  return Math.min(column.maxWidth, Math.max(column.minWidth, Math.round(width)))
}

export function useColumnLayout() {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => ({
    ...defaultColumnWidths,
  }))
  const activeResizeRef = useRef<ActiveResize | null>(null)

  const updateColumnWidth = useCallback((columnId: ColumnId, width: number) => {
    setColumnWidths((currentWidths) => ({
      ...currentWidths,
      [columnId]: width,
    }))
  }, [])

  const cleanupActiveResize = useCallback(() => {
    const activeResize = activeResizeRef.current

    if (!activeResize) {
      return
    }

    window.removeEventListener("pointermove", activeResize.onPointerMove)
    window.removeEventListener("pointerup", activeResize.onPointerEnd)
    window.removeEventListener("pointercancel", activeResize.onPointerEnd)
    document.body.style.cursor = activeResize.previousCursor
    document.body.style.userSelect = activeResize.previousUserSelect
    activeResizeRef.current = null
  }, [])

  const tableWidth = useMemo(
    () =>
      tableColumns.reduce(
        (total, column) => total + columnWidths[column.id],
        0
      ),
    [columnWidths]
  )

  function handleColumnResizeStart(
    event: ReactPointerEvent<HTMLButtonElement>,
    column: TableColumn
  ) {
    event.preventDefault()
    event.stopPropagation()
    cleanupActiveResize()

    const startX = event.clientX
    const startWidth = columnWidths[column.id]
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    function handlePointerMove(pointerEvent: PointerEvent) {
      const width = startWidth + pointerEvent.clientX - startX
      updateColumnWidth(column.id, clampColumnWidth(column, width))
    }

    function handlePointerEnd() {
      cleanupActiveResize()
    }

    activeResizeRef.current = {
      onPointerEnd: handlePointerEnd,
      onPointerMove: handlePointerMove,
      previousCursor,
      previousUserSelect,
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerEnd, { once: true })
    window.addEventListener("pointercancel", handlePointerEnd, { once: true })
  }

  function handleColumnResizeKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    column: TableColumn
  ) {
    const currentWidth = columnWidths[column.id]
    const resizeStep = event.shiftKey ? 32 : 16
    const keyWidths: Partial<Record<string, number>> = {
      ArrowLeft: currentWidth - resizeStep,
      ArrowRight: currentWidth + resizeStep,
      End: column.maxWidth,
      Home: column.minWidth,
    }
    const nextWidth = keyWidths[event.key]

    if (nextWidth === undefined) {
      return
    }

    event.preventDefault()
    updateColumnWidth(column.id, clampColumnWidth(column, nextWidth))
  }

  useEffect(() => cleanupActiveResize, [cleanupActiveResize])

  return {
    columnWidths,
    handleColumnResizeKeyDown,
    handleColumnResizeStart,
    tableWidth,
  }
}
