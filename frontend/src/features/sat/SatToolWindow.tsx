import { Minimize2, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { UseToolWindowApi } from "@/features/sat/use-tool-window";

export interface SatToolWindowProps {
  title: string;
  badge?: string;
  window: UseToolWindowApi;
  /** `visibility: hidden` while mounted (plan §6.4) — the calculator on a
   * non-Math question, or a tool window not currently open. */
  hidden?: boolean;
  /** Docked geometry, read from CSS custom properties written by the
   * caller's `ResizeObserver` (plan §6.4) — `undefined` when floating. */
  dockedRect?: { top: string; left: string; width: string; height: string };
  onDock?: () => void;
  onFloat?: () => void;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

const ARROW_STEP = 16;

/**
 * The window shell for the calculator and reference sheet (ui-spec §4.1,
 * plan §6.4). **Never unmounts its children and never reparents them** — a
 * single `position: fixed` element for the whole component lifetime;
 * docked vs. floating is a CSS-geometry difference (`dockedRect` vs. the
 * `useToolWindow` transform), never a different subtree, because moving an
 * iframe in the DOM reloads it.
 */
export function SatToolWindow({
  title,
  badge,
  window: toolWindow,
  hidden = false,
  dockedRect,
  onDock,
  onFloat,
  onClose,
  children,
  className,
}: SatToolWindowProps): React.ReactElement {
  const headerRef = useRef<HTMLDivElement>(null);
  const docked = dockedRect !== undefined;
  const fullscreen = !docked && toolWindow.isFullscreenBreakpoint;

  useEffect(() => {
    if (!hidden && !docked) {
      headerRef.current?.focus();
    }
  }, [hidden, docked]);

  const style: React.CSSProperties = fullscreen
    ? {}
    : docked
      ? {
          position: "fixed",
          top: dockedRect.top,
          left: dockedRect.left,
          width: dockedRect.width,
          height: dockedRect.height,
        }
      : {
          position: "fixed",
          top: 0,
          left: 0,
          transform: `translate3d(${toolWindow.position.x}px, ${toolWindow.position.y}px, 0)`,
          width: toolWindow.size.width,
          height: toolWindow.size.height,
          willChange: toolWindow.isDragging || toolWindow.isResizing ? "transform" : undefined,
        };

  return (
    <div
      aria-label={title}
      className={cn(
        "z-[var(--z-floating-panel)] flex flex-col overflow-hidden rounded-xl bg-[var(--surface-raised)] shadow-[var(--elevation-3)]",
        fullscreen && "fixed inset-0 z-[var(--z-modal)] rounded-none",
        docked && "rounded-none border-l border-[var(--hairline)] shadow-none",
        hidden && "invisible",
        className,
      )}
      role="dialog"
      style={style}
    >
      <div
        className="flex h-10 shrink-0 cursor-grab select-none items-center gap-2 border-b border-[var(--hairline)] px-2 active:cursor-grabbing"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
            return;
          }
          const step = ARROW_STEP;
          if (event.shiftKey) {
            if (event.key === "ArrowRight") toolWindow.resizeBy(step, 0);
            if (event.key === "ArrowLeft") toolWindow.resizeBy(-step, 0);
            if (event.key === "ArrowDown") toolWindow.resizeBy(0, step);
            if (event.key === "ArrowUp") toolWindow.resizeBy(0, -step);
            return;
          }
          if (event.key === "ArrowRight") toolWindow.moveBy(step, 0);
          if (event.key === "ArrowLeft") toolWindow.moveBy(-step, 0);
          if (event.key === "ArrowDown") toolWindow.moveBy(0, step);
          if (event.key === "ArrowUp") toolWindow.moveBy(0, -step);
        }}
        ref={headerRef}
        tabIndex={0}
        {...(!fullscreen && !docked ? toolWindow.headerHandlers : {})}
      >
        {fullscreen ? (
          <Button onClick={onClose} size="sm" variant="ghost">
            Back to question
          </Button>
        ) : (
          <>
            <span className="text-sm font-medium">{title}</span>
            {badge && <Badge variant="secondary">{badge}</Badge>}
            {docked && onFloat && (
              <Button className="ml-auto" onClick={onFloat} size="icon-sm" variant="ghost">
                <Minimize2 aria-hidden="true" className="size-4" />
              </Button>
            )}
            {!docked && onDock && (
              <Button className="ml-auto" onClick={onDock} size="icon-sm" variant="ghost">
                <Minimize2 aria-hidden="true" className="size-4" />
              </Button>
            )}
            <Button onClick={onClose} size="icon-sm" variant="ghost">
              <X aria-hidden="true" className="size-4" />
            </Button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 rounded-lg">{children}</div>
      {!fullscreen && !docked && (
        <div
          aria-hidden="true"
          className="absolute right-0 bottom-0 size-4 cursor-nwse-resize"
          {...toolWindow.resizeHandleHandlers}
        />
      )}
    </div>
  );
}
