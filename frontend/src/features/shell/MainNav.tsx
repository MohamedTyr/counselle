import type React from "react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { ChevronDown, ChevronUp } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export type ShellRoute = {
  id: string;
  title: string;
  icon?: React.ReactNode;
  link: string;
  subs?: {
    title: string;
    link: string;
    icon?: React.ReactNode;
  }[];
};

type MainNavProps = {
  routes: ShellRoute[];
};

export function MainNav({ routes }: MainNavProps) {
  const { isMobile, setOpenMobile, state } = useSidebar();
  const location = useLocation();
  const isCollapsed = !isMobile && state === "collapsed";
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);

  return (
    <SidebarMenu>
      {routes.map((route) => {
        const isOpen = !isCollapsed && openCollapsible === route.id;
        const hasSubRoutes = Boolean(route.subs?.length);
        const routeEnd = route.link === "/tasks";
        const isRouteActive = routeEnd
          ? location.pathname === route.link
          : location.pathname === route.link ||
            location.pathname.startsWith(`${route.link}/`);

        return (
          <SidebarMenuItem key={route.id}>
            {hasSubRoutes ? (
              <Collapsible
                className="w-full"
                onOpenChange={(open) =>
                  setOpenCollapsible(open ? route.id : null)
                }
                open={isOpen}
              >
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    aria-label={route.title}
                    className={cn(
                      "flex w-full items-center rounded-lg px-2 transition-colors",
                      isOpen
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      isCollapsed && "justify-center",
                    )}
                    onClick={() => {
                      setOpenCollapsible(route.id);
                    }}
                  >
                    {route.icon}
                    {!isCollapsed && (
                      <span className="ml-2 flex-1 text-sm font-medium">
                        {route.title}
                      </span>
                    )}
                    {!isCollapsed && (
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
                          className="h-auto"
                          key={`${route.id}-${subRoute.title}`}
                        >
                          <SidebarMenuSubButton asChild>
                            <NavLink
                              aria-label={subRoute.title}
                              className={({ isActive }) =>
                                cn(
                                  "flex w-full items-center rounded-md px-4 py-1.5 text-left text-sm font-medium hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                  isActive
                                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                    : "text-sidebar-foreground",
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
                className={cn(
                  "h-9 rounded-lg px-2.5 transition-colors",
                  isRouteActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isCollapsed && "justify-center",
                )}
                isActive={isRouteActive}
                tooltip={route.title}
              >
                <NavLink
                  aria-label={route.title}
                  end={routeEnd}
                  onClick={() => {
                    setOpenCollapsible(null);
                    setOpenMobile(false);
                  }}
                  to={route.link}
                >
                  <span
                    className={cn(
                      "flex items-center",
                      isCollapsed && "mx-auto",
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
        );
      })}
    </SidebarMenu>
  );
}
