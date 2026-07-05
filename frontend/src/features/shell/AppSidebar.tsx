import { Link } from "react-router";

import { shellRoutes } from "@/app/shell/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { CounselleLogo } from "@/features/shell/CounselleLogo";
import { MainNav } from "@/features/shell/MainNav";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const { isMobile, setOpenMobile, state } = useSidebar();
  const isCollapsed = !isMobile && state === "collapsed";

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <div
        className={cn(
          "flex h-full flex-col gap-4 py-[var(--shell-sidebar-inset-block)]",
          isCollapsed
            ? "items-center px-[var(--shell-sidebar-collapsed-inset-inline)]"
            : "px-[var(--shell-sidebar-inset-inline)]",
        )}
      >
        <SidebarHeader
          className={cn(
            "flex p-0",
            isCollapsed
              ? "flex-row items-center justify-between gap-y-4 md:flex-col md:justify-start"
              : "flex-row items-center justify-between",
          )}
        >
          <Link
            aria-label="Counselle"
            className="flex items-center gap-2"
            onClick={() => setOpenMobile(false)}
            to="/tasks"
          >
            <CounselleLogo className="size-7" />
            {!isCollapsed && (
              <span className="font-semibold text-sidebar-foreground">
                Counselle
              </span>
            )}
          </Link>

          <SidebarTrigger />
        </SidebarHeader>
        <SidebarContent className="gap-4 p-0">
          <MainNav routes={shellRoutes} />
        </SidebarContent>
      </div>
    </Sidebar>
  );
}
