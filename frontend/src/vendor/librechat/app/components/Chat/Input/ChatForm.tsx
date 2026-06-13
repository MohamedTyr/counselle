/**
 * Vendored from upstream client/src/components/Chat/Input/ChatForm.tsx (pinned 197a1dc4).
 *
 * Subtractions (recorded in UPSTREAM.md FE-2):
 * - Files/AttachFileChat, FileFormChat — no attachment feature
 * - TextareaHeader (multi-convo add-convo)
 * - PendingManualSkillsChips, BadgeRow, EditBadges
 * - AudioRecorder / StreamAudio / SpeechToText / TextToSpeech
 * - Mention, PromptsCommand, SkillsCommand — command popovers
 * - endpoint guard around textarea (always renders — no endpoint concept)
 * - requiresKey / invalidAssistant / disableInputs (no key gate)
 * - modelSpec/hideBadgeRow, conversation?.spec, isAgentsEndpoint checks
 * - maximizeChatSpace → frozen false (constant)
 * - centerFormOnLanding → passed as prop from Landing layer
 * - isTemporary → frozen false
 * - isRTL → frozen false
 * - chatDirection, automaticPlayback — removed
 * - chatBadges, isEditingBadges — removed
 * - useQueryParams — removed
 * - conversation?.messages?.length check → uses isSubmitting flag
 * - useAddedChatContext / useAssistantsMapContext / useAgentsMapContext — removed
 * - useGetStartupConfig — removed
 *
 * Rewires:
 * - useChatContext → our ChatContext (conversationId, isSubmitting, submitMessage, stopGenerating, newConversation)
 * - showStopButton → derived directly from isSubmitting
 * - enterToSend → jotai atom
 * - react-hook-form methods via ChatFormProvider (upstream pattern; form owned by ChatView)
 * - useAutoSave: wired to our version (text-only)
 *
 * Counselle addition: SourceDropdown button slot in bottom-left (where AttachFileChat was).
 *
 * JSX structural classes byte-identical to upstream (outer form, inner container, textarea wrapper,
 * bottom row). Only the stripped children are absent.
 */
import { memo, useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useWatch } from 'react-hook-form';
import { TextareaAutosize } from '@librechat/client';
import { useChatFormContext } from '~/Providers';
import { cn } from '~/utils';
import { removeFocusRings } from '~/utils';
import { useAutoSave } from '~/hooks/Input/useAutoSave';
import useFocusChatEffect from '~/hooks/Chat/useFocusChatEffect';
import useTextarea from '~/hooks/Input/useTextarea';
import useHandleKeyUp from '~/hooks/Input/useHandleKeyUp';
import { useLocalize } from '~/hooks';
import CollapseChat from './CollapseChat';
import StopButton from './StopButton';
import SendButton from './SendButton';
import { useChatContext } from '@/app/ChatContext';
import SourceDropdown from '@/components/source-control/SourceDropdown';

/** The textarea element id — must match upstream so focus helpers work. */
const mainTextareaId = 'prompt-textarea';

/**
 * maximizeChatSpace frozen false — no UI toggle in MVP2.
 * centerFormOnLanding decides the vertical margin on the landing screen.
 */
const MAXIMIZE_CHAT_SPACE = false;

interface ChatFormProps {
  placeholder?: string;
  centerFormOnLanding?: boolean;
}

