/**
 * Vendored from upstream client/src/components/Chat/Messages/HoverButtons.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions:
 * - TextToSpeech / MessageAudio (audio dropped)
 * - Fork (branching dropped)
 * - Continue button (no continue in the MVP2 protocol)
 * - useGenerationsByLatest (endpoint capability logic) — replaced by the same
 *   derivations over our flat list: regenerate on assistant messages when not
 *   submitting; edit on user messages only (PRD decision 4: truncate-and-re-ask)
 * Kept byte-identical: HoverButton, the button order/classes, the error-state
 * regenerate-only row.
 */
import React, { useState, memo } from 'react';
import type { TFeedback } from 'librechat-data-provider';
import { EditIcon, Clipboard, CheckMark, RegenerateIcon } from '@librechat/client';
import type { ChatMessage } from '@/app/ChatContext';
import { useLocalize } from '~/hooks';
import Feedback from './Feedback';
import { cn } from '~/utils';

type THoverButtons = {
  isEditing: boolean;
  enterEdit: (cancel?: boolean) => void;
  copyToClipboard: (setIsCopied: React.Dispatch<React.SetStateAction<boolean>>) => void;
  isSubmitting: boolean;
  message: ChatMessage;
  regenerate: () => void;
  latestMessageId?: string;
  isLast: boolean;
  index: number;
  handleFeedback?: ({ feedback }: { feedback: TFeedback | undefined }) => void;
};

type HoverButtonProps = {
  id?: string;
  onClick: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  icon: React.ReactNode;
  isActive?: boolean;
  isVisible?: boolean;
  isDisabled?: boolean;
  isLast?: boolean;
  className?: string;
};

const HoverButton = memo(
  ({
    id,
    onClick,
    title,
    icon,
    isActive = false,
    isVisible = true,
    isDisabled = false,
    isLast = false,
    className = '',
  }: HoverButtonProps) => {
    const buttonStyle = cn(
      'hover-button rounded-lg p-1.5 text-text-secondary-alt',
      'hover:text-text-primary hover:bg-surface-hover',
      'md:group-hover:visible md:group-focus-within:visible md:group-[.final-completion]:visible',
      !isLast && 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
      !isVisible && 'opacity-0',
      'focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:outline-none',
      isActive && isVisible && 'active text-text-primary bg-surface-hover',
      className,
    );

    return (
      <button
        id={id}
        className={buttonStyle}
        onClick={onClick}
        type="button"
        title={title}
        disabled={isDisabled}
      >
        {icon}
      </button>
    );
  },
);

HoverButton.displayName = 'HoverButton';

const HoverButtons = ({
  isEditing,
  enterEdit,
  copyToClipboard,
  isSubmitting,
  message,
  regenerate,
  latestMessageId,
  isLast,
  handleFeedback,
}: THoverButtons) => {
  const localize = useLocalize();
  const [isCopied, setIsCopied] = useState(false);

  const { isCreatedByUser } = message;
  const error = message.error || message.streamError !== undefined;
  const isLatest = message.messageId === latestMessageId;

  /** Their useGenerationsByLatest, reduced to the flat-list equivalents. */
  const regenerateEnabled = !isCreatedByUser && !isSubmitting && isLatest;
  // Edit (G3, B5d): a real `replace_message_id` history rewrite needs a backend
  // user_message_id, so Edit is hidden on (a) pre-MVP2 / not-yet-reconciled
  // id-less entries and (b) `synthesized` clarify-answer bubbles (editing them
  // is meaningless; the backend returns 422).
  const isEditableEndpoint =
    isCreatedByUser && message.hasBackendId === true && message.synthesized !== true;
  const hideEditButton = isSubmitting || error;

  if (error) {
    return (
      <div className="visible flex justify-center self-end lg:justify-start">
        {regenerateEnabled && (
          <HoverButton
            onClick={regenerate}
            title={localize('com_ui_regenerate')}
            icon={<RegenerateIcon size="19" />}
            isLast={isLast}
          />
        )}
      </div>
    );
  }

  const onEdit = () => {
    if (isEditing) {
      return enterEdit(true);
    }
    enterEdit();
  };

  const handleCopy = () => copyToClipboard(setIsCopied);

  return (
    <div className="group visible flex justify-center gap-0.5 self-end focus-within:outline-none lg:justify-start">
      {/* Copy Button */}
      <HoverButton
        onClick={handleCopy}
        title={
          isCopied ? localize('com_ui_copied_to_clipboard') : localize('com_ui_copy_to_clipboard')
        }
        icon={isCopied ? <CheckMark className="h-[18px] w-[18px]" /> : <Clipboard size="19" />}
        isLast={isLast}
        className={cn(
          'ml-0 flex items-center gap-1.5 text-xs',
          isSubmitting && isCreatedByUser ? 'md:opacity-0 md:group-hover:opacity-100' : '',
        )}
      />

      {/* Edit Button */}
      {isEditableEndpoint && (
        <HoverButton
          id={`edit-${message.messageId}`}
          onClick={onEdit}
          title={localize('com_ui_edit')}
          icon={<EditIcon size="19" />}
          isActive={isEditing}
          isVisible={!hideEditButton}
          isDisabled={hideEditButton}
          isLast={isLast}
          className={isCreatedByUser ? '' : 'active'}
        />
      )}

      {/* Feedback Buttons */}
      {!isCreatedByUser && handleFeedback != null && (
        <Feedback
          handleFeedback={handleFeedback}
          feedback={message.feedback as TFeedback | undefined}
          isLast={isLast}
        />
      )}

      {/* Regenerate Button */}
      {regenerateEnabled && (
        <HoverButton
          onClick={regenerate}
          title={localize('com_ui_regenerate')}
          icon={<RegenerateIcon size="19" />}
          isLast={isLast}
          className="active"
        />
      )}
    </div>
  );
};

export default memo(HoverButtons);
