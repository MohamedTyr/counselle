/**
 * Vendored from upstream client/src/components/Chat/Messages/ui/MessageRender.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions / rewires:
 * - SiblingSwitch / sibling props (branching dropped)
 * - hasParallelContent / agents / assistants / endpoint icon data dropped
 * - maximizeChatSpace (recoil) frozen false — non-maximized width classes kept
 * - useContentMetadata dropped (no parallel content)
 * - the memo comparator keeps upstream's key-field shape, swapping their
 *   tree fields (depth/children/model/endpoint/iconURL/files) for our
 *   reducer fields (content reference, unfinished, activity, streamError)
 * - layout reworked off upstream's avatar+name row: USER turns render a
 *   right-aligned surface bubble (AI Elements `Message` pattern); ASSISTANT
 *   turns render full-width with no avatar/name chrome (the reasoning trace +
 *   content carry identity). The avatar (MessageIcon), the <h2> name header,
 *   and the frozen fontSize atom are gone.
 * Kept: MessageContext wiring, PlaceholderRow-while-submitting (assistant
 *   only), SubRow + HoverButtons, sr-only screen-reader labels.
 */
import React, { useCallback, memo } from 'react';
import type { TMessageProps } from '~/common';
import { cn, getHeaderPrefixForScreenReader, getMessageAriaLabel } from '~/utils';
import MessageContent from '~/components/Chat/Messages/Content/MessageContent';
import PlaceholderRow from '~/components/Chat/Messages/ui/PlaceholderRow';
import useMessageActions from '~/hooks/Messages/useMessageActions';
import HoverButtons from '~/components/Chat/Messages/HoverButtons';
import SubRow from '~/components/Chat/Messages/SubRow';
import { useLocalize } from '~/hooks';
import { MessageContext } from '~/Providers';
import MessageSources from '@/components/citations/MessageSources';

type MessageRenderProps = {
  /**
   * Effective isSubmitting: false for non-latest messages, real value for latest.
   * Computed by the wrapper (Message.tsx) so this memo'd component only re-renders
   * when the value actually matters.
   */
  isSubmitting?: boolean;
  isLatestMessage?: boolean;
} & Pick<TMessageProps, 'message' | 'currentEditId' | 'setCurrentEditId'>;

/**
 * Custom comparator for React.memo: compares `message` by key fields instead of
 * reference. The turn reducer keeps completed content blocks reference-stable,
 * so `content` inequality means real change.
 */
function areMessageRenderPropsEqual(prev: MessageRenderProps, next: MessageRenderProps): boolean {
  if (prev.isSubmitting !== next.isSubmitting) {
    return false;
  }
  if (prev.isLatestMessage !== next.isLatestMessage) {
    return false;
  }
  if (prev.currentEditId !== next.currentEditId) {
    return false;
  }
  if (prev.setCurrentEditId !== next.setCurrentEditId) {
    return false;
  }

  const prevMsg = prev.message;
  const nextMsg = next.message;
  if (prevMsg === nextMsg) {
    return true;
  }
  if (!prevMsg || !nextMsg) {
    return prevMsg === nextMsg;
  }

  return (
    prevMsg.messageId === nextMsg.messageId &&
    prevMsg.text === nextMsg.text &&
    prevMsg.error === nextMsg.error &&
    prevMsg.unfinished === nextMsg.unfinished &&
    prevMsg.isCreatedByUser === nextMsg.isCreatedByUser &&
    prevMsg.content === nextMsg.content &&
    // `activities` is a fresh array each render; compare contents (it's tiny and
    // append-mostly) so a new/changed step label still re-renders the trace.
    prevMsg.activities?.join('\x00') === nextMsg.activities?.join('\x00') &&
    prevMsg.streamError === nextMsg.streamError &&
    prevMsg.feedback?.rating === nextMsg.feedback?.rating &&
    // The sources strip lives in the action row; re-render when the turn's
    // sources arrive (the reducer hands us a fresh array on the `sources` event).
    prevMsg.sources === nextMsg.sources
  );
}

