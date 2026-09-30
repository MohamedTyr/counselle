import { useState } from "react";
import { useNavigate } from "react-router";
import { LogOutIcon } from "lucide-react";

import { useAuthUser, useLogout } from "@/app/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";

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

/** The account row pinned to the bottom of the sidebar: who is signed in,
 * with Log out behind a menu so a stray click never ends the session. */
export function AccountMenu() {
  const user = useAuthUser();
  const logoutMutation = useLogout();
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const [logoutError, setLogoutError] = useState<string | undefined>();
  const displayName = user?.name ?? user?.email ?? "Account";

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
    <div className="as-account">
      {logoutError && (
        <p className="as-account-error" role="alert">
          {logoutError}
        </p>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Account menu for ${displayName}`}
            className="as-account-row"
            type="button"
          >
            <span aria-hidden="true" className="as-avatar">
              {initialsFrom(displayName)}
            </span>
            <span className="as-account-text">
              <span className="as-account-name">{displayName}</span>
              {user?.email && user.email !== displayName && (
                <span className="as-account-email">{user.email}</span>
              )}
            </span>
          </button>
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
    </div>
  );
}
