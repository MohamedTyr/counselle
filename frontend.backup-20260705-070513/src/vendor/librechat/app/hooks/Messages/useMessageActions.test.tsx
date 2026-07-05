/**
 * FE-FEEDBACK-STALE — the feedback thumb re-syncs to server truth when the
 * projection's rating changes after mount (a transcript re-read can replace the
 * message with a server-joined rating while the hook instance survives the
 * stable key). The optimistic write path is exercised separately and must be
 * unaffected by the sync effect.
 */
import { describe, expect, test, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ChatMessage } from '@/app/ChatContext';

// The hook pulls ChatContext, the feedback mutation, and localize — none of
// which are under test here. Stub them so the hook can run in isolation and we
// can drive `message.feedback.rating` directly through rerenders.
const mutate = vi.fn();
vi.mock('@/app/ChatContext', () => ({
  useChatContext: () => ({
    ask: vi.fn(),
    regenerate: vi.fn(),
    latestMessageId: null,
    isSubmitting: false,
    conversationId: 'c1',
  }),
}));
vi.mock('@/api/hooks', () => ({
  useUpdateFeedbackMutation: () => ({ mutate }),
}));
vi.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

import useMessageActions from './useMessageActions';

function messageWith(rating: 'thumbsUp' | 'thumbsDown' | undefined): ChatMessage {
  return {
    messageId: 'm1',
    text: 'answer',
    isCreatedByUser: false,
    feedback: rating ? { rating } : undefined,
  } as unknown as ChatMessage;
}

describe('FE-FEEDBACK-STALE — server-truth re-sync', () => {
  test('feedback re-syncs when message.feedback.rating changes after mount', () => {
    const { result, rerender } = renderHook(
      ({ message }: { message: ChatMessage }) =>
        useMessageActions({ message, currentEditId: null, setCurrentEditId: vi.fn() }),
      { initialProps: { message: messageWith('thumbsUp') } },
    );

    expect(result.current.feedback).toEqual({ rating: 'thumbsUp' });

    // Server cleared the rating; a re-read replaces the projection.
    rerender({ message: messageWith(undefined) });
    expect(result.current.feedback).toBeUndefined();

    // Server now holds a thumbsDown.
    rerender({ message: messageWith('thumbsDown') });
    expect(result.current.feedback).toEqual({ rating: 'thumbsDown' });
  });

  test('the optimistic write still paints immediately and posts the mutation', () => {
    mutate.mockClear();
    const { result } = renderHook(() =>
      useMessageActions({
        message: messageWith(undefined),
        currentEditId: null,
        setCurrentEditId: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleFeedback({ feedback: { rating: 'thumbsUp' } });
    });

    expect(result.current.feedback).toEqual({ rating: 'thumbsUp' });
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
