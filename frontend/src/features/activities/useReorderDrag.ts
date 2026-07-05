import { useCallback, useRef, useState, type DragEvent } from "react";

type ReorderDragOptions = {
  onCancel?: () => void;
  onCommit?: () => void;
  onStart?: () => void;
};

// Shared drag-to-reorder wiring for the activity and honor lists. Drags are
// only armed from the grip handle (onArmDrag) so a plain row click still opens
// the drawer instead of starting a drag.
export function useReorderDrag(
  onReorder: (draggingId: string, targetId: string) => void,
  { onCancel, onCommit, onStart }: ReorderDragOptions = {},
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragArmedRef = useRef(false);
  const droppedRef = useRef(false);

  const armDrag = useCallback(() => {
    dragArmedRef.current = true;
    window.addEventListener(
      "pointerup",
      () => {
        dragArmedRef.current = false;
      },
      { once: true },
    );
    window.addEventListener(
      "pointercancel",
      () => {
        dragArmedRef.current = false;
      },
      { once: true },
    );
  }, []);

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLElement>, id: string) => {
      if (!dragArmedRef.current) {
        event.preventDefault();
        return;
      }

      dragArmedRef.current = false;
      droppedRef.current = false;
      setDraggingId(id);
      onStart?.();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    },
    [onStart],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLElement>, targetId: string) => {
      if (!draggingId) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      if (draggingId !== targetId) {
        onReorder(draggingId, targetId);
      }
    },
    [draggingId, onReorder],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!draggingId) {
        return;
      }

      event.preventDefault();
      droppedRef.current = true;
      setDraggingId(null);
      dragArmedRef.current = false;
      onCommit?.();
    },
    [draggingId, onCommit],
  );

  const handleDragEnd = useCallback(() => {
    if (draggingId && !droppedRef.current) {
      onCancel?.();
    }

    setDraggingId(null);
    dragArmedRef.current = false;
    droppedRef.current = false;
  }, [draggingId, onCancel]);

  return {
    armDrag,
    draggingId,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    handleDrop,
  };
}
