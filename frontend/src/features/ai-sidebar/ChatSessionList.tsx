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
  SidebarInput,
  SidebarMenu,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";

import { ChatSessionRow } from "./ChatSessionRow";
import { groupSessionsByRecency } from "./group-sessions";

const SESSION_LIST_INPUT = { limit: 50 } as const;

function activeSessionIdFromPath(pathname: string) {
  return matchPath({ path: "/app/ai/:sessionId", end: true }, pathname)?.params
    .sessionId;
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
  const groups = useMemo(
    () => groupSessionsByRecency(filteredSessions),
    [filteredSessions],
  );
  const busySessionId =
    renameSession.isPending && renameSession.variables !== undefined
      ? renameSession.variables.sessionId
      : deleteSession.isPending && deleteSession.variables !== undefined
        ? deleteSession.variables
        : null;

  async function handleRename(
    sessionId: string,
    title: string,
  ): Promise<boolean> {
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
    <SidebarGroup className="p-0">
      <SidebarGroupContent className="flex flex-col gap-2">
        <div className="sidebar-chat-search relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-sidebar-foreground transition-colors"
          />
          <SidebarInput
            aria-label="Search chats"
            className="h-11 rounded-md border-transparent !bg-transparent !shadow-none before:hidden hover:!bg-sidebar-accent has-focus-visible:border-transparent has-focus-visible:!bg-sidebar-accent has-focus-visible:!ring-0 md:h-8 pointer-coarse:!h-11 [&_input]:!h-11 [&_input]:!pr-3 [&_input]:!pl-8 [&_input]:text-sidebar-accent-foreground [&_input]:placeholder:text-sidebar-foreground [&_input]:placeholder:opacity-100 md:[&_input]:!h-8 pointer-coarse:[&_input]:!h-11"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search"
            type="search"
            value={searchQuery}
          />
        </div>

        {sessionsQuery.isLoading ? (
          <div className="flex flex-col gap-1 px-0.5">
            <SidebarMenuSkeleton />
            <SidebarMenuSkeleton />
            <SidebarMenuSkeleton />
          </div>
        ) : sessionsQuery.isError ? (
          <p className="px-2 text-xs text-muted-foreground" role="alert">
            Could not load chats.
          </p>
        ) : filteredSessions.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {searchQuery.trim()
              ? `No chats match “${searchQuery.trim()}”.`
              : "No recent chats."}
          </p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {groups.map((group) => (
              <section
                aria-label={group.label}
                className="sidebar-chat-group flex flex-col gap-0.5"
                key={group.id}
              >
                <h3 className="sidebar-chat-group-label">{group.label}</h3>
                <SidebarMenu className="gap-0.5">
                  {group.sessions.map((session, index) => (
                    <ChatSessionRow
                      active={session.sessionId === activeSessionId}
                      index={index}
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
              </section>
            ))}
          </div>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
