import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "mvp3-frontend"
import { CheckSquare, Calendar, FileText, GraduationCap, Award } from "lucide-react"

const items = [
  { title: "Tasks", icon: CheckSquare, active: true },
  { title: "Calendar", icon: Calendar },
  { title: "Essays", icon: FileText },
  { title: "Schools", icon: GraduationCap },
  { title: "Activities", icon: Award },
]

export function Navigation() {
  return (
    <div className="h-[26rem] w-64 overflow-hidden rounded-xl border">
      <SidebarProvider>
        <Sidebar collapsible="none" className="h-full">
          <SidebarHeader className="px-3 py-4 text-sm font-semibold">
            Counselle
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton isActive={item.active}>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </div>
  )
}
