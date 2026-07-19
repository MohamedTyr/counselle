import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { matchPath, useLocation, useNavigate } from "react-router";

import {
  useChatSessions,
  useDeleteChatSession,
  useRenameChatSession,
} from "@/api/chat/hooks";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInput,
  SidebarMenu,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";

import { ChatSessionRow } from "./ChatSessionRow";

const SESSION_LIST_INPUT = { limit: 50 } as const;

function activeSessionIdFromPath(pathname: string) {
  return matchPath({ path: "/app/ai/:sessionId", end: true }, pathname)?.params.sessionId;
}

function matchesSearch(title: string | null, searchQuery: string) {
  if (!searchQuery.trim()) {
    return true;
  }
  return (title ?? "Untitled")
    .toLocaleLowerCase()
    .includes(searchQuery.trim().toLocaleLowerCase());
}

export function ChatSessionList() {
  const location = useLocation();
  const navigate = useNavigate();
  const sessionsQuery = useChatSessions(SESSION_LIST_INPUT);
  const renameSession = useRenameChatSession();
  const deleteSession = useDeleteChatSession();
  const [searchQuery, setSearchQuery] = useState("");
  const activeSessionId = activeSessionIdFromPath(location.pathname);

  const filteredSessions = useMemo(
    () =>
      (sessionsQuery.data?.sessions ?? []).filter((session) =>
        matchesSearch(session.title, searchQuery),
      ),
    [searchQuery, sessionsQuery.data?.sessions],
  );
  const busySessionId =
    renameSession.isPending && renameSession.variables !== undefined
      ? renameSession.variables.sessionId
      : deleteSession.isPending && deleteSession.variables !== undefined
        ? deleteSession.variables
        : null;

  async function handleRename(sessionId: string, title: string): Promise<boolean> {
    try {
      await renameSession.mutateAsync({ sessionId, title });
      return true;
    } catch {
      return false;
    }
  }

  async function handleDelete(sessionId: string) {
    try {
      await deleteSession.mutateAsync(sessionId);
      if (sessionId === activeSessionId) {
        void navigate("/app/ai", { replace: true });
      }
    } catch {
      // Keep the row in place; the mutation state already exposes the retry path.
    }
  }

  return (
    <SidebarGroup className="min-h-0 flex-1 p-0">
      <SidebarGroupLabel className="text-sidebar-foreground">
        Recent chats
      </SidebarGroupLabel>
      <SidebarGroupContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="sidebar-chat-search relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-sidebar-foreground"
          />
          <SidebarInput
            aria-label="Search chats"
            className="h-11 rounded-md border-transparent !bg-transparent !shadow-none before:hidden hover:!bg-sidebar-accent has-focus-visible:border-transparent has-focus-visible:!bg-transparent has-focus-visible:!ring-0 md:h-8 pointer-coarse:!h-11 dark:!bg-transparent dark:hover:!bg-sidebar-accent dark:has-focus-visible:!bg-transparent [&_input]:!h-11 [&_input]:!pr-3 [&_input]:!pl-8 [&_input]:text-sidebar-accent-foreground [&_input]:placeholder:text-sidebar-foreground [&_input]:placeholder:opacity-100 md:[&_input]:!h-8 pointer-coarse:[&_input]:!h-11"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={searchQuery}
          />
        </div>

        {sessionsQuery.isLoading ? (
          <div className="flex flex-col gap-1">
            <SidebarMenuSkeleton />
            <SidebarMenuSkeleton />
            <SidebarMenuSkeleton />
          </div>
        ) : sessionsQuery.isError ? (
          <p className="px-2 text-xs text-muted-foreground" role="alert">
            Could not load chats.
          </p>
        ) : filteredSessions.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">
            {searchQuery.trim()
              ? `No chats match “${searchQuery.trim()}”.`
              : "No recent chats."}
          </p>
        ) : (
          <SidebarMenu className="sidebar-chat-scrollbar-hidden min-h-0 flex-1 overflow-y-auto pr-1">
            {filteredSessions.map((session) => (
              <ChatSessionRow
                active={session.sessionId === activeSessionId}
                isBusy={busySessionId === session.sessionId}
                key={session.sessionId}
                onDelete={(sessionId) => void handleDelete(sessionId)}
                onRename={(sessionId, title) =>
                  handleRename(sessionId, title)
                }
                session={session}
              />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