const MessageRender = memo(function MessageRender({
  message: msg,
  currentEditId,
  setCurrentEditId,
  isSubmitting = false,
  isLatestMessage = false,
}: MessageRenderProps) {
  const localize = useLocalize();
  const {
    ask,
    edit,
    enterEdit,
    messageLabel,
    handleFeedback,
    copyToClipboard,
    latestMessageId,
    regenerateMessage,
  } = useMessageActions({
    message: msg,
    currentEditId,
    setCurrentEditId,
  });

  const handleRegenerateMessage = useCallback(() => regenerateMessage(), [regenerateMessage]);
  const isLast = isLatestMessage;

  const messageId = msg?.messageId ?? '';
  const messageContextValue = React.useMemo(
    () => ({
      messageId,
      isLatestMessage,
      isExpanded: false as const,
      isSubmitting,
      conversationId: msg?.conversationId,
    }),
    [messageId, msg?.conversationId, isSubmitting, isLatestMessage],
  );

  if (!msg) {
    return null;
  }

  const baseClasses = {
    common: 'group mx-auto flex flex-1 transition-all duration-300 transform-gpu ',
    chat: 'md:max-w-[47rem] xl:max-w-[55rem]',
  };

  const conditionalClasses = {
    focus: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy',
  };

  const isUser = msg.isCreatedByUser === true;

  const messageBody = (
    <MessageContext.Provider value={messageContextValue}>
      <MessageContent
        ask={ask}
        edit={edit}
        isLast={isLast}
        text={msg.text || ''}
        message={msg}
        enterEdit={enterEdit}
        error={!!msg.error}
        isSubmitting={isSubmitting}
        unfinished={msg.unfinished ?? false}
        isCreatedByUser={msg.isCreatedByUser ?? true}
      />
    </MessageContext.Provider>
  );

  const hoverButtons = (
    <HoverButtons
      index={0}
      isEditing={edit}
      message={msg}
      enterEdit={enterEdit}
      isSubmitting={isSubmitting}
      regenerate={handleRegenerateMessage}
      copyToClipboard={copyToClipboard}
      latestMessageId={latestMessageId}
      handleFeedback={handleFeedback}
      isLast={isLast}
    />
  );

  // User turn — a right-aligned surface bubble (AI Elements `Message` pattern):
  // no avatar/name chrome, alignment + surface carry "this is you". The bubble
  // is `w-fit` so it hugs short messages and only wraps at the max-width cap.
  if (isUser) {
    return (
      <div
        id={msg.messageId}
        aria-label={getMessageAriaLabel(msg, localize)}
        className={cn(
          baseClasses.common,
          baseClasses.chat,
          conditionalClasses.focus,
          'message-render justify-end',
        )}
      >
        <div className="user-turn flex min-w-0 max-w-[85%] flex-col items-end">
          <span className="sr-only">
            {getHeaderPrefixForScreenReader(msg, localize)} {messageLabel}
          </span>
          {edit ? (
            <div className="w-full">{messageBody}</div>
          ) : (
            <div className="w-fit max-w-full rounded-2xl bg-surface-tertiary px-4 py-2.5 text-text-primary">
              {messageBody}
            </div>
          )}
          {/* User turns never stream, so no PlaceholderRow here — just the
              hover actions, right-aligned under the bubble. */}
          <div className="mt-1 flex justify-end gap-3 text-xs empty:hidden">{hoverButtons}</div>
        </div>
      </div>
    );
  }

  // Assistant turn — full-width prose, no avatar/name chrome. The reasoning
  // trace, cited cards, clarify widget, and sources footer (all inside
  // MessageContent) are the agent's identity here, not a label.
  return (
    <div
      id={msg.messageId}
      aria-label={getMessageAriaLabel(msg, localize)}
      className={cn(
        baseClasses.common,
        baseClasses.chat,
        conditionalClasses.focus,
        'message-render',
      )}
    >
      <div className="agent-turn relative flex w-full flex-col">
        <span className="sr-only">
          {getHeaderPrefixForScreenReader(msg, localize)} {messageLabel}
        </span>
        <div className="flex flex-col gap-1">
          <div className="flex min-h-[20px] max-w-full flex-grow flex-col gap-0">{messageBody}</div>
          {isLatestMessage && isSubmitting ? (
            <PlaceholderRow />
          ) : (
            // The action row: hover actions + the sources strip, vertically
            // centered. MessageSources self-hides when the turn cited none.
            <SubRow classes="text-xs items-center">
              {hoverButtons}
              <MessageSources message={msg} />
            </SubRow>
          )}
        </div>
      </div>
    </div>
  );
}, areMessageRenderPropsEqual);
MessageRender.displayName = 'MessageRender';

export default MessageRender;
