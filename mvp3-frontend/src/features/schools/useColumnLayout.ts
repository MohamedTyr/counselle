import { useMemo, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"

import {
  defaultColumnWidths,
  tableColumns,
} from "@/features/schools/schools-config"
import type {
  ColumnWidths,
  TableColumn,
} from "@/features/schools/schools-types"

export function useColumnLayout() {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => ({
    ...defaultColumnWidths,
  }))

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

    const startX = event.clientX
    const startWidth = columnWidths[column.id]
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    function handlePointerMove(pointerEvent: PointerEvent) {
      const width = startWidth + pointerEvent.clientX - startX
      const nextWidth = Math.min(
        column.maxWidth,
        Math.max(column.minWidth, Math.round(width))
      )

      setColumnWidths((currentWidths) => ({
        ...currentWidths,
        [column.id]: nextWidth,
      }))
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
  }

  return { columnWidths, tableWidth, handleColumnResizeStart }
}
