import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

import { selectionDragThreshold } from "@/features/tasks/task-config";
import type {
  SelectionBounds,
  SelectionBox,
  SelectionSession,
} from "@/features/tasks/task-types";

export function getSelectionBounds(box: SelectionBox): SelectionBounds {
  const left = Math.min(box.startX, box.currentX);
  const right = Math.max(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const bottom = Math.max(box.startY, box.currentY);

  return { bottom, left, right, top };
}

export function getSelectionStyle(box: SelectionBox): CSSProperties {
  const bounds = getSelectionBounds(box);

  return {
    height: bounds.bottom - bounds.top,
    left: bounds.left,
    top: bounds.top,
    width: bounds.right - bounds.left,
  };
}

export function rectsIntersect(selection: SelectionBounds, rect: DOMRect) {
  return (
    selection.left <= rect.right &&
    selection.right >= rect.left &&
    selection.top <= rect.bottom &&
    selection.bottom >= rect.top
  );
}

export function getTaskIdsInsideSelection(
  surface: HTMLElement,
  selection: SelectionBounds,
) {
  return Array.from(surface.querySelectorAll<HTMLElement>("[data-task-id]"))
    .filter((element) =>
      rectsIntersect(selection, element.getBoundingClientRect()),
    )
    .map((element) => element.dataset.taskId)
    .filter((taskId): taskId is string => Boolean(taskId));
}

export function mergeTaskIds(baseIds: string[], selectedIds: string[]) {
  return Array.from(new Set([...baseIds, ...selectedIds]));
}

export function useTaskSelection() {
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const selectionSessionRef = useRef<SelectionSession | null>(null);
  const selectionSurfaceRef = useRef<HTMLDivElement | null>(null);
  const selectedTaskIdSet = useMemo(
    () => new Set(selectedTaskIds),
    [selectedTaskIds],
  );

  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      clearTaskSelection();
    }

    window.addEventListener("keydown", handleEscape);

    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  function clearTaskSelection() {
    selectionSessionRef.current = null;
    setSelectionBox(null);
    setSelectedTaskIds([]);
  }

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((currentIds) =>
      currentIds.includes(taskId)
        ? currentIds.filter((currentId) => currentId !== taskId)
        : [...currentIds, taskId],
    );
  }

  function handleSelectionPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.pointerType === "touch") {
      return;
    }

    const target = event.target as HTMLElement;
    const isInteractiveTarget = Boolean(
      target.closest(
        "[data-task-id],button,a,input,textarea,select,[role='button'],[role='menuitem'],[data-slot^='dropdown-menu']",
      ),
    );

    if (isInteractiveTarget) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
    selectionSessionRef.current = {
      additive,
      baseIds: additive ? selectedTaskIds : [],
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };

    if (!additive) {
      setSelectedTaskIds([]);
    }

    setSelectionBox({
      currentX: event.clientX,
      currentY: event.clientY,
      hasDragged: false,
      startX: event.clientX,
      startY: event.clientY,
    });
  }

  function handleSelectionPointerMove(event: PointerEvent<HTMLDivElement>) {
    const session = selectionSessionRef.current;
    const surface = selectionSurfaceRef.current;

    if (!session || !surface) {
      return;
    }

    event.preventDefault();

    const movement = Math.hypot(
      event.clientX - session.startX,
      event.clientY - session.startY,
    );
    const hasDragged = movement >= selectionDragThreshold;
    const nextBox: SelectionBox = {
      currentX: event.clientX,
      currentY: event.clientY,
      hasDragged,
      startX: session.startX,
      startY: session.startY,
    };

    setSelectionBox(nextBox);

    if (!hasDragged) {
      return;
    }

    const selectedIds = getTaskIdsInsideSelection(
      surface,
      getSelectionBounds(nextBox),
    );

    setSelectedTaskIds(
      session.additive
        ? mergeTaskIds(session.baseIds, selectedIds)
        : selectedIds,
    );
  }

  function handleSelectionPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const session = selectionSessionRef.current;

    if (!session) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(session.pointerId)) {
      event.currentTarget.releasePointerCapture(session.pointerId);
    }

    selectionSessionRef.current = null;
    setSelectionBox(null);
  }

  return {
    clearTaskSelection,
    handleSelectionPointerDown,
    handleSelectionPointerEnd,
    handleSelectionPointerMove,
    selectedTaskIds,
    selectedTaskIdSet,
    selectionBox,
    selectionSurfaceRef,
    toggleTaskSelection,
  };
}
