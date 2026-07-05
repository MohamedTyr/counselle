"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { ChevronDown, ChevronUp } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { NavLink, useLocation } from "react-router"

export type Route = {
  id: string
  title: string
  icon?: React.ReactNode
  link: string
  subs?: {
    title: string
    link: string
    icon?: React.ReactNode
  }[]
}

type DashboardNavigationProps = {
  routes: Route[]
}

export default function DashboardNavigation({
  routes,
}: DashboardNavigationProps) {
  const { setOpenMobile, state } = useSidebar()
  const location = useLocation()
  const isCollapsed = state === "collapsed"
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null)

  return (
    <SidebarMenu>
      {routes.map((route) => {
        const isOpen = !isCollapsed && openCollapsible === route.id
        const hasSubRoutes = !!route.subs?.length
        const routeEnd = route.link === "/tasks"
        const isRouteActive = routeEnd
          ? location.pathname === route.link
          : location.pathname === route.link ||
            location.pathname.startsWith(`${route.link}/`)

        return (
          <SidebarMenuItem key={route.id}>
            {hasSubRoutes ? (
              <Collapsible
                open={isOpen}
                onOpenChange={(open) =>
                  setOpenCollapsible(open ? route.id : null)
                }
                className="w-full"
              >
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    onClick={() => {
                      setOpenCollapsible(route.id)
                    }}
                    className={cn(
                      "flex w-full items-center rounded-lg px-2 transition-colors",
                      isOpen
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                      isCollapsed && "justify-center"
                    )}
                  >
                    {route.icon}
                    {!isCollapsed && (
                      <span className="ml-2 flex-1 text-sm font-medium">
                        {route.title}
                      </span>
                    )}
                    {!isCollapsed && hasSubRoutes && (
                      <span className="ml-auto">
                        {isOpen ? <ChevronUp /> : <ChevronDown />}
                      </span>
                    )}
                  </SidebarMenuButton>
                </CollapsibleTrigger>

                {!isCollapsed && (
                  <CollapsibleContent>
                    <SidebarMenuSub className="my-1 ml-3.5">
                      {route.subs?.map((subRoute) => (
                        <SidebarMenuSubItem
                          key={`${route.id}-${subRoute.title}`}
                          className="h-auto"
                        >
                          <SidebarMenuSubButton asChild>
                            <NavLink
                              className={({ isActive }) =>
                                cn(
                                  "flex w-full items-center rounded-md px-4 py-1.5 text-left text-sm font-medium hover:bg-sidebar-accent hover:text-foreground",
                                  isActive
                                    ? "bg-sidebar-accent text-foreground"
                                    : "text-muted-foreground"
                                )
                              }
                              onClick={() => setOpenMobile(false)}
                              to={subRoute.link}
                            >
                              {subRoute.icon}
                              {subRoute.title}
                            </NavLink>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                )}
              </Collapsible>
            ) : (
              <SidebarMenuButton
                asChild
                isActive={isRouteActive}
                className={cn(
                  "h-9 rounded-lg px-2.5 transition-colors",
                  isRouteActive
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                  isCollapsed && "justify-center"
                )}
                tooltip={route.title}
              >
                <NavLink
                  end={routeEnd}
                  onClick={() => {
                    setOpenCollapsible(null)
                    setOpenMobile(false)
                  }}
                  to={route.link}
                >
                  <span
                    className={cn(
                      "flex items-center [&_svg]:size-4.5",
                      isCollapsed && "mx-auto"
                    )}
                  >
                    {route.icon}
                  </span>
                  {!isCollapsed && (
                    <span className="ml-2 text-sm font-medium">
                      {route.title}
                    </span>
                  )}
                </NavLink>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}
