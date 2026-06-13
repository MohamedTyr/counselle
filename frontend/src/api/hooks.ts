/**
 * TanStack Query v4 hooks over the mock store.
 * Call signatures are close to what the vendored conversation components expect.
 * FE-7 swaps the implementation (same QueryKeys, same shape) when HttpTransport lands.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as store from './mock/store';
import type { ChatRecord } from './types';

export const QueryKeys = {
  chats: 'chats' as const,
  me: 'me' as const,
};

// ── Queries ──────────────────────────────────────────────────────────────────

export function useChatsQuery() {
  return useQuery([QueryKeys.chats], () => store.listChats(), {
    staleTime: 30_000,
    cacheTime: 300_000,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

type RenameChatVars = { conversationId: string; title: string };

export function useRenameChatMutation() {
  const queryClient = useQueryClient();
  return useMutation(
    ({ conversationId, title }: RenameChatVars) => {
      const updated = store.renameChat(conversationId, title);
      return Promise.resolve(updated);
    },
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
    ({ conversationId }: { conversationId: string }) => {
      store.deleteChat(conversationId);
      return Promise.resolve();
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.chats]);
      },
    },
  );
}

export function useCreateChatMutation() {
  const queryClient = useQueryClient();
  return useMutation(
    ({ title }: { title: string }) => {
      const chat = store.createChat(title);
      return Promise.resolve(chat);
    },
    {
      onSuccess: (chat: ChatRecord) => {
        queryClient.invalidateQueries([QueryKeys.chats]);
        return chat;
      },
    },
  );
}

// ── Feedback (PRD story 22) ──────────────────────────────────────────────────

import { setFeedback, type StoredFeedback } from './mock/feedbackStore';

type FeedbackPayload = {
  feedback?: { rating: 'thumbsUp' | 'thumbsDown'; tag: string; text?: string };
};

type FeedbackResponse = {
  feedback?: { rating: 'thumbsUp' | 'thumbsDown'; tag?: string | null; text?: string };
};

/**
 * Mirrors upstream's data-provider hook of the same name, over the mock
 * feedback store (FE-7 swaps in POST .../messages/{id}/feedback). Upsert;
 * an absent `feedback` clears the stored rating (re-tap toggles).
 */
export function useUpdateFeedbackMutation(conversationId: string, messageId: string) {
  return useMutation((payload: FeedbackPayload): Promise<FeedbackResponse> => {
    const stored: StoredFeedback | undefined =
      payload.feedback !== undefined
        ? {
            rating: payload.feedback.rating,
            tag: payload.feedback.tag,
            text: payload.feedback.text,
          }
        : undefined;
    setFeedback(conversationId, messageId, stored);
    return Promise.resolve({ feedback: payload.feedback });
  });
}
