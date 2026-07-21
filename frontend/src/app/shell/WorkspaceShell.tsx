import type { CSSProperties } from "react";
import { useLocation } from "react-router";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { WorkspaceOutlet } from "@/app/shell/WorkspaceOutlet";
import { WorkspaceEventsMount } from "@/api/workspace/events";
import { AppSidebar } from "@/features/shell/AppSidebar";
import { SidebarResizer } from "@/features/shell/SidebarResizer";
import { useResizableSidebar } from "@/features/shell/useResizableSidebar";
import { cn } from "@/lib/utils";

/** The AI chat route renders its own right-edge sources rail (see
 * `SourcesRail`), styled to match this same sidebar-emerge look. So the
 * shell's floating card only owns the left/top/bottom edges there — the
 * right edge stays flush for the rail to own, mirroring the sidebar. */
function hasOwnRightRail(pathname: string): boolean {
  return pathname.startsWith("/app/ai");
}

export function WorkspaceShell() {
  const { width, isResizing, onResizeStart, resetWidth } =
    useResizableSidebar();
  const { pathname } = useLocation();
  const splitRail = hasOwnRightRail(pathname);

  return (
    <SidebarProvider
      className={cn("bg-sidebar", isResizing && "sidebar-provider--resizing")}
      style={{ "--sidebar-width": `${width}px` } as CSSProperties}
    >
      <WorkspaceEventsMount />
      <div className="relative flex h-dvh w-full">
        <AppSidebar />
        <SidebarResizer
          isResizing={isResizing}
          onReset={resetWidth}
          onResizeStart={onResizeStart}
        />
        <SidebarInset
          className={cn(
            "flex min-w-0 flex-col overflow-hidden",
            "md:mt-4 md:mb-4 md:ml-0 md:rounded-l-xl md:shadow-sm",
            splitRail
              ? "md:mr-0 md:rounded-r-none"
              : "md:mr-2 md:rounded-r-xl",
          )}
        >
          <header className="flex h-14 shrink-0 items-center gap-3 px-4 md:hidden">
            <SidebarTrigger />
            <span className="font-semibold">Counselle</span>
          </header>
          <WorkspaceOutlet />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
