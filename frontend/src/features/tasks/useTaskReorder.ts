// Today's manual reorder drag mechanics (plans/tasks-redesign-plan.md P9,
// spec §6.1/§9, design doc §3.10.2). Native HTML5 DnD only — DESIGN.md
// §17.5 forbids dnd-kit/react-beautiful-dnd by name. Single axis: this only
// ever reorders one flat list, never moves an item between lists.
//
// A drag is armed by pointerdown on the grip handle only (TaskRow.tsx owns
// that gate via its own `armed` state and the row's `draggable` attribute);
// this hook only knows about the three DnD events a row forwards to it.
// Escape needs no explicit handling: cancelling a native drag fires
// `dragend` without a preceding `drop`, so `endDrag` already discards the
// uncommitted local order exactly as a cancel should.
import { useRef, useState } from "react";

export function useTaskReorder(ids: string[], onCommit: (ids: string[]) => void) {
  const [liveOrder, setLiveOrder] = useState<string[] | null>(null);
  const draggedIdRef = useRef<string | null>(null);

  function reset() {
    setLiveOrder(null);
    draggedIdRef.current = null;
  }

  function startDrag(taskId: string) {
    draggedIdRef.current = taskId;
    setLiveOrder(ids);
  }

  /** DESIGN.md §17.5 — "drag-over live-reorders in real time." */
  function dragOverTask(overTaskId: string) {
    const draggedId = draggedIdRef.current;
    if (!draggedId || draggedId === overTaskId) {
      return;
    }
    setLiveOrder((current) => {
      const base = current ?? ids;
      const from = base.indexOf(draggedId);
      const to = base.indexOf(overTaskId);
      if (from === -1 || to === -1 || from === to) {
        return current;
      }
      const next = [...base];
      next.splice(from, 1);
      next.splice(to, 0, draggedId);
      return next;
    });
  }

  function drop() {
    if (liveOrder && liveOrder.join(",") !== ids.join(",")) {
      onCommit(liveOrder);
    }
    reset();
  }

  function endDrag() {
    reset();
  }

  return {
    order: liveOrder ?? ids,
    isDragging: liveOrder !== null,
    startDrag,
    dragOverTask,
    drop,
    endDrag,
  };
}
