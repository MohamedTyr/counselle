import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from "react";

import type { Task, TaskStatus } from "@/domain/task";

type TaskDragPayload = {
  sourceColumnId: TaskStatus;
  taskId: string;
  taskIds?: string[];
};

const taskStatusSet: ReadonlySet<TaskStatus> = new Set([
  "todo",
  "doing",
  "waiting",
  "done",
]);

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && taskStatusSet.has(value as TaskStatus);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isTaskIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

export function parseTaskDragPayload(rawData: string): TaskDragPayload | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawData);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const data = parsed as Record<string, unknown>;

  if (!isTaskStatus(data.sourceColumnId) || !isNonEmptyString(data.taskId)) {
    return null;
  }

  if (data.taskIds !== undefined && !isTaskIdList(data.taskIds)) {
    return null;
  }

  return {
    sourceColumnId: data.sourceColumnId,
    taskId: data.taskId,
    taskIds: data.taskIds,
  };
}

function getTaskElementsForIds(surface: HTMLElement | null, taskIds: string[]) {
  if (!surface) {
    return [];
  }

  const elementsById = new Map(
    Array.from(surface.querySelectorAll<HTMLElement>("[data-task-id]")).map(
      (element) => [element.dataset.taskId, element],
    ),
  );

  return taskIds
    .map((taskId) => elementsById.get(taskId))
    .filter((element): element is HTMLElement => Boolean(element));
}

function createTaskDragImage({
  sourceElement,
  surface,
  taskIds,
}: {
  sourceElement: HTMLElement;
  surface: HTMLElement | null;
  taskIds: string[];
}) {
  const sourceRect = sourceElement.getBoundingClientRect();
  const previewElements =
    taskIds.length > 1
      ? getTaskElementsForIds(surface, taskIds).slice(0, 3)
      : [sourceElement];

  if (previewElements.length === 0) {
    return null;
  }

  const layerOffset = 7;
  const preview = document.createElement("div");
  Object.assign(preview.style, {
    height: `${sourceRect.height + (previewElements.length - 1) * layerOffset}px`,
    left: `${sourceRect.left}px`,
    pointerEvents: "none",
    position: "fixed",
    top: `${sourceRect.top}px`,
    width: `${sourceRect.width + (previewElements.length - 1) * layerOffset}px`,
    zIndex: "2147483647",
  });

  previewElements.forEach((element, index) => {
    const clone = element.cloneNode(true) as HTMLElement;
    const scale = 1 - index * 0.025;

    clone.setAttribute("aria-hidden", "true");
    clone.removeAttribute("data-task-id");
    clone.removeAttribute("draggable");
    Object.assign(clone.style, {
      background: "var(--task-drag-preview-background)",
      borderColor: "var(--task-drag-preview-border)",
      boxShadow: "var(--task-drag-preview-shadow)",
      boxSizing: "border-box",
      left: "0",
      opacity: `${0.96 - index * 0.12}`,
      position: "absolute",
      top: "0",
      transform: `translate(${index * layerOffset}px, ${
        index * layerOffset
      }px) scale(${scale})`,
      transformOrigin: "top left",
      width: `${sourceRect.width}px`,
      zIndex: `${previewElements.length - index}`,
    });

    preview.appendChild(clone);
  });

  document.body.appendChild(preview);

  return preview;
}

export function useTaskDrag({
  onMoveTasks,
  selectedTaskIds,
  selectionSurfaceRef,
}: {
  onMoveTasks: (taskIds: string[], targetStatus: TaskStatus) => void;
  selectedTaskIds: string[];
  selectionSurfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [draggingTaskIds, setDraggingTaskIds] = useState<string[]>([]);
  const dragImageRef = useRef<HTMLElement | null>(null);
  const draggingTaskIdSet = useMemo(
    () => new Set(draggingTaskIds),
    [draggingTaskIds],
  );

  function clearTaskDrag() {
    dragImageRef.current?.remove();
    dragImageRef.current = null;
    setDraggingTaskIds([]);
    setDragOverColumn(null);
  }

  function handleDragStart(
    event: DragEvent<HTMLElement>,
    task: Task,
    columnId: TaskStatus,
  ) {
    const taskIds = selectedTaskIds.includes(task.id)
      ? [task.id, ...selectedTaskIds.filter((taskId) => taskId !== task.id)]
      : [task.id];
    const dragImage = createTaskDragImage({
      sourceElement: event.currentTarget,
      surface: selectionSurfaceRef.current,
      taskIds,
    });

    setDraggingTaskIds(taskIds);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ sourceColumnId: columnId, taskId: task.id, taskIds }),
    );

    if (dragImage) {
      const sourceRect = event.currentTarget.getBoundingClientRect();
      const offsetX = event.clientX - sourceRect.left;
      const offsetY = event.clientY - sourceRect.top;

      dragImageRef.current?.remove();
      dragImageRef.current = dragImage;
      event.dataTransfer.setDragImage(dragImage, offsetX, offsetY);
    }
  }

  function handleDragOver(event: DragEvent<HTMLElement>, columnId: TaskStatus) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnId);
  }

  function handleDrop(
    event: DragEvent<HTMLElement>,
    targetColumnId: TaskStatus,
  ) {
    event.preventDefault();
    const rawData = event.dataTransfer.getData("text/plain");

    if (!rawData) {
      setDragOverColumn(null);
      return;
    }

    const data = parseTaskDragPayload(rawData);

    if (!data) {
      clearTaskDrag();
      return;
    }

    const taskIds = data.taskIds ?? [data.taskId];

    if (taskIds.length > 0) {
      onMoveTasks(taskIds, targetColumnId);
    }

    clearTaskDrag();
  }

  return {
    clearTaskDrag,
    dragOverColumn,
    draggingTaskIdSet,
    handleDragEnd: clearTaskDrag,
    handleDragOver,
    handleDragStart,
    handleDrop,
    setDragOverColumn,
  };
}
