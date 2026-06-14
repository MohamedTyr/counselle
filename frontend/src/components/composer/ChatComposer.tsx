/**
 * ChatComposer — the integration container that wires the (controlled,
 * app-agnostic) `CounselleComposer` to the real app: the chat turn loop
 * (`useChatContext`), the react-hook-form `text` field (`useChatFormContext`),
 * the per-conversation source store, and the enter-to-send preference.
 *
 * It is the new owner of the submit / autosave / autofocus logic that used to
 * live in the vendored `ChatForm`. Mounted by `ChatView` in place of
 * `<ChatForm>`, INSIDE the kept `ChatFormProvider` (autosave + the controlled
 * text bridge both depend on the form). Nothing user-visible changes here vs
 * the old composer except the composer chrome itself.
 *
 * Serves: the chat page composer (landing + in-conversation).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useAtomValue } from 'jotai';
import { cn } from '@librechat/client/utils';
import { useChatFormContext } from '~/Providers';
import { useAutoSave } from '~/hooks/Input/useAutoSave';
import { useChatContext } from '@/app/ChatContext';
import { enterToSendAtom } from '@/app/state';
import {
  getSourceConfig,
  updateSourceConfig,
  type SourceConfig,
} from '@/api/mock/sourceStore';
import { CounselleComposer, type SourceId } from '@/components/composer';

/**
 * The placeholder strings the app shows today (matched verbatim from
 * `useTextarea`): the default `com_endpoint_message_new` rendered for the
 * "Counselle" sender, and the awaiting-clarify prompt.
 */
const DEFAULT_PLACEHOLDER = 'Message Counselle';
const CLARIFY_PLACEHOLDER = 'Pick one, or just type…';

/**
 * `centerFormOnLanding` is frozen `true` upstream; ChatView passes it down so
 * the landing margin matches the vendored `ChatForm` layout exactly.
 */
const MAXIMIZE_CHAT_SPACE = false;

interface ChatComposerProps {
  centerFormOnLanding?: boolean;
}

/** Map the FE-store `SourceConfig` to the composer's controlled active set.
 *  Exported for unit testing the source bridge (behaviors 13, 16). */
export function toActiveSet(config: SourceConfig): Set<SourceId> {
  return new Set<SourceId>([
    ...(config.webSearch ? (['web'] as const) : []),
    ...(config.eduSources ? (['edu'] as const) : []),
    ...(config.reddit ? (['reddit'] as const) : []),
  ]);
}

export default function ChatComposer({ centerFormOnLanding = false }: ChatComposerProps) {
  const { conversationId, isSubmitting, submitMessage, stopGenerating, awaitingClarify } =
    useChatContext();

  // RHF is the single source of truth for the composer text (kept from ChatForm).
  const methods = useChatFormContext();
  const text = useWatch({ control: methods.control, name: 'text' });

  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // Draft autosave — ported verbatim from ChatForm: save the old conversation's
  // draft and restore the new one on conversation switch.
  useAutoSave({
    isSubmitting,
    conversationId,
    textAreaRef,
    setValue: methods.setValue,
  });

  // Autofocus on mount and on conversation switch (parity with ChatForm L125).
  useEffect(() => {
    textAreaRef.current?.focus();
  }, [conversationId]);

  // Submit: clear the field synchronously BEFORE the await, restore the text
  // only if the send was rejected before stream start (copied from
  // ChatForm.onSubmit — a failed send must not lose what the student typed).
  const onSend = useCallback(async () => {
    const trimmed = (text ?? '').trim();
    if (!trimmed || isSubmitting) {
      return;
    }
    methods.reset({ text: '' });
    const accepted = await submitMessage(trimmed);
    if (!accepted) {
      methods.reset({ text: trimmed });
    }
  }, [text, isSubmitting, methods, submitMessage]);

  // Source state: read the conversation's config from the store, re-read on
  // conversation switch and again when the dropdown opens (ported from
  // SourceDropdown's two effects — the popover-open re-read picks up the
  // server-seeded config ChatContext writes on chat open).
  const [config, setConfig] = useState<SourceConfig>(() => getSourceConfig(conversationId));

  useEffect(() => {
    setConfig(getSourceConfig(conversationId));
  }, [conversationId]);

  const handleSourcesChange = useCallback(
    (patch: Partial<SourceConfig>) => {
      setConfig(updateSourceConfig(conversationId, patch));
    },
    [conversationId],
  );

  const handleSourcesReread = useCallback(() => {
    setConfig(getSourceConfig(conversationId));
  }, [conversationId]);

  const enterToSend = useAtomValue(enterToSendAtom);
  const placeholder = awaitingClarify ? CLARIFY_PLACEHOLDER : DEFAULT_PLACEHOLDER;

  const active = useMemo(() => toActiveSet(config), [config]);

  // Outer wrapper markup/classes copied from ChatForm's <form> so the composer
  // sits in the exact same place (the new composer renders its own surface, so
  // this is a plain positioning <div> instead of a <form>).
  const isNewConvo = conversationId == null;

  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-row gap-3 transition-[max-width] duration-300 sm:px-2',
        MAXIMIZE_CHAT_SPACE ? 'max-w-full' : 'md:max-w-3xl xl:max-w-4xl',
        centerFormOnLanding && isNewConvo && !isSubmitting
          ? 'transition-all duration-200 sm:mb-28'
          : 'sm:mb-10',
      )}
    >
      <CounselleComposer
        ref={textAreaRef}
        value={text ?? ''}
        onValueChange={(v) => methods.setValue('text', v)}
        isLoading={isSubmitting}
        enterToSend={enterToSend}
        placeholder={placeholder}
        active={active}
        subs={config.selectedSubreddits}
        onSourcesChange={handleSourcesChange}
        onSourcesReread={handleSourcesReread}
        onSend={onSend}
        onStop={stopGenerating}
      />
    </div>
  );
}

export type { ChatComposerProps };
