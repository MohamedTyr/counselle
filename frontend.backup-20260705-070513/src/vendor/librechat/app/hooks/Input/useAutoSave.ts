/**
 * Vendored from upstream client/src/hooks/Input/useAutoSave.ts (pinned 197a1dc4).
 *
 * Subtractions:
 * - File-draft logic entirely removed (no attachments in MVP2)
 * - restoreFiles / useGetFiles removed
 * - SetterOrUpdater<Map<...>> (files/setFiles) removed
 * - PENDING_CONVO transition logic simplified (text draft only)
 *
 * Rewires:
 * - useChatFormContext → react-hook-form setValue passed directly
 * - saveDrafts atom → always true (drafts always on in MVP2)
 * - NEW_CONVO / PENDING_CONVO / LocalStorageKeys → inline from our drafts.ts
 *
 * Kept byte-identical:
 * - dual-debounce strategy (25ms fast / 850ms slow)
 * - conversationId switch → save old draft, restore new draft
 * - draft storage format (base64 via setDraft/getDraft)
 */
import debounce from 'lodash/debounce';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { UseFormSetValue } from 'react-hook-form';
import { clearDraft, setDraft, getDraft, NEW_CONVO, PENDING_CONVO, TEXT_DRAFT_KEY } from '~/utils/drafts';

export const useAutoSave = ({
  isSubmitting,
  conversationId: _conversationId,
  textAreaRef,
  setValue,
}: {
  isSubmitting?: boolean;
  conversationId?: string | null;
  textAreaRef?: React.RefObject<HTMLTextAreaElement>;
  setValue: UseFormSetValue<{ text: string }>;
}) => {
  // When submitting we track under PENDING_CONVO key (matches upstream behavior)
  const conversationId = isSubmitting ? PENDING_CONVO : (_conversationId ?? NEW_CONVO);

  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  const restoreText = useCallback(
    (id: string) => {
      setValue('text', getDraft(id) ?? '');
    },
    [setValue],
  );

  const saveText = useCallback(
    (id: string) => {
      if (!textAreaRef?.current) {
        return;
      }
      if (textAreaRef.current.value === '' || textAreaRef.current.value.length === 1) {
        clearDraft(id);
      } else {
        setDraft({ id, value: textAreaRef.current.value });
      }
    },
    [textAreaRef],
  );

  // ── Per-keystroke autosave (dual debounce) ─────────────────────────────────
  useEffect(() => {
    if (conversationId == null || conversationId === '') {
      return;
    }

    const handleInputFast = debounce(
      (value: string) => setDraft({ id: conversationId, value }),
      25,
    );
    const handleInputSlow = debounce(
      (value: string) => setDraft({ id: conversationId, value }),
      850,
    );

    const eventListener = (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      const value = target.value;
      handleInputFast.cancel();
      handleInputSlow.cancel();
      if (value === '') {
        handleInputSlow(value);
      } else {
        handleInputFast(value);
      }
    };

    const textArea = textAreaRef?.current;
    if (textArea) {
      textArea.addEventListener('input', eventListener);
    }

    return () => {
      if (textArea) {
        textArea.removeEventListener('input', eventListener);
      }
      handleInputFast.cancel();
      handleInputSlow.cancel();
    };
  }, [conversationId, textAreaRef]);

  const prevConversationIdRef = useRef<string | null>(null);

  // ── Conversation switch: save old draft, restore new ──────────────────────
  useEffect(() => {
    if (conversationId == null || conversationId === '') {
      return;
    }
    if (conversationId === currentConversationId) {
      return;
    }

    try {
      if (
        prevConversationIdRef.current === PENDING_CONVO &&
        conversationId !== PENDING_CONVO &&
        conversationId.length > 3
      ) {
        const pendingDraft = localStorage.getItem(`${TEXT_DRAFT_KEY}${PENDING_CONVO}`);
        localStorage.removeItem(`${TEXT_DRAFT_KEY}${PENDING_CONVO}`);
        if (pendingDraft) {
          localStorage.setItem(`${TEXT_DRAFT_KEY}${conversationId}`, pendingDraft);
        } else if (textAreaRef?.current?.value) {
          setDraft({ id: conversationId, value: textAreaRef.current.value });
        }
      } else if (currentConversationId != null && currentConversationId) {
        saveText(currentConversationId);
      }

      restoreText(conversationId);
    } catch (e) {
      // suppress
    }

    prevConversationIdRef.current = conversationId;
    setCurrentConversationId(conversationId);
  }, [conversationId, currentConversationId, restoreText, saveText, textAreaRef]);
};
