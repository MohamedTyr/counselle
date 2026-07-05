/**
 * Vendored from upstream client/src/components/Chat/Messages/Message.tsx +
 * hooks/Messages/useMessageProcess.tsx (pinned 197a1dc4).
 *
 * Subtractions / rewires:
 * - MultiMessage recursion over `message.children` dropped (flat list, no
 *   branching) — the parent maps the list and renders one Message per entry
 * - useMemoizedChatContext getter-object dropped (see useMessageActions note)
 * - effectiveIsSubmitting: upstream computes it in the wrapper so the memo'd
 *   MessageRender only re-renders when it matters — same here: real value for
 *   the latest message, false otherwise
 * Kept byte-identical: MessageContainer classes + onWheel/onTouchMove abort
 * hookup, the inner padding wrapper, the throttled abort-scroll handler.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import throttle from 'lodash/throttle';
import type { TMessageProps } from '~/common';
import { useChatContext } from '@/app/ChatContext';
import MessageRender from './ui/MessageRender';

const ABORT_SCROLL_THROTTLE_MS = 500;

const MessageContainer = React.memo(function MessageContainer({
  handleScroll,
  children,
}: {
  handleScroll: (event?: unknown) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="text-token-text-primary w-full border-0 bg-transparent dark:border-0 dark:bg-transparent"
      onWheel={handleScroll}
      onTouchMove={handleScroll}
    >
      {children}
    </div>
  );
});

export default function Message(props: TMessageProps) {
  const { isSubmitting, setAbortScroll, latestMessageId } = useChatContext();
  const { message } = props;

  /** Ref keeps handleScroll stable across isSubmitting changes (upstream). */
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;

  const handleScroll = useMemo(
    () =>
      throttle(() => {
        setAbortScroll(isSubmittingRef.current);
      }, ABORT_SCROLL_THROTTLE_MS),
    [setAbortScroll],
  );

  useEffect(() => () => handleScroll.cancel(), [handleScroll]);

  if (!message || typeof message !== 'object') {
    return null;
  }

  const isLatest = message.messageId === latestMessageId;
  const effectiveIsSubmitting = isLatest ? isSubmitting : false;

  return (
    <MessageContainer handleScroll={handleScroll}>
      <div className="m-auto justify-center p-4 py-2 md:gap-6">
        <MessageRender {...props} isSubmitting={effectiveIsSubmitting} isLatestMessage={isLatest} />
      </div>
    </MessageContainer>
  );
}
