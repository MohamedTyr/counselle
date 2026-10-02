import { useState } from "react";
import { Link } from "react-router";

import { useAuthUser } from "@/app/auth";
import { adminShellRoutes, shellRoutes } from "@/app/shell/navigation";
import micIcon from "@/assets/app-shell/mic.svg";
import searchIcon from "@/assets/app-shell/search.svg";
import wordmark from "@/assets/app-shell/wordmark.svg";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { ChatSessionList } from "@/features/ai-sidebar/ChatSessionList";
import { AccountMenu } from "@/features/shell/AccountMenu";
import { MainNav } from "@/features/shell/MainNav";

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  const user = useAuthUser();
  const [searchQuery, setSearchQuery] = useState("");
  const navRoutes = user?.is_superuser
    ? [...shellRoutes, ...adminShellRoutes]
    : shellRoutes;

  return (
    <Sidebar
      className="border-0 group-data-[side=left]:border-r-0 md:p-[var(--as-gutter)] [&>[data-slot=sidebar-inner]]:bg-transparent"
      collapsible="offcanvas"
      variant="sidebar"
    >
      <div className="as-sidebar">
        <Link
          aria-label="Acceptra home"
          className="as-brand"
          onClick={() => setOpenMobile(false)}
          to="/app/ai"
        >
          <img alt="" height={17} src={wordmark} width={77} />
        </Link>

        <div className="as-search-wrap">
          <label className="as-search">
            <img alt="" height={17} src={searchIcon} width={17} />
            <input
              aria-label="Search chats"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search"
              type="search"
              value={searchQuery}
            />
            <img alt="" height={17} src={micIcon} width={17} />
          </label>
        </div>

        <MainNav routes={navRoutes} />

        <div className="as-history">
          <ChatSessionList searchQuery={searchQuery} />
        </div>

        <AccountMenu />
      </div>
    </Sidebar>
  );
}
