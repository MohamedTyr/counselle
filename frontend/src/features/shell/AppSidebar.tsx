import { Link, useNavigate } from "react-router";
import { useState } from "react";
import { LogOutIcon } from "lucide-react";

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
import { MainNav } from "@/features/shell/MainNav";
import { NewChatIcon } from "@/features/shell/sidebar-icons";
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
  const headerInset = isCollapsed
    ? "px-[var(--shell-sidebar-collapsed-inset-inline)]"
    : "px-[var(--shell-sidebar-header-inset-inline)]";
  const footerInset = isCollapsed
    ? "px-[var(--shell-sidebar-collapsed-inset-inline)]"
    : "px-[var(--shell-sidebar-footer-inset-inline)]";

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
        {/* 1a: 18px above, 14px below, 16px inline, 10px between mark and
         * wordmark. The wordmark is 16px/600 at -0.02em tracking. */}
        <SidebarHeader
          className={cn(
            "flex p-0 pt-[18px] pb-[14px]",
            headerInset,
            isCollapsed
              ? "flex-row items-center justify-between gap-y-4 md:flex-col md:justify-start"
              : "flex-row items-center justify-between",
          )}
        >
          {/* Wordmark only — no logo tile. Rendered solely when expanded:
           * with the mark gone there is nothing left to show collapsed, and
           * an empty <a> would stay in the tab order as an unlabelled stop. */}
          {!isCollapsed && (
            <Link
              className="text-base font-semibold tracking-[-0.02em] text-[var(--chrome-ink-strong)]"
              onClick={() => setOpenMobile(false)}
              to="/app/tasks"
            >
              Counselle
            </Link>
          )}

          {/* 1a: a 28px square at 8px radius, muted at rest, filling to the
           * neutral hover tone with a darker glyph on hover. */}
          <SidebarTrigger className="size-7 rounded-lg text-[var(--shell-sidebar-control-foreground)] hover:bg-[var(--chrome-hover)] hover:text-[var(--shell-sidebar-control-hover-foreground)]" />
        </SidebarHeader>

        {/* The one place --brand's full saturation earns its weight: the
         * product's primary action. The selected nav row uses a tint of the
         * same hue, so the two never compete — solid fill means "do this",
         * tint means "you are here".
         *
         * 1a draws this as a flat 40px pill at 12px radius with NO border
         * and no shadow — deliberately not the app's default Button, which
         * carries a rim and a cast shadow. On the rail the button has no
         * elevation to earn: it sits on a flat panel, not on the workspace
         * canvas, and the surrounding rows are flat too. */}
        <div className={cn("w-full pb-3", inset)}>
          <SidebarMenuButton
            className={cn(
              "h-10 gap-[9px] rounded-[12px] bg-[var(--brand)] text-sm font-medium",
              "text-[var(--on-brand)] transition-colors duration-150",
              "hover:bg-[var(--brand-hover)]! hover:text-[var(--on-brand)]!",
              "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              isCollapsed ? "justify-center px-0" : "px-3.5",
            )}
            onClick={() => {
              setOpenMobile(false);
              void navigate("/app/ai");
            }}
            tooltip="New chat"
            type="button"
          >
            <NewChatIcon className="!size-4" />
            {!isCollapsed && <span>New chat</span>}
          </SidebarMenuButton>
        </div>

        <nav
          aria-label="Main navigation"
          className={cn("w-full shrink-0", inset)}
        >
          <MainNav routes={shellRoutes} />
        </nav>

        {/* No rule between the nav and the history: 1a separates the two
         * with space and the filter field alone. The previous <hr> is gone
         * rather than restyled — on a rail this quiet a hairline reads as
         * the loudest thing on it.
         *
         * The mask is 1a's: the list fades out over its last 12% instead of
         * ending on a hard clipped row, which is what tells you it scrolls.
         * It is a mask, not an overlay gradient, so it works regardless of
         * what colour sits behind the rail. */}
        {!isCollapsed && (
          <div
            className="sidebar-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-[var(--shell-sidebar-inset-inline)] pt-4"
            style={{
              maskImage:
                "linear-gradient(to bottom, #000 88%, transparent 100%)",
            }}
          >
            <ChatSessionList />
          </div>
        )}

        {/* 1a: 6px above / 10px below / 10px inline, and the row itself is a
         * 13px-radius pill — rounder than any nav row, which is what stops
         * the account block reading as one more item in the list. */}
        <SidebarFooter
          className={cn("mt-auto gap-1 p-0 pt-1.5 pb-2.5", footerInset)}
        >
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
                  "h-auto gap-2.5 rounded-[13px] py-[9px] text-[var(--chrome-ink-secondary)]",
                  "transition-colors duration-150",
                  "hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-ink-strong)]",
                  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                  isCollapsed ? "justify-center px-0" : "px-2.5",
                )}
                tooltip={displayName}
                type="button"
              >
                {/* 1a draws the avatar chip a shade deeper than the selected
                 * nav pill (wine-100 vs wine-50) with its own half-chroma
                 * ink, so the two brand tints never look like the same
                 * component at two sizes. */}
                <Avatar className="size-[30px] shrink-0 rounded-[10px]">
                  <AvatarFallback className="rounded-[10px] bg-[var(--wine-100)] text-[11px] font-semibold text-[var(--wine-ink-on-100)]">
                    {initialsFrom(displayName)}
                  </AvatarFallback>
                </Avatar>
                {!isCollapsed && (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col gap-px text-left">
                      <span className="truncate text-[13px] font-medium text-[var(--chrome-ink)]">
                        {displayName}
                      </span>
                      {user?.email && user.email !== displayName && (
                        <span className="truncate text-[11.5px] text-[var(--shell-sidebar-quiet-foreground)]">
                          {user.email}
                        </span>
                      )}
                    </span>
                    {/* 1a draws this as three typographic middle dots, not
                     * an icon — a lighter mark than a lucide glyph at the
                     * same size, which is the point on a row this quiet. */}
                    <span
                      aria-hidden="true"
                      className="shrink-0 pr-0.5 text-[15px] leading-none tracking-[0.06em] text-[var(--shell-sidebar-quiet-foreground)]"
                    >
                      ···
                    </span>
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
