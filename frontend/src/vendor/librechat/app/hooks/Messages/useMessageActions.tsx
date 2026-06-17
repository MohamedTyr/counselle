/**
 * Vendored from upstream client/src/hooks/Messages/useMessageActions.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions / rewires:
 * - agents/assistants endpoint resolution dropped (single fixed assistant)
 * - chatContext getter-object indirection dropped — our flat list re-renders
 *   only the live message during streaming (reducer blocks are reference-stable),
 *   so values come straight from our ChatContext
 * - copyToClipboard: their content-parts walker reduced to the message prose
 *   (`copy-to-clipboard`, same setIsCopied contract + 3s reset)
 * - handleContinue dropped (no continue in the MVP2 protocol)
 * - UsernameDisplay (recoil) frozen false → "You" for user messages
 * - feedback (B5c): the tag/text UI was subtracted (reason chips are MVP3), so
 *   the getTagByKey/toMinimalFeedback hydration is gone — `message.feedback` is
 *   just `{rating}` (ChatContext's transcript projection). The mutation posts to
 *   the real POST .../messages/{id}/feedback; a failure rolls back the thumb.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import copy from 'copy-to-clipboard';
import type { TFeedback } from 'librechat-data-provider';
import type { ChatMessage } from '@/app/ChatContext';
import { useChatContext } from '@/app/ChatContext';
import { useUpdateFeedbackMutation } from '@/api/hooks';
import { useLocalize } from '~/hooks';

export type TMessageActions = {
  message?: ChatMessage;
  currentEditId: string | number | null;
  setCurrentEditId: React.Dispatch<React.SetStateAction<string | number | null>>;
};

const COPY_RESET_MS = 3000;

export default function useMessageActions(props: TMessageActions) {
  const localize = useLocalize();
  const { message, currentEditId, setCurrentEditId } = props;
  const {
    ask,
    regenerate,
    latestMessageId,
    isSubmitting,
    conversationId,
  } = useChatContext();

  const { messageId = null } = message ?? {};
  const edit = useMemo(() => messageId === currentEditId, [messageId, currentEditId]);

  const [feedback, setFeedback] = useState<TFeedback | undefined>(() =>
    message?.feedback ? { rating: message.feedback.rating } : undefined,
  );

  // Re-sync the thumb to server truth when the projection's rating changes
  // (a transcript re-read / chats invalidation can replace this message with a
  // server-joined rating after mount; the instance survives the stable key, so
  // without this the local copy drifts and could show a rating the backend no
  // longer holds — FE-FEEDBACK-STALE). The optimistic write in handleFeedback
  // is unaffected: it sets local state synchronously, and a successful write
  // makes the next projection match, so this effect is value-equal (React bails)
  // then. Keyed on the SCALAR rating (not the object, which is fresh each
  // projection) so it fires only on a real change.
  useEffect(() => {
    setFeedback(message?.feedback ? { rating: message.feedback.rating } : undefined);
  }, [message?.feedback?.rating]);

  const enterEdit = useCallback(
    (cancel?: boolean) => setCurrentEditId && setCurrentEditId(cancel === true ? -1 : messageId),
    [messageId, setCurrentEditId],
  );

  const regenerateMessage = useCallback(() => {
    if ((isSubmitting && message?.isCreatedByUser === true) || !message) {
      return;
    }

    regenerate(message);
  }, [isSubmitting, message, regenerate]);

  const copyToClipboard = useCallback(
    (setIsCopied: React.Dispatch<React.SetStateAction<boolean>>) => {
      copy(message?.text ?? '', { format: 'text/plain' });
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), COPY_RESET_MS);
    },
    [message?.text],
  );

  const messageLabel = useMemo(() => {
    if (message?.isCreatedByUser === true) {
      return localize('com_user_message');
    }
    return message?.sender ?? 'Counselle';
  }, [message, localize]);

  const feedbackMutation = useUpdateFeedbackMutation(
    conversationId ?? '',
    message?.messageId ?? '',
  );

  const handleFeedback = useCallback(
    ({ feedback: newFeedback }: { feedback: TFeedback | undefined }) => {
      // Optimistic: paint the thumb now; roll back on a rejected write so we
      // never show a feedback state the backend didn't persist (honesty).
      const previous = feedback;
      const next = newFeedback ? { rating: newFeedback.rating } : undefined;
      setFeedback(next);
      feedbackMutation.mutate(
        { feedback: next },
        {
          onError: () => {
            setFeedback(previous);
          },
        },
      );
    },
    [feedback, feedbackMutation],
  );

  return {
    ask,
    edit,
    feedback,
    enterEdit,
    messageLabel,
    handleFeedback,
    copyToClipboard,
    latestMessageId,
    regenerateMessage,
  };
}
