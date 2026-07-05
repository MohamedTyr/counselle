import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { LogOutIcon } from "lucide-react";

import { useAuthUser, useLogout } from "@/app/auth";
import { shellRoutes } from "@/app/shell/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { CounselleLogo } from "@/features/shell/CounselleLogo";
import { MainNav } from "@/features/shell/MainNav";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const { isMobile, setOpenMobile, state } = useSidebar();
  const isCollapsed = !isMobile && state === "collapsed";
  const user = useAuthUser();
  const logoutMutation = useLogout();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | undefined>();

  async function handleLogout() {
    try {
      setLogoutError(undefined);
      await logoutMutation.mutateAsync();
      setOpenMobile(false);
      navigate("/login", { replace: true });
    } catch {
      setLogoutError("Could not log out. Please try again.");
    }
  }

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
            to="/app/tasks"
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
        <SidebarFooter className="mt-auto p-0">
          {logoutError && !isCollapsed && (
            <p className="px-2 text-xs text-destructive" role="alert">
              {logoutError}
            </p>
          )}
          <SidebarMenuButton
            className={cn("h-auto min-h-9", isCollapsed && "justify-center")}
            disabled={logoutMutation.isPending}
            onClick={() => void handleLogout()}
            tooltip="Log out"
            type="button"
          >
            <LogOutIcon />
            {!isCollapsed && (
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {user?.name ?? user?.email ?? "Account"}
                </span>
                <span className="text-xs text-muted-foreground">Log out</span>
              </span>
            )}
          </SidebarMenuButton>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
