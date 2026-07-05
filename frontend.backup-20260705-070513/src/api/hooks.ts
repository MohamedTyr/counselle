/**
 * TanStack Query v4 hooks over the real `/v1` backend (B5c).
 *
 * The mock-store reads were swapped for HTTP clients in `http/sessions.ts`,
 * `http/config.ts`, and `http/feedback.ts`. Query keys + return shapes are
 * unchanged from the mock era, so the consuming components were untouched
 * except where the new data (config async, is_generating) flows.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listSessions,
  renameSession,
  deleteSession,
} from './http/sessions';
import { fetchConfig, type ConfigData } from './http/config';
import { setFeedback, type WireRating } from './http/feedback';
import { fromWire } from './source-config';
import { setDefaultSourceConfig } from './sourceConfigStore';

export const QueryKeys = {
  chats: 'chats' as const,
  me: 'me' as const,
  config: 'config' as const,
};

// ── Queries ──────────────────────────────────────────────────────────────────

/** GET /v1/sessions — the sidebar list. On 401 the AuthGate handles the
 *  redirect; the sidebar tolerates an error/empty result (`data = []`). */
export function useChatsQuery() {
  return useQuery([QueryKeys.chats], () => listSessions(), {
    staleTime: 30_000,
    cacheTime: 300_000,
  });
}

/** GET /v1/config — the season-keyed home-screen config. Near-static per
 *  session; seeds the default source config into the store on resolve. */
export function useConfigQuery() {
  return useQuery([QueryKeys.config], () => fetchConfig(), {
    // Config is near-static per session; never background-refetch so onSuccess
    // seeds the store once and can't clobber a mid-session Settings→General edit.
    staleTime: Infinity,
    cacheTime: 600_000,
    onSuccess: (data: ConfigData) => {
      // The user's server-side default sources seed new-chat dropdowns.
      setDefaultSourceConfig(fromWire(data.default_source_config));
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

type RenameChatVars = { conversationId: string; title: string };

export function useRenameChatMutation() {
  const queryClient = useQueryClient();
  return useMutation(
    ({ conversationId, title }: RenameChatVars) => renameSession(conversationId, title),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.chats]);
      },
    },
  );
}

export function useDeleteChatMutation() {
  const queryClient = useQueryClient();
  return useMutation(
    ({ conversationId }: { conversationId: string }) => deleteSession(conversationId),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.chats]);
      },
    },
  );
}

// ── Feedback (PRD story 22) ──────────────────────────────────────────────────

/** The narrowed payload — tag/text UI subtracted in B5c (reason chips are MVP3).
 *  An absent `feedback` clears the stored rating (re-tap toggles). */
type FeedbackPayload = {
  feedback?: { rating: 'thumbsUp' | 'thumbsDown' };
};

type FeedbackResponse = FeedbackPayload;

function toWireRating(payload: FeedbackPayload): WireRating {
  if (payload.feedback === undefined) {
    return null;
  }
  return payload.feedback.rating === 'thumbsUp' ? 'up' : 'down';
}

/**
 * POST .../messages/{id}/feedback — upsert (`up`/`down`) or clear (`null`).
 * Throws on a non-ok response so the optimistic thumb rolls back (honesty:
 * never claim a feedback write that the backend rejected). Resolves with the
 * same payload the caller sent, mapped back, so the UI can confirm state.
 */
export function useUpdateFeedbackMutation(conversationId: string, messageId: string) {
  return useMutation(async (payload: FeedbackPayload): Promise<FeedbackResponse> => {
    await setFeedback(conversationId, messageId, toWireRating(payload));
    return { feedback: payload.feedback };
  });
}