const ChatForm = memo(function ChatForm({ placeholder, centerFormOnLanding = false }: ChatFormProps) {
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  useFocusChatEffect(textAreaRef);
  const localize = useLocalize();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [, setIsScrollable] = useState(false);
  const [visualRowCount, setVisualRowCount] = useState(1);
  const [isTextAreaFocused, setIsTextAreaFocused] = useState(false);
  const { conversationId, isSubmitting, submitMessage, stopGenerating } = useChatContext();

  // ── react-hook-form — provided by ChatFormProvider in ChatView (upstream
  // pattern: ConversationStarters/Landing share the same form context) ───────
  const methods = useChatFormContext();

  // ── Draft autosave ────────────────────────────────────────────────────────
  useAutoSave({
    isSubmitting,
    conversationId,
    textAreaRef,
    setValue: methods.setValue,
  });

  // ── Keyboard / textarea behaviour ─────────────────────────────────────────
  const handleKeyUp = useHandleKeyUp({ index: 0, textAreaRef });
  const {
    isNotAppendable,
    handlePaste,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
  } = useTextarea({
    textAreaRef,
    submitButtonRef,
    setIsScrollable,
    disabled: false,
    placeholder,
  });

  // ── Visual row count for CollapseChat ─────────────────────────────────────
  const textValue = useWatch({ control: methods.control, name: 'text' });

  useEffect(() => {
    if (textAreaRef.current) {
      const style = window.getComputedStyle(textAreaRef.current);
      const lineHeight = parseFloat(style.lineHeight);
      setVisualRowCount(Math.floor(textAreaRef.current.scrollHeight / lineHeight));
    }
  }, [textValue]);

  const isMoreThanThreeRows = visualRowCount > 3;

  // ── Container click focuses textarea ──────────────────────────────────────
  const handleContainerClick = useCallback(() => {
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      return;
    }
    textAreaRef.current?.focus();
  }, []);

  const handleFocusOrClick = useCallback(() => {
    if (isCollapsed) {
      setIsCollapsed(false);
    }
  }, [isCollapsed]);

  const handleTextareaFocus = useCallback(() => {
    handleFocusOrClick();
    setIsTextAreaFocused(true);
  }, [handleFocusOrClick]);

  const handleTextareaBlur = useCallback(() => {
    setIsTextAreaFocused(false);
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  // B5a: clear the composer optimistically, but RESTORE the text if the send
  // failed before stream start (submitMessage resolves false). A failed send
  // must not lose what the student typed — inline retry re-sends it.
  const onSubmit = useCallback(
    async (data: { text: string }) => {
      const text = data.text.trim();
      if (!text || isSubmitting) {
        return;
      }
      methods.reset({ text: '' });
      const accepted = await submitMessage(text);
      if (!accepted) {
        methods.reset({ text });
      }
    },
    [isSubmitting, methods, submitMessage],
  );

  const handleStopGenerating = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      stopGenerating();
    },
    [stopGenerating],
  );

  // ── Styles ────────────────────────────────────────────────────────────────
  const baseClasses = useMemo(
    () =>
      cn(
        'md:py-3.5 m-0 w-full resize-none py-[13px] placeholder-black/60 bg-transparent dark:placeholder-white/60 [&:has(textarea:focus)]:shadow-[0_2px_6px_rgba(0,0,0,.05)]',
        isCollapsed ? 'max-h-[52px]' : 'max-h-[45vh] md:max-h-[55vh]',
        isMoreThanThreeRows ? 'pl-5' : 'px-5',
      ),
    [isCollapsed, isMoreThanThreeRows],
  );

  const isNewConvo = conversationId == null;

  return (
    <form
      onSubmit={methods.handleSubmit(onSubmit)}
      className={cn(
        'mx-auto flex w-full flex-row gap-3 transition-[max-width] duration-300 sm:px-2',
        MAXIMIZE_CHAT_SPACE ? 'max-w-full' : 'md:max-w-3xl xl:max-w-4xl',
        centerFormOnLanding && isNewConvo && !isSubmitting
          ? 'transition-all duration-200 sm:mb-28'
          : 'sm:mb-10',
      )}
    >
      <div className="relative flex h-full flex-1 items-stretch md:flex-col">
        <div className="flex w-full items-center">
          <div
            onClick={handleContainerClick}
            className={cn(
              'relative flex w-full flex-grow flex-col overflow-hidden rounded-t-3xl border pb-4 text-text-primary transition-all duration-200 sm:rounded-3xl sm:pb-0',
              isTextAreaFocused ? 'shadow-lg' : 'shadow-md',
              'border-border-light bg-surface-chat',
            )}
          >
            {/* Textarea + collapse */}
            <div className="flex flex-row">
              <div
                className="relative flex-1"
                style={
                  isCollapsed
                    ? {
                        WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 90%)',
                        maskImage: 'linear-gradient(to bottom, black 60%, transparent 90%)',
                      }
                    : undefined
                }
              >
                <TextareaAutosize
                  {...methods.register('text', {
                    required: true,
                    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      methods.setValue('text', e.target.value, { shouldValidate: true }),
                  })}
                  ref={(e) => {
                    methods.register('text').ref(e);
                    (textAreaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = e;
                  }}
                  disabled={isNotAppendable}
                  onPaste={handlePaste}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyUp}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  id={mainTextareaId}
                  tabIndex={0}
                  data-testid="text-input"
                  rows={1}
                  onFocus={handleTextareaFocus}
                  onBlur={handleTextareaBlur}
                  aria-label={localize('com_ui_message_input')}
                  onClick={handleFocusOrClick}
                  style={{ height: 44, overflowY: 'auto' }}
                  className={cn(
                    baseClasses,
                    removeFocusRings,
                    'scrollbar-hover transition-[max-height] duration-200 disabled:cursor-not-allowed',
                  )}
                />
              </div>
              <div className="flex flex-col items-start justify-start pr-2.5 pt-1.5">
                <CollapseChat
                  isCollapsed={isCollapsed}
                  isScrollable={isMoreThanThreeRows}
                  setIsCollapsed={setIsCollapsed}
                />
              </div>
            </div>

            {/* Bottom action row */}
            <div className="@container items-between flex gap-2 pb-2">
              {/* Source dropdown — Counselle addition (left slot, where AttachFileChat was) */}
              <div className="ml-2">
                <SourceDropdown conversationId={conversationId} />
              </div>

              {/* Spacer */}
              <div className="mx-auto flex" />

              {/* Send / Stop */}
              <div className="mr-2">
                {isSubmitting ? (
                  <StopButton
                    stop={handleStopGenerating}
                    setShowStopButton={(v) => { if (!v) stopGenerating(); }}
                  />
                ) : (
                  <SendButton
                    ref={submitButtonRef}
                    control={methods.control}
                    disabled={isSubmitting || isNotAppendable}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
});

ChatForm.displayName = 'ChatForm';

export default ChatForm;
export type { ChatFormProps };
