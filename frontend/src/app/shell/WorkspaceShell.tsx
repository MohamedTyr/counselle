import type { CSSProperties } from "react";
import { useLocation } from "react-router";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { WorkspaceOutlet } from "@/app/shell/WorkspaceOutlet";
import { WorkspaceEventsMount } from "@/api/workspace/events";
import wordmark from "@/assets/app-shell/wordmark.svg";
import { AppSidebar } from "@/features/shell/AppSidebar";

/* The sidebar column is the 256px rail with a 10px gutter on either side. */
const SIDEBAR_COLUMN = "calc(var(--as-sidebar-width) + 2 * var(--as-gutter))";

/* The beams are full strength on the home screen only; every other page
 * gets a faint version so its content carries the screen. */
function BeamsBackground() {
  const { pathname } = useLocation();
  const isHome = pathname.replace(/\/$/, "") === "/app/ai";
  return (
    <div aria-hidden="true" className="as-beams" data-quiet={!isHome || undefined}>
      <div className="as-beam"><span /></div>
      <div className="as-beam"><span /></div>
      <div className="as-beam"><span /></div>
      <div className="as-beam"><span /></div>
      <div className="as-grain" />
    </div>
  );
}

export function WorkspaceShell() {
  return (
    <SidebarProvider
      className="as-shell"
      style={{ "--sidebar-width": SIDEBAR_COLUMN } as CSSProperties}
    >
      <WorkspaceEventsMount />
      <div className="relative flex h-dvh w-full">
        <AppSidebar />
        <SidebarInset className="as-main flex w-auto min-w-0 flex-col bg-transparent">
          <BeamsBackground />
          <header className="flex h-14 shrink-0 items-center gap-3 px-4 md:hidden">
            <SidebarTrigger />
            <img alt="Acceptra" height={17} src={wordmark} width={77} />
          </header>
          <WorkspaceOutlet />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
