/**
 * Vendored from upstream client/src/components/Chat/Messages/ui/MessageRender.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions / rewires:
 * - SiblingSwitch / sibling props (branching dropped)
 * - hasParallelContent / agents / assistants / endpoint icon data dropped
 * - fontSize (jotai settings atom) frozen 'text-base' (upstream default;
 *   FE-5 settings wires it)
 * - maximizeChatSpace (recoil) frozen false — non-maximized width classes kept
 * - useContentMetadata dropped (no parallel content)
 * - the memo comparator keeps upstream's key-field shape, swapping their
 *   tree fields (depth/children/model/endpoint/iconURL/files) for our
 *   reducer fields (content reference, unfinished, activity, streamError)
 * Kept byte-identical: the row layout, icon column, header, MessageContext
 * wiring, PlaceholderRow-while-submitting, SubRow + HoverButtons.
 */
import React, { useCallback, memo } from 'react';
import type { TMessageProps } from '~/common';
import { cn, getHeaderPrefixForScreenReader, getMessageAriaLabel } from '~/utils';
import MessageContent from '~/components/Chat/Messages/Content/MessageContent';
import PlaceholderRow from '~/components/Chat/Messages/ui/PlaceholderRow';
import useMessageActions from '~/hooks/Messages/useMessageActions';
import HoverButtons from '~/components/Chat/Messages/HoverButtons';
import MessageIcon from '~/components/Chat/Messages/MessageIcon';
import SubRow from '~/components/Chat/Messages/SubRow';
import { useLocalize } from '~/hooks';
import { MessageContext } from '~/Providers';

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
    prevMsg.feedback?.rating === nextMsg.feedback?.rating
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
  /** fontSize settings atom frozen to upstream default until FE-5. */
  const fontSize = 'text-base';

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

  const getChatWidthClass = () => {
    return 'md:max-w-[47rem] xl:max-w-[55rem]';
  };

  const baseClasses = {
    common: 'group mx-auto flex flex-1 gap-3 transition-all duration-300 transform-gpu ',
    chat: getChatWidthClass(),
  };

  const conditionalClasses = {
    focus: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy',
  };

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
      <div className="relative flex flex-shrink-0 flex-col items-center">
        <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full">
          <MessageIcon
            iconData={{ isCreatedByUser: msg.isCreatedByUser, modelLabel: messageLabel }}
          />
        </div>
      </div>

      <div
        className={cn(
          'relative flex flex-col',
          'w-11/12',
          msg.isCreatedByUser ? 'user-turn' : 'agent-turn',
        )}
      >
        <h2 className={cn('select-none font-semibold', fontSize)}>
          <span className="sr-only">{getHeaderPrefixForScreenReader(msg, localize)}</span>
          {messageLabel}
        </h2>

        <div className="flex flex-col gap-1">
          <div className="flex min-h-[20px] max-w-full flex-grow flex-col gap-0">
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
          </div>
          {isLatestMessage && isSubmitting ? (
            <PlaceholderRow />
          ) : (
            <SubRow classes="text-xs">
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
            </SubRow>
          )}
        </div>
      </div>
    </div>
  );
}, areMessageRenderPropsEqual);
MessageRender.displayName = 'MessageRender';

export default MessageRender;
