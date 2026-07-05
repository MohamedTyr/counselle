"use client"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { motion } from "motion/react"
import { Logo } from "@/components/sidebar-02/logo"
import DashboardNavigation from "@/components/sidebar-02/nav-main"
import { NotificationsPopover } from "@/components/sidebar-02/nav-notifications"
import { TeamSwitcher } from "@/components/sidebar-02/team-switcher"
import { shellRoutes } from "@/app/shell/shell-config"
import { shellNotifications, shellTeams } from "@/fixtures/shell"

export function DashboardSidebar() {
  const { state } = useSidebar()
  const isCollapsed = state === "collapsed"

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader
        className={cn(
          "flex md:pt-3.5",
          isCollapsed
            ? "flex-row items-center justify-between gap-y-4 md:flex-col md:items-start md:justify-start"
            : "flex-row items-center justify-between"
        )}
      >
        <a href="#" className="flex items-center gap-2">
          <Logo className="size-8" />
          {!isCollapsed && (
            <span className="font-semibold text-foreground">Counselle</span>
          )}
        </a>

        <motion.div
          key={isCollapsed ? "header-collapsed" : "header-expanded"}
          className={cn(
            "flex items-center gap-2",
            isCollapsed ? "flex-row md:flex-col-reverse" : "flex-row"
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        >
          <NotificationsPopover notifications={shellNotifications} />
          <SidebarTrigger />
        </motion.div>
      </SidebarHeader>
      <SidebarContent className="gap-4 px-2 py-4">
        <DashboardNavigation routes={shellRoutes} />
      </SidebarContent>
      <SidebarFooter className="px-2">
        <TeamSwitcher teams={shellTeams} />
      </SidebarFooter>
    </Sidebar>
  )
}
