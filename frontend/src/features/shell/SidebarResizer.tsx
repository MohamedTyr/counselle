import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type SidebarResizerProps = {
  isResizing: boolean;
  onResizeStart: (event: React.PointerEvent) => void;
  onReset: () => void;
};

/**
 * Draggable divider pinned to the sidebar's right edge. Hidden on mobile and
 * while the sidebar is collapsed to its icon rail. Double-click resets width.
 */
export function SidebarResizer({
  isResizing,
  onResizeStart,
  onReset,
}: SidebarResizerProps) {
  const { isMobile, state } = useSidebar();

  if (isMobile || state === "collapsed") {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "sidebar-resizer group/resizer absolute inset-y-0 z-30 hidden -translate-x-1/2 cursor-col-resize touch-none md:block",
        isResizing && "sidebar-resizer--active",
      )}
      onDoubleClick={onReset}
      onPointerDown={onResizeStart}
      style={{ left: "var(--sidebar-width)" }}
    >
      <span className="sidebar-resizer__line" />
    </div>
  );
}
