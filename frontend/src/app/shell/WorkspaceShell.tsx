import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { WorkspaceOutlet } from "@/app/shell/WorkspaceOutlet"
import { WorkspaceEventsMount } from "@/api/workspace/events"
import { AppSidebar } from "@/features/shell/AppSidebar"

export function WorkspaceShell() {
  return (
    <SidebarProvider>
      <WorkspaceEventsMount />
      <div className="relative flex h-dvh w-full">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-col overflow-hidden md:mr-2 md:mb-2 md:ml-0 md:rounded-xl md:shadow-sm">
          <header className="flex h-14 shrink-0 items-center gap-3 px-4 md:hidden">
            <SidebarTrigger />
            <span className="font-semibold">Counselle</span>
          </header>
          <WorkspaceOutlet />
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
