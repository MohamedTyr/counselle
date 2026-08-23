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
 * A nav row's three states, transcribed from variant 1a of the Sidebar
 * Redesign design doc. Kept as one string so every row — top level and
 * sub-route alike — resolves the same vocabulary.
 *
 * 1a's measurements: 36px tall, 12px inline padding, 10px radius, 11px gap
 * between icon and label, 14px label. Rest is transparent with no weight
 * (400); hover adds the neutral #eeede9 fill; selected swaps to the brand
 * tint #f8e6e7 with its half-chroma ink and steps the weight to 500.
 *
 * The previous scheme's 2px left edge bar is GONE, deliberately. It existed
 * because hover and selected used to share one neutral fill, which left the
 * background unable to distinguish them — selection had to be carried by
 * label colour, a weight bump and the bar together. 1a gives selected its
 * own tinted fill, so the bar is a third redundant marker on a row that
 * already reads unambiguously, and it is not in the doc. Weight still
 * carries the state through greyscale and colourblindness.
 */
const navRowClassName = cn(
  "relative h-9 gap-[11px] rounded-[10px] px-3 text-sm font-normal",
  // SidebarMenuButton ships `[&_svg]:size-4`; 1a's nav glyphs are 17px.
  "[&_svg]:!size-[17px]",
  "text-[var(--chrome-ink-secondary)] transition-colors duration-150",
  "hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-ink-strong)]",
  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
  "data-active:bg-[var(--chrome-active)] data-active:font-medium",
  "data-active:text-[var(--on-chrome-active)]",
  "data-active:hover:bg-[var(--chrome-active)]",
  "data-active:hover:text-[var(--on-chrome-active)]",
);

export function MainNav({ routes }: MainNavProps) {
  const { isMobile, setOpenMobile, state } = useSidebar();
  const location = useLocation();
  const isCollapsed = !isMobile && state === "collapsed";
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);

  return (
    /* 1a stacks nav rows at a 1px gap — the rows are tall enough that any
     * more reads as a list of separate buttons rather than one column. */
    <SidebarMenu className="gap-px">
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
