import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { DashboardSidebar } from "@/components/sidebar-02/app-sidebar"
import { WorkspaceOutlet } from "@/app/shell/WorkspaceOutlet"

export function WorkspaceShell() {
  return (
    <SidebarProvider>
      <div className="relative flex h-dvh w-full">
        <DashboardSidebar />
        <SidebarInset className="flex min-w-0 flex-col overflow-hidden">
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
