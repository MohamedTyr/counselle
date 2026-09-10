import { useQuery } from "@tanstack/react-query";

import { createEssayChatSession } from "@/api/workspace/essays";
import { workspaceKeys } from "@/api/workspace/keys";

/*
 * The essay's one durable chat thread.
 *
 * Deliberately NOT a localStorage map of essay to session. The conversation
 * about an essay is a property of the essay, so it has to follow the essay to
 * another browser or another device — a client-side map hands the student a
 * blank panel on their laptop and a different blank panel on their phone, with
 * nothing to tell them they lost anything.
 *
 * A POST behind `useQuery` reads oddly at first glance and is right here: the
 * endpoint is get-or-create, so calling it is a read of "this essay's
 * session" whose first call happens to also create the row. Caching it means
 * collapsing and reopening the panel does not re-POST.
 *
 * There is no "new chat" control anywhere above this. A partial unique index
 * enforces exactly one session per essay, so a second control could only
 * FORGET the thread, never retire it — silently discarding the conversation
 * with no way back is worse than having no control at all.
 */
export function useEssayChatSession(essayId: string) {
  const query = useQuery({
    queryFn: () => createEssayChatSession(essayId),
    queryKey: [...workspaceKeys.essays.detail(essayId), "chat-session"],
    /* The id never changes for an essay, so refetching it can only ever
     * return the same row. */
    staleTime: Infinity,
  });

  return {
    error: query.error,
    isLoading: query.isPending,
    retry: query.refetch,
    sessionId: query.data?.session_id ?? null,
  };
}
