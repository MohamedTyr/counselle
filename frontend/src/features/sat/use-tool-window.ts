import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

/** The viewport width at which a tool window becomes fullscreen instead of
 * floating (plan §6.4, ui-spec §4.1) — an upstream constant, kept as the
 * one named export other SAT files (the top bar, the practice screen's
 * Enter handler) key their own ≤860px behaviour off. */
export const TOOL_WINDOW_FULLSCREEN_BREAKPOINT = 860;

const MIN_X = 10;
const ARROW_MOVE_STEP = 16;
const ARROW_RESIZE_STEP = 16;

export interface ToolWindowSize {
  width: number;
  height: number;
}

export interface ToolWindowPosition {
  x: number;
  y: number;
}

export interface ToolWindowSizeBounds {
  min: ToolWindowSize;
  /** Fraction of the viewport, e.g. `{ width: 0.9, height: 0.85 }` for
   * "90vw × 85vh" (Q35a). */
  maxViewportFraction: ToolWindowSize;
}

export interface UseToolWindowOptions {
  defaultPosition: ToolWindowPosition;
  defaultSize: ToolWindowSize;
  sizeBounds: ToolWindowSizeBounds;
  /** The window's top edge never clears above this (Q35/Q37's 60 / 50) —
   * keeps the header under the app's top bar. */
  minY: number;
}

export interface ToolWindowPointerHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface UseToolWindowApi {
  position: ToolWindowPosition;
  size: ToolWindowSize;
  isDragging: boolean;
  isResizing: boolean;
  /** ≤860px (`TOOL_WINDOW_FULLSCREEN_BREAKPOINT`) — the caller renders
   * fullscreen chrome instead of the floating frame. */
  isFullscreenBreakpoint: boolean;
  /** Header drag: `setPointerCapture` on `pointerdown`, released on
   * `pointerup` / `pointercancel` (plan §6.4) — capture retargets move
   * events to the header, so the drag survives crossing a cross-origin
   * iframe. */
  headerHandlers: ToolWindowPointerHandlers;
  /** The 16px corner resize handle, outside the iframe (plan §6.4). */
  resizeHandleHandlers: ToolWindowPointerHandlers;
  /** Jumps to `position` (clamped to the viewport) — used to spawn the
   * window once the layout it must avoid has been measured. */
  placeAt: (position: ToolWindowPosition) => void;
  /** Keyboard: arrows move ±16px (ui-spec §4.1). */
  moveBy: (dx: number, dy: number) => void;
  /** Keyboard: Shift+arrows resize ±16px (ui-spec §4.1). */
  resizeBy: (dw: number, dh: number) => void;
  reset: () => void;
}

/** The practice top bar's side gutter. */
const SPAWN_EDGE = 24;
/** Clears the practice screen's bottom bar (64px) with a gap. */
const SPAWN_BOTTOM = 84;
/** Offset between stacked windows. */
const SPAWN_CASCADE = 24;

