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

/*
 * A nav row's three states. Kept as one string so every row — top level and
 * sub-route alike — resolves the same vocabulary, and so the selected case
 * can't drift from the token contract documented in semantic.css's chrome
 * block (rest -> hover -> selected, each a real step darker).
 *
 * The selected row's left edge bar is the ::before below: it reads as an
 * indicator anchored to the rail rather than decoration inside the pill,
 * and it gives selection a second, non-colour channel alongside the weight
 * bump — so the state survives both colourblindness and a grayscale print.
 */
const navRowClassName = cn(
  "relative h-8 gap-2 rounded-lg px-2 text-[13px] font-medium",
  "text-[var(--chrome-ink-secondary)] transition-colors duration-150",
  "hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-ink-strong)]",
  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
  "data-active:bg-[var(--chrome-active)] data-active:font-semibold",
  "data-active:text-[var(--on-chrome-active)]",
  "data-active:before:absolute data-active:before:top-1/2 data-active:before:left-0",
  "data-active:before:h-4 data-active:before:w-[2px] data-active:before:-translate-x-3",
  "data-active:before:-translate-y-1/2 data-active:before:rounded-full",
  "data-active:before:bg-[var(--on-chrome-active)]",
);

export function MainNav({ routes }: MainNavProps) {
  const { isMobile, setOpenMobile, state } = useSidebar();
  const location = useLocation();
  const isCollapsed = !isMobile && state === "collapsed";
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);

  return (
    <SidebarMenu className="gap-0.5">
      {routes.map((route) => {
        const isOpen = !isCollapsed && openCollapsible === route.id;
        const hasSubRoutes = Boolean(route.subs?.length);
        const routeEnd = route.link === "/app/tasks";
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
                      navRowClassName,
                      isCollapsed && "justify-center px-0",
                    )}
                    isActive={isOpen}
                    onClick={() => setOpenCollapsible(route.id)}
                    tooltip={route.title}
                  >
                    {route.icon}
                    {!isCollapsed && (
                      <>
                        <span className="flex-1 truncate text-left">
                          {route.title}
                        </span>
                        <span className="text-[var(--chrome-ink-muted)]">
                          {isOpen ? <ChevronUp /> : <ChevronDown />}
                        </span>
                      </>
                    )}
                  </SidebarMenuButton>
                </CollapsibleTrigger>

                {!isCollapsed && (
                  <CollapsibleContent>
                    <SidebarMenuSub className="mt-0.5 ml-4 gap-0.5 border-[var(--chrome-border)] pl-2">
                      {route.subs?.map((subRoute) => (
                        <SidebarMenuSubItem
                          key={`${route.id}-${subRoute.title}`}
                        >
                          <SidebarMenuSubButton
                            asChild
                            className={cn(navRowClassName, "w-full")}
                            isActive={location.pathname === subRoute.link}
                          >
                            <NavLink
                              aria-label={subRoute.title}
                              onClick={() => setOpenMobile(false)}
                              to={subRoute.link}
                            >
                              {subRoute.icon}
                              <span className="truncate">{subRoute.title}</span>
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
                  navRowClassName,
                  isCollapsed && "justify-center px-0",
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
                  {route.icon}
                  {!isCollapsed && (
                    <span className="truncate">{route.title}</span>
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
