import type { CSSProperties } from "react";

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

export function WorkspaceShell() {
  const { width, isResizing, onResizeStart, resetWidth } =
    useResizableSidebar();

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
          className={cn("flex min-w-0 flex-col overflow-hidden")}
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