interface SpawnRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function overlaps(a: SpawnRect, b: SpawnRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Where a tool window first opens, so it covers as little as it can and
 * never lands on another open window: over the docked side when the
 * calculator is docked, otherwise in the empty margin right of the question
 * sheet when the window fits there, otherwise bottom-right. A floating
 * window already in that spot is stepped around (left of it, else cascaded). */
export function computeSpawnPosition(size: ToolWindowSize, minY: number): ToolWindowPosition {
  const windows = Array.from(document.querySelectorAll<HTMLElement>(".sat-window"))
    .filter((el) => el.dataset.hidden === undefined)
    .map((el) => ({ docked: el.dataset.docked !== undefined, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.width < window.innerWidth);
  const dockedRect = windows.find((w) => w.docked)?.rect;
  const floating = windows.filter((w) => !w.docked).map((w) => w.rect);

  const sheet = document.querySelector("[data-sat-question-sheet]");
  const sheetRight = sheet?.getBoundingClientRect().right ?? window.innerWidth;
  const fitsInMargin = window.innerWidth - sheetRight - 2 * SPAWN_EDGE >= size.width;
  const rightX = Math.max(SPAWN_EDGE, window.innerWidth - size.width - SPAWN_EDGE);

  let pos: ToolWindowPosition;
  if (dockedRect) {
    pos = { x: dockedRect.left + SPAWN_EDGE, y: Math.max(minY, dockedRect.top + SPAWN_EDGE) };
  } else if (fitsInMargin) {
    pos = { x: rightX, y: minY };
  } else {
    pos = { x: rightX, y: Math.max(minY, window.innerHeight - size.height - SPAWN_BOTTOM) };
  }

  const at = (p: ToolWindowPosition): SpawnRect => ({
    left: p.x,
    top: p.y,
    right: p.x + size.width,
    bottom: p.y + size.height,
  });
  const hit = floating.find((r) => overlaps(at(pos), r));
  if (!hit) return pos;
  const leftOf = hit.left - size.width - SPAWN_EDGE;
  if (leftOf >= SPAWN_EDGE && !floating.some((r) => overlaps(at({ x: leftOf, y: pos.y }), r))) {
    return { x: leftOf, y: pos.y };
  }
  return {
    x: clampNum(hit.left + SPAWN_CASCADE, SPAWN_EDGE, window.innerWidth - size.width - SPAWN_EDGE),
    y: clampNum(hit.top + SPAWN_CASCADE, minY, window.innerHeight - size.height - SPAWN_EDGE),
  };
}

function clampNum(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Floating geometry for a `SatToolWindow` — drag, resize, and the clamp
 * that keeps the header on screen at the window's *real* size, re-applied
 * on viewport resize (plan §6.4; Q35's FIX over upstream's fixed-constant
 * clamp). Docking, hiding and fullscreen chrome are the caller's concern
 * (`SatCalculator`, `SatReferenceSheet`) — this hook only ever describes
 * the floating frame.
 */
export function useToolWindow({
  defaultPosition,
  defaultSize,
  sizeBounds,
  minY,
}: UseToolWindowOptions): UseToolWindowApi {
  const [position, setPosition] = useState<ToolWindowPosition>(defaultPosition);
  const [size, setSize] = useState<ToolWindowSize>(defaultSize);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isFullscreenBreakpoint, setIsFullscreenBreakpoint] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= TOOL_WINDOW_FULLSCREEN_BREAKPOINT,
  );

  const positionRef = useRef(position);
  const sizeRef = useRef(size);
  positionRef.current = position;
  sizeRef.current = size;

  const dragStartRef = useRef<{ pointerX: number; pointerY: number; origin: ToolWindowPosition } | null>(null);
  const resizeStartRef = useRef<{ pointerX: number; pointerY: number; origin: ToolWindowSize } | null>(null);

  const clampSize = useCallback(
    (next: ToolWindowSize): ToolWindowSize => {
      const maxWidth = window.innerWidth * sizeBounds.maxViewportFraction.width;
      const maxHeight = window.innerHeight * sizeBounds.maxViewportFraction.height;
      return {
        width: clampNum(next.width, sizeBounds.min.width, maxWidth),
        height: clampNum(next.height, sizeBounds.min.height, maxHeight),
      };
    },
    [sizeBounds],
  );

  const clampPosition = useCallback(
    (next: ToolWindowPosition, forSize: ToolWindowSize): ToolWindowPosition => {
      const maxX = Math.max(MIN_X, window.innerWidth - forSize.width);
      const maxY = Math.max(minY, window.innerHeight - forSize.height);
      return {
        x: clampNum(next.x, MIN_X, maxX),
        y: clampNum(next.y, minY, maxY),
      };
    },
    [minY],
  );

  useEffect(() => {
    function handleViewportResize() {
      setIsFullscreenBreakpoint(window.innerWidth <= TOOL_WINDOW_FULLSCREEN_BREAKPOINT);

      const nextSize = clampSize(sizeRef.current);
      sizeRef.current = nextSize;
      setSize(nextSize);

      const nextPosition = clampPosition(positionRef.current, nextSize);
      positionRef.current = nextPosition;
      setPosition(nextPosition);
    }
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, [clampSize, clampPosition]);

  const handleHeaderPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Let clicks on header controls (dock/float/close) through undragged:
    // setPointerCapture on the header would otherwise retarget the button's
    // own pointerup/click to the header div, silently swallowing the click.
    if ((event.target as HTMLElement).closest("button")) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      origin: positionRef.current,
    };
    setIsDragging(true);
  }, []);

  const handleHeaderPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = dragStartRef.current;
      if (!start) {
        return;
      }
      const next = clampPosition(
        {
          x: start.origin.x + (event.clientX - start.pointerX),
          y: start.origin.y + (event.clientY - start.pointerY),
        },
        sizeRef.current,
      );
      positionRef.current = next;
      setPosition(next);
    },
    [clampPosition],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (dragStartRef.current === null) {
      return;
    }
    dragStartRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleResizeHandlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      origin: sizeRef.current,
    };
    setIsResizing(true);
  }, []);

  const handleResizeHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = resizeStartRef.current;
      if (!start) {
        return;
      }
      const nextSize = clampSize({
        width: start.origin.width + (event.clientX - start.pointerX),
        height: start.origin.height + (event.clientY - start.pointerY),
      });
      sizeRef.current = nextSize;
      setSize(nextSize);

      const nextPosition = clampPosition(positionRef.current, nextSize);
      positionRef.current = nextPosition;
      setPosition(nextPosition);
    },
    [clampSize, clampPosition],
  );

  const endResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (resizeStartRef.current === null) {
      return;
    }
    resizeStartRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const moveBy = useCallback(
    (dx: number, dy: number) => {
      const next = clampPosition(
        { x: positionRef.current.x + dx, y: positionRef.current.y + dy },
        sizeRef.current,
      );
      positionRef.current = next;
      setPosition(next);
    },
    [clampPosition],
  );

  const placeAt = useCallback(
    (target: ToolWindowPosition) => {
      const next = clampPosition(target, sizeRef.current);
      positionRef.current = next;
      setPosition(next);
    },
    [clampPosition],
  );

  const resizeBy = useCallback(
    (dw: number, dh: number) => {
      const nextSize = clampSize({
        width: sizeRef.current.width + dw,
        height: sizeRef.current.height + dh,
      });
      sizeRef.current = nextSize;
      setSize(nextSize);

      const nextPosition = clampPosition(positionRef.current, nextSize);
      positionRef.current = nextPosition;
      setPosition(nextPosition);
    },
    [clampSize, clampPosition],
  );

  const reset = useCallback(() => {
    positionRef.current = defaultPosition;
    sizeRef.current = defaultSize;
    setPosition(defaultPosition);
    setSize(defaultSize);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- not an effect: a direct reset called on close (Q37).
  }, [defaultPosition, defaultSize]);

  return {
    position,
    size,
    isDragging,
    isResizing,
    isFullscreenBreakpoint,
    headerHandlers: {
      onPointerDown: handleHeaderPointerDown,
      onPointerMove: handleHeaderPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    resizeHandleHandlers: {
      onPointerDown: handleResizeHandlePointerDown,
      onPointerMove: handleResizeHandlePointerMove,
      onPointerUp: endResize,
      onPointerCancel: endResize,
    },
    placeAt,
    moveBy,
    resizeBy,
    reset,
  };
}

/** Exported for `use-tool-window.test.ts` (clamp maths, plan §6.4/Q35a). */
export const __internal = { clampNum, ARROW_MOVE_STEP, ARROW_RESIZE_STEP };
