import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { LogOutIcon, MoreHorizontal, SquarePen } from "lucide-react";

import { useAuthUser, useLogout } from "@/app/auth";
import { shellRoutes } from "@/app/shell/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { CounselleLogo } from "@/features/shell/CounselleLogo";
import { MainNav } from "@/features/shell/MainNav";
import { ChatSessionList } from "@/features/ai-sidebar/ChatSessionList";
import { cn } from "@/lib/utils";

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const [first, last] = [parts[0], parts.at(-1)];
  return (
    parts.length === 1 ? first.slice(0, 2) : `${first[0]}${last?.[0] ?? ""}`
  ).toLocaleUpperCase();
}

export function AppSidebar() {
  const { isMobile, setOpenMobile, state } = useSidebar();
  const isCollapsed = !isMobile && state === "collapsed";
  const user = useAuthUser();
  const logoutMutation = useLogout();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | undefined>();

  const displayName = user?.name ?? user?.email ?? "Account";
  const inset = isCollapsed
    ? "px-[var(--shell-sidebar-collapsed-inset-inline)]"
    : "px-[var(--shell-sidebar-inset-inline)]";

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
      {/*
       * Zones, top to bottom: header / primary action / nav are pinned, and
       * only the chat list scrolls. Previously all three shared one scroll
       * container, so the nav scrolled away as soon as the history got long
       * — the min-h-0 + overflow-y-auto pair below is what confines
       * scrolling to the history alone.
       */}
      <div
        className={cn(
          "flex h-full min-h-0 flex-col py-[var(--shell-sidebar-inset-block)]",
          isCollapsed && "items-center",
        )}
      >
        <SidebarHeader
          className={cn(
            "flex p-0",
            inset,
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
              <span className="font-semibold text-[var(--chrome-ink-strong)]">
                Counselle
              </span>
            )}
          </Link>

          <SidebarTrigger />
        </SidebarHeader>

        {/* The one place --brand's full saturation earns its weight: the
         * product's primary action. The selected nav row uses a tint of the
         * same hue, so the two never compete — solid fill means "do this",
         * tint means "you are here". */}
        <div className={cn("mt-4 w-full", inset)}>
          <SidebarMenuButton
            className={cn(
              "h-9 gap-2 rounded-lg bg-[var(--brand)] text-[13px] font-semibold",
              "text-[var(--on-brand)] transition-colors duration-150",
              "hover:bg-[var(--brand-hover)]! hover:text-[var(--on-brand)]!",
              "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              isCollapsed ? "justify-center px-0" : "px-2.5",
            )}
            onClick={() => {
              setOpenMobile(false);
              void navigate("/app/ai");
            }}
            tooltip="New chat"
            type="button"
          >
            <SquarePen />
            {!isCollapsed && <span>New chat</span>}
          </SidebarMenuButton>
        </div>

        <nav
          aria-label="Main navigation"
          className={cn("mt-4 w-full shrink-0", inset)}
        >
          <MainNav routes={shellRoutes} />
        </nav>

        {!isCollapsed && (
          <>
            <hr className="mt-4 mr-1.5 ml-[var(--shell-sidebar-inset-inline)] border-0 border-t border-[var(--chrome-border)]" />
            <div className="sidebar-scroll mt-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1.5 pl-[var(--shell-sidebar-inset-inline)]">
              <ChatSessionList />
            </div>
          </>
        )}

        <SidebarFooter className={cn("mt-auto gap-1 p-0 pt-3", inset)}>
          {logoutError && !isCollapsed && (
            <p className="text-xs text-destructive" role="alert">
              {logoutError}
            </p>
          )}

          {/* The row identifies the user; the MENU holds the action. The
           * previous shape made the whole row a logout target labelled
           * "Mohamed Abdelhamid / Log out", which both read as a job title
           * and ended your session on a stray click. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                aria-label={`Account menu for ${displayName}`}
                className={cn(
                  "h-auto gap-2 rounded-lg py-1.5 text-[var(--chrome-ink-secondary)]",
                  "transition-colors duration-150",
                  "hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-ink-strong)]",
                  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                  isCollapsed ? "justify-center px-0" : "px-2",
                )}
                tooltip={displayName}
                type="button"
              >
                <Avatar className="size-6 shrink-0">
                  <AvatarFallback className="bg-[var(--brand-subtle)] text-[10px] font-semibold text-[var(--brand-subtle-ink)]">
                    {initialsFrom(displayName)}
                  </AvatarFallback>
                </Avatar>
                {!isCollapsed && (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col text-left">
                      <span className="truncate text-[13px] font-medium text-[var(--chrome-ink)]">
                        {displayName}
                      </span>
                      {user?.email && user.email !== displayName && (
                        <span className="truncate text-[11px] text-[var(--chrome-ink-muted)]">
                          {user.email}
                        </span>
                      )}
                    </span>
                    <MoreHorizontal className="shrink-0 text-[var(--chrome-ink-muted)]" />
                  </>
                )}
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56" side="top">
              <DropdownMenuItem
                disabled={logoutMutation.isPending}
                onSelect={() => void handleLogout()}
                variant="destructive"
              >
                <LogOutIcon />
                {logoutMutation.isPending ? "Logging out…" : "Log out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </div>
    </Sidebar>
  );
}
