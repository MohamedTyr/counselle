import { useMemo } from "react";
import { matchPath, useLocation, useNavigate } from "react-router";

import {
  useChatSessions,
  useDeleteChatSession,
  useRenameChatSession,
} from "@/api/chat/hooks";

import { ChatSessionSection } from "./ChatSessionSection";
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

type ChatSessionListProps = {
  searchQuery: string;
};

export function ChatSessionList({ searchQuery }: ChatSessionListProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const sessionsQuery = useChatSessions(SESSION_LIST_INPUT);
  const renameSession = useRenameChatSession();
  const deleteSession = useDeleteChatSession();
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

  if (sessionsQuery.isLoading) {
    return null;
  }
  if (sessionsQuery.isError) {
    return (
      <p className="as-history-note" role="alert">
        Could not load chats.
      </p>
    );
  }
  if (filteredSessions.length === 0) {
    return (
      <p className="as-history-note">
        {searchQuery.trim()
          ? `No chats match “${searchQuery.trim()}”.`
          : "No recent chats."}
      </p>
    );
  }

  return (
    <div className="as-history-groups">
      {groups.map((group, groupIndex) => (
        <ChatSessionSection
          activeSessionId={activeSessionId}
          busySessionId={busySessionId}
          defaultOpen={groupIndex === 0 || searchQuery.trim().length > 0}
          group={group}
          key={group.id}
          onDelete={(sessionId) => void handleDelete(sessionId)}
          onRename={handleRename}
        />
      ))}
    </div>
  );
}
