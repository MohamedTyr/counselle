import { useCallback, useRef, useState } from "react";

const STORAGE_KEY = "counselle:sidebar-width";
const MIN_WIDTH = 232;
const MAX_WIDTH = 408;
const DEFAULT_WIDTH = 256;

function clampWidth(width: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

function readStoredWidth() {
  if (typeof window === "undefined") {
    return DEFAULT_WIDTH;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_WIDTH;
}

type ResizableSidebar = {
  width: number;
  isResizing: boolean;
  onResizeStart: (event: React.PointerEvent) => void;
  resetWidth: () => void;
};

/**
 * Drag-to-resize width state for the desktop sidebar, persisted across visits.
 * Width is exposed as a px number so callers can feed it to `--sidebar-width`.
 */
export function useResizableSidebar(): ResizableSidebar {
  const [width, setWidth] = useState<number>(readStoredWidth);
  const [isResizing, setIsResizing] = useState(false);
  const frame = useRef<number | null>(null);

  const persist = useCallback((next: number) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    }
  }, []);

  const onResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      setIsResizing(true);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (frame.current !== null) {
          cancelAnimationFrame(frame.current);
        }
        frame.current = requestAnimationFrame(() => {
          setWidth(clampWidth(moveEvent.clientX));
        });
      };

      const handlePointerUp = () => {
        setIsResizing(false);
        if (frame.current !== null) {
          cancelAnimationFrame(frame.current);
          frame.current = null;
        }
        setWidth((current) => {
          persist(current);
          return current;
        });
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [persist],
  );

  const resetWidth = useCallback(() => {
    setWidth(DEFAULT_WIDTH);
    persist(DEFAULT_WIDTH);
  }, [persist]);

  return { width, isResizing, onResizeStart, resetWidth };
}
