/**
 * Vendored from upstream client/src/hooks/Input/useTextarea.ts (pinned 197a1dc4).
 *
 * Subtractions:
 * - All file-handling logic (useFileHandling, clipboardData.files) removed
 * - useGetSender, getEntity/isAgent/isAssistant, agentsMap/assistantMap removed;
 *   placeholder effect kept (debounced, upstream mechanics) with sender fixed to "Counselle"
 * - useInteractionHealthCheck removed (no-op; checkHealth() removed from handleKeyDown)
 * - activePrompt/setActivePrompt removed
 * - isNotAppendable always false (no latestMessage in MVP2 yet)
 *
 * Rewires:
 * - enterToSend: reads from jotai enterToSendAtom (default true)
 * - useChatContext: reads isSubmitting from our ChatContext
 *
 * Kept byte-identical: Enter/Shift-Enter/Ctrl-Enter logic, keyCode 229 IME guard,
 * handleCompositionStart/End, handlePaste (text only — no file paste).
 */
import { useCallback, useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import debounce from 'lodash/debounce';
import type { KeyboardEvent } from 'react';
import { insertTextAtCursor, forceResize, checkIfScrollable } from '~/utils';
import { useLocalize } from '~/hooks';
import { useChatContext } from '@/app/ChatContext';
import { enterToSendAtom } from '@/app/state';

type KeyEvent = KeyboardEvent<HTMLTextAreaElement>;

export default function useTextarea({
  textAreaRef,
  submitButtonRef,
  setIsScrollable,
  disabled = false,
  placeholder,
}: {
  textAreaRef: React.RefObject<HTMLTextAreaElement>;
  submitButtonRef: React.RefObject<HTMLButtonElement>;
  setIsScrollable: React.Dispatch<React.SetStateAction<boolean>>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const isComposing = useRef(false);
  const enterToSend = useAtomValue(enterToSendAtom);
  const { isSubmitting } = useChatContext();
  const localize = useLocalize();

  /** isNotAppendable — false until FE-3 wires the turn reducer */
  const isNotAppendable = false;

  // Placeholder — upstream's debounced setter; the sender is always Counselle.
  useEffect(() => {
    const getPlaceholderText = () => {
      if (isNotAppendable) {
        return localize('com_endpoint_message_not_appendable');
      }
      if (placeholder) {
        return placeholder;
      }
      return `${localize('com_endpoint_message_new', { 0: 'Counselle' })}`;
    };

    const placeholderText = getPlaceholderText();

    if (textAreaRef.current?.getAttribute('placeholder') === placeholderText) {
      return;
    }

    const setPlaceholder = () => {
      const text = getPlaceholderText();

      if (textAreaRef.current?.getAttribute('placeholder') !== text) {
        textAreaRef.current?.setAttribute('placeholder', text);
        forceResize(textAreaRef.current);
      }
    };

    const debouncedSetPlaceholder = debounce(setPlaceholder, 80);
    debouncedSetPlaceholder();

    return () => debouncedSetPlaceholder.cancel();
  }, [localize, placeholder, textAreaRef, isNotAppendable]);

  const handleKeyDown = useCallback(
    (e: KeyEvent) => {
      if (textAreaRef.current && checkIfScrollable(textAreaRef.current)) {
        const scrollable = checkIfScrollable(textAreaRef.current);
        scrollable && setIsScrollable(scrollable);
      }
      if (e.key === 'Enter' && isSubmitting) {
        return;
      }

      const isNonShiftEnter = e.key === 'Enter' && !e.shiftKey;
      const isCtrlEnter = e.key === 'Enter' && (e.ctrlKey || e.metaKey);

      // NOTE: isComposing and e.key behave differently in Safari; use e.keyCode instead
      const isComposingInput = isComposing.current || e.key === 'Process' || e.keyCode === 229;

      if (isNonShiftEnter) {
        e.preventDefault();
      }

      if (e.key === 'Enter' && !enterToSend && !isCtrlEnter && textAreaRef.current && !isComposingInput) {
        e.preventDefault();
        insertTextAtCursor(textAreaRef.current, '\n');
        forceResize(textAreaRef.current);
        return;
      }

      if ((isNonShiftEnter || isCtrlEnter) && !isComposingInput) {
        submitButtonRef.current?.click();
      }
    },
    [isSubmitting, enterToSend, setIsScrollable, textAreaRef, submitButtonRef],
  );

  const handleCompositionStart = () => {
    isComposing.current = true;
  };

  const handleCompositionEnd = () => {
    isComposing.current = false;
  };

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const textArea = textAreaRef.current;
      if (!textArea) {
        return;
      }
      const clipboardData = e.clipboardData as DataTransfer | undefined;
      if (!clipboardData) {
        return;
      }
      // File paste stripped (no attachment feature in MVP2)
    },
    [textAreaRef],
  );

  return {
    textAreaRef,
    handlePaste,
    handleKeyDown,
    isNotAppendable,
    handleCompositionEnd,
    handleCompositionStart,
  };
}
