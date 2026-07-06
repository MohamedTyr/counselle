import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { chatTransport, normalizeChatTitle } from "@/api/chat/transport";
import type {
  ChatSession,
  ChatSessionList,
  ChatSessionSummary,
  SetMessageFeedbackInput,
} from "@/api/chat/types";

export const chatKeys = {
  all: ["chat"] as const,
  config: () => [...chatKeys.all, "config"] as const,
  sessions: {
    all: () => [...chatKeys.all, "sessions"] as const,
    list: (input?: { q?: string; cursor?: string | null; limit?: number }) =>
      [...chatKeys.sessions.all(), "list", input ?? {}] as const,
  },
  session: (sessionId: string) =>
    [...chatKeys.all, "session", sessionId] as const,
};

type ListSessionsInput = {
  q?: string;
  cursor?: string | null;
  limit?: number;
};

export function useChatSessions(input: ListSessionsInput = {}) {
  return useQuery<ChatSessionList>({
    queryKey: chatKeys.sessions.list(input),
    queryFn: () => chatTransport.listSessions(input),
    staleTime: 30_000,
  });
}

export function useChatSession(sessionId: string) {
  return useQuery<ChatSession>({
    queryKey: chatKeys.session(sessionId),
    queryFn: () => chatTransport.getSession(sessionId),
  });
}

export function useRenameChatSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      chatTransport.renameSession(sessionId, title),
    onSuccess: (_data, { sessionId, title }) => {
      const normalizedTitle = normalizeChatTitle(title);
      queryClient.setQueriesData<ChatSessionList>(
        { queryKey: chatKeys.sessions.all() },
        (current) =>
          current
            ? {
                ...current,
                sessions: current.sessions.map((session) =>
                  session.sessionId === sessionId
                    ? { ...session, title: normalizedTitle }
                    : session,
                ),
              }
            : current,
      );
      queryClient.setQueryData<ChatSession>(
        chatKeys.session(sessionId),
        (current) =>
          current ? { ...current, title: normalizedTitle } : current,
      );
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions.all() });
    },
  });
}

export function useDeleteChatSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => chatTransport.deleteSession(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.setQueriesData<ChatSessionList>(
        { queryKey: chatKeys.sessions.all() },
        (current) =>
          current
            ? {
                ...current,
                sessions: current.sessions.filter(
                  (session) => session.sessionId !== sessionId,
                ),
              }
            : current,
      );
      queryClient.removeQueries({ queryKey: chatKeys.session(sessionId) });
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessions.all() });
    },
  });
}

function updateSessionFeedback(
  session: ChatSession | undefined,
  { messageId, rating }: SetMessageFeedbackInput,
): ChatSession | undefined {
  if (!session) {
    return session;
  }

  return {
    ...session,
    transcript: session.transcript.map((entry) =>
      entry.role === "assistant" && entry.message_id === messageId
        ? {
            ...entry,
            feedback: rating === null ? undefined : { rating },
          }
        : entry,
    ),
  };
}

export function useMessageFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SetMessageFeedbackInput) =>
      chatTransport.setMessageFeedback(input),
    onSuccess: (_data, input) => {
      queryClient.setQueryData<ChatSession>(
        chatKeys.session(input.sessionId),
        (current) => updateSessionFeedback(current, input),
      );
      void queryClient.invalidateQueries({
        queryKey: chatKeys.session(input.sessionId),
      });
    },
  });
}

export function markSessionGenerating(
  sessions: ChatSessionSummary[],
  sessionId: string,
  isGenerating: boolean,
) {
  return sessions.map((session) =>
    session.sessionId === sessionId ? { ...session, isGenerating } : session,
  );
}
