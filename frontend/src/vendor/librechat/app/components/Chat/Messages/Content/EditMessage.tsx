/**
 * Vendored from upstream client/src/components/Chat/Messages/Content/EditMessage.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions / rewires:
 * - Only user messages are editable (PRD decision 4: truncate-and-re-ask), so
 *   the assistant-edit branch (replay parent with editedText) is dropped
 * - "Save & Submit" → our ChatContext.ask({ text, messageId }) — truncates the
 *   transcript from this message and re-asks
 * - "Save" → our ChatContext.updateMessageText (edit-in-place, no re-ask)
 * - sibling index bookkeeping dropped (no branching)
 * - chatDirection (RTL) frozen ltr; file/skill overrides dropped
 * Kept byte-identical: textarea + container classes, the three buttons and
 * their shortcuts (Ctrl/⌘+Enter submit, Ctrl/⌘+S save, Esc cancel).
 */
import { useRef, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { TextareaAutosize, TooltipAnchor } from '@librechat/client';
import type { TEditProps } from '~/common';
import { useChatContext } from '@/app/ChatContext';
import { cn, removeFocusRings } from '~/utils';
import { useLocalize } from '~/hooks';
import Container from './Container';

const EditMessage = ({ text, message, isSubmitting, ask, enterEdit }: TEditProps) => {
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const { updateMessageText } = useChatContext();

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const { messageId } = message;
  const localize = useLocalize();

  const { register, handleSubmit, setValue } = useForm({
    defaultValues: {
      text: text ?? '',
    },
  });

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (textArea) {
      const length = textArea.value.length;
      textArea.focus();
      textArea.setSelectionRange(length, length);
    }
  }, []);

  const resubmitMessage = (data: { text: string }) => {
    ask({
      text: data.text,
      messageId,
    });

    enterEdit(true);
  };

  const updateMessage = (data: { text: string }) => {
    updateMessageText(messageId, data.text);
    enterEdit(true);
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitButtonRef.current?.click();
      }
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveButtonRef.current?.click();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        enterEdit(true);
      }
    },
    [enterEdit],
  );

  const { ref, ...registerProps } = register('text', {
    required: true,
    onChange: (e) => {
      setValue('text', e.target.value, { shouldValidate: true });
    },
  });

  return (
    <Container message={message}>
      <div className="bg-token-main-surface-primary relative mt-2 flex w-full flex-grow flex-col overflow-hidden rounded-2xl border border-border-medium text-text-primary [&:has(textarea:focus)]:border-border-heavy [&:has(textarea:focus)]:shadow-[0_2px_6px_rgba(0,0,0,.05)]">
        <TextareaAutosize
          {...registerProps}
          ref={(e) => {
            ref(e);
            textAreaRef.current = e;
          }}
          onKeyDown={handleKeyDown}
          data-testid="message-text-editor"
          className={cn(
            'markdown prose dark:prose-invert light whitespace-pre-wrap break-words pl-3 md:pl-4',
            'm-0 w-full resize-none border-0 bg-transparent py-[10px]',
            'placeholder-text-secondary focus:ring-0 focus-visible:ring-0 md:py-3.5',
            'text-left',
            'max-h-[65vh] pr-3 md:max-h-[75vh] md:pr-4',
            removeFocusRings,
          )}
          aria-label={localize('com_ui_message_input')}
          dir="ltr"
        />
      </div>
      <div className="mt-2 flex w-full justify-center text-center">
        <TooltipAnchor
          description="Ctrl + Enter / ⌘ + Enter"
          render={
            <button
              ref={submitButtonRef}
              className="btn btn-primary relative mr-2"
              disabled={isSubmitting}
              onClick={handleSubmit(resubmitMessage)}
            >
              {localize('com_ui_save_submit')}
            </button>
          }
        />
        <TooltipAnchor
          description="Ctrl + S / ⌘ + S"
          render={
            <button
              ref={saveButtonRef}
              className="btn btn-secondary relative mr-2"
              disabled={isSubmitting}
              onClick={handleSubmit(updateMessage)}
            >
              {localize('com_ui_save')}
            </button>
          }
        />
        <TooltipAnchor
          description="Esc"
          render={
            <button className="btn btn-neutral relative" onClick={() => enterEdit(true)}>
              {localize('com_ui_cancel')}
            </button>
          }
        />
      </div>
    </Container>
  );
};

export default EditMessage;
