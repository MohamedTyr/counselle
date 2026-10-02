import { ArrowLeft, PanelLeft, PictureInPicture2, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { satIconItemClass } from "@/features/sat/sat-chrome-styles";
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

function moveOrResize(event: React.KeyboardEvent, toolWindow: UseToolWindowApi): void {
  const dx = event.key === "ArrowRight" ? ARROW_STEP : event.key === "ArrowLeft" ? -ARROW_STEP : 0;
  const dy = event.key === "ArrowDown" ? ARROW_STEP : event.key === "ArrowUp" ? -ARROW_STEP : 0;
  if (dx === 0 && dy === 0) return;
  if (event.shiftKey) toolWindow.resizeBy(dx, dy);
  else toolWindow.moveBy(dx, dy);
}

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
      headerRef.current?.focus({ preventScroll: true });
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
        "sat-window z-[var(--z-floating-panel)] flex flex-col overflow-hidden rounded-2xl border border-[var(--hairline)] bg-[var(--surface-raised)] shadow-[var(--elevation-2)]",
        docked && "shadow-[var(--elevation-1)]",
        fullscreen && "fixed inset-0 z-[var(--z-modal)] rounded-none border-0 shadow-none",
        className,
      )}
      data-hidden={hidden || undefined}
      role="dialog"
      style={style}
    >
      <div
        aria-label={`${title} window. Arrow keys move it; Shift and arrow keys resize it.`}
        className={cn(
          "flex h-11 shrink-0 select-none items-center gap-2 border-b border-[var(--hairline)] pr-1.5 pl-3.5 outline-none",
          "focus-visible:bg-[var(--canvas-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]",
          !fullscreen && !docked && "cursor-grab active:cursor-grabbing",
          fullscreen && "pl-1.5",
        )}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
            return;
          }
          if (!fullscreen && !docked) moveOrResize(event, toolWindow);
        }}
        ref={headerRef}
        role="group"
        tabIndex={0}
        {...(!fullscreen && !docked ? toolWindow.headerHandlers : {})}
      >
        {fullscreen ? (
          <Button
            className="active:scale-[0.97]"
            onClick={onClose}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" />
            Back to question
          </Button>
        ) : (
          <>
            <span className="text-[13px] font-semibold text-[var(--ink)]">{title}</span>
            {badge && (
              <span className="inline-flex h-5 items-center rounded-full bg-[var(--control-quiet-surface)] px-2 text-xs text-[var(--ink-faint)]">
                {badge}
              </span>
            )}
            <div className="ml-auto flex items-center gap-0.5">
              {docked && onFloat && (
                <Button
                  aria-label={`Float ${title.toLowerCase()}`}
                  className={satIconItemClass}
                  onClick={onFloat}
                  size="icon-sm"
                  title={`Float ${title.toLowerCase()}`}
                  variant="ghost"
                >
                  <PictureInPicture2 aria-hidden="true" className="size-4" />
                </Button>
              )}
              {!docked && onDock && (
                <Button
                  aria-label={`Dock ${title.toLowerCase()} beside the question`}
                  className={satIconItemClass}
                  onClick={onDock}
                  size="icon-sm"
                  title={`Dock ${title.toLowerCase()} beside the question`}
                  variant="ghost"
                >
                  <PanelLeft aria-hidden="true" className="size-4" />
                </Button>
              )}
              <Button
                aria-label={`Close ${title.toLowerCase()}`}
                className={satIconItemClass}
                onClick={onClose}
                size="icon-sm"
                title={`Close ${title.toLowerCase()}`}
                variant="ghost"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {!fullscreen && !docked && (
        <div
          aria-hidden="true"
          className="absolute right-0 bottom-0 size-5 cursor-nwse-resize"
          {...toolWindow.resizeHandleHandlers}
        >
          <span className="absolute right-1.5 bottom-1.5 size-2 rounded-br-[3px] border-r-2 border-b-2 border-[var(--edge-strong)]" />
        </div>
      )}
    </div>
  );
}
