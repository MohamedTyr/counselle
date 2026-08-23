import { type CSSProperties, useMemo, useState } from "react";
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

import { FilterIcon } from "@/features/shell/sidebar-icons";

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
      <SidebarGroupContent className="flex flex-col gap-2.5">
        {/* No "Chats" eyebrow above the field: 1a doesn't draw one, and the
         * "Filter conversations" placeholder already says what the input
         * acts on. The heading existed to stop the field reading as global
         * search; a bordered, filled field sitting directly above the
         * recency groups does that on its own.
         *
         * 1a's field: 34px tall, 10px radius, 11px inline padding, a real
         * fill (#f1f0ed) and a real border (#e4e3df). The previous field
         * was transparent and borderless until hovered, which is the one
         * thing here that genuinely changes behaviour — it now reads as an
         * input before you touch it. */}
        {/* Text starts at 35px: 11px of field padding + a 15px glyph + the
         * 9px gap 1a puts between them. */}
        <div className="sidebar-chat-search relative">
          <FilterIcon className="pointer-events-none absolute top-1/2 left-[11px] z-10 -translate-y-1/2 text-[var(--shell-sidebar-field-placeholder)] transition-colors" />
          <SidebarInput
            aria-label="Search chats"
            className="h-11 rounded-[10px] border-[var(--shell-sidebar-field-border)] !bg-[var(--shell-sidebar-field)] !shadow-none before:hidden has-focus-visible:border-[var(--focus-ring)] has-focus-visible:!ring-0 md:h-[34px] pointer-coarse:!h-11 [&_input]:!h-11 [&_input]:!pr-3 [&_input]:!pl-[35px] [&_input]:text-[13px] [&_input]:text-[var(--chrome-ink)] [&_input]:placeholder:text-[var(--shell-sidebar-field-placeholder)] [&_input]:placeholder:opacity-100 md:[&_input]:!h-[34px] pointer-coarse:[&_input]:!h-11"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filter conversations"
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
          /* 1a: 14px between recency groups, 1px between rows inside one. */
          <div className="flex flex-col gap-3.5">
            {groups.map((group, groupIndex) => (
              <section
                aria-label={group.label}
                className="sidebar-chat-group flex flex-col gap-px"
                key={group.id}
                /* 1a inks the most recent group one step darker than the
                 * rest — the only hierarchy in the history list, and it is
                 * doing real work: it says "these are the ones you were
                 * just in" without adding a badge or a timestamp. */
                style={
                  groupIndex === 0
                    ? ({
                        "--sidebar-row-ink":
                          "var(--shell-sidebar-row-foreground)",
                      } as CSSProperties)
                    : undefined
                }
              >
                <h3 className="sidebar-chat-group-label">{group.label}</h3>
                <SidebarMenu className="gap-px">
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
