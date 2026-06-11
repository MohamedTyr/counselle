/**
 * Question-anchored scrolling (PRD-mvp2 decision 8) — replaces upstream's
 * bottom-chasing useMessageScrolling.
 *
 * Behavior:
 * - When the user sends a message, the view scrolls once so the question pins
 *   near the top of the viewport; the answer streams downward below it. No
 *   continuous bottom-chasing while tokens arrive.
 * - Opening a conversation jumps to the bottom (latest exchange).
 * - The scroll-to-bottom pill shows whenever the view isn't near the bottom;
 *   clicking it smooth-scrolls to the end.
 *
 * Returns the same surface MessagesView consumed from upstream's hook
 * (scrollableRef/contentRef/messagesEndRef/showScrollButton/handleSmoothToRef/
 * debouncedHandleScroll).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import throttle from 'lodash/throttle';
import { useChatContext } from './ChatContext';

/** Px from the bottom under which the view counts as "at the bottom". */
const BOTTOM_THRESHOLD_PX = 100;
/** Gap above the anchored question, so it doesn't touch the header. */
const ANCHOR_TOP_OFFSET_PX = 12;
const SCROLL_HANDLER_THROTTLE_MS = 100;

export default function useQuestionAnchoredScroll() {
  const { conversationId, messages, isSubmitting } = useChatContext();
  const scrollableRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const lastAnchoredIdRef = useRef<string | null>(null);
  /** Ref so the open-conversation effect reads submission state without re-firing. */
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;

  const updateScrollButton = useCallback(() => {
    const el = scrollableRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollButton(distanceFromBottom > BOTTOM_THRESHOLD_PX);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedHandleScroll = useCallback(
    throttle(() => updateScrollButton(), SCROLL_HANDLER_THROTTLE_MS),
    [updateScrollButton],
  );

  /**
   * Opening a conversation: jump straight to the latest exchange. Skipped when
   * a turn is in flight (landing → new chat navigation) — there the anchor
   * effect owns the scroll, and this jump would cancel its smooth scrollTo.
   */
  useEffect(() => {
    if (isSubmittingRef.current) {
      return;
    }
    lastAnchoredIdRef.current = null;
    if (contentRef.current) {
      contentRef.current.style.paddingBottom = '';
    }
    const el = scrollableRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    updateScrollButton();
  }, [conversationId, updateScrollButton]);

  /** A newly sent user message anchors near the top of the viewport — once. */
  useEffect(() => {
    const lastUser = [...messages].reverse().find((m) => m.isCreatedByUser);
    if (lastUser === undefined || lastUser.messageId === lastAnchoredIdRef.current) {
      return;
    }
    const isNewlySent = messages[messages.length - 1] === lastUser
      || messages[messages.length - 1]?.parentMessageId === lastUser.messageId;
    if (!isNewlySent) {
      lastAnchoredIdRef.current = lastUser.messageId;
      return;
    }
    const scrollable = scrollableRef.current;
    const target = document.getElementById(lastUser.messageId);
    if (scrollable === null || target === null) {
      return;
    }
    lastAnchoredIdRef.current = lastUser.messageId;

    /**
     * Pin `target` ANCHOR_TOP_OFFSET below the viewport top — instantly, not
     * smoothly (smooth scrolls animate against stale ranges while the layout
     * settles and land wherever they please). Short chats can't scroll that
     * far, so the spacer (content padding-bottom) grows until they can; the
     * answer then streams into that space. Cleared on conversation change.
     */
    const anchoredId = lastUser.messageId;
    const applyAnchor = () => {
      const el = scrollableRef.current;
      const t = document.getElementById(anchoredId);
      const content = contentRef.current;
      if (el === null || t === null || lastAnchoredIdRef.current !== anchoredId) {
        return;
      }
      const residual =
        t.getBoundingClientRect().top - el.getBoundingClientRect().top - ANCHOR_TOP_OFFSET_PX;
      if (Math.abs(residual) <= 4) {
        return;
      }
      const desired = el.scrollTop + residual;
      if (content !== null) {
        // scrollHeight clamps to clientHeight, so size the spacer from the
        // content element's real height: contentHeight + extra = clientHeight + desired.
        const needed = el.clientHeight + desired - content.offsetHeight;
        if (needed > 0) {
          const current = parseFloat(content.style.paddingBottom || '0') || 0;
          content.style.paddingBottom = `${Math.ceil(current + needed)}px`;
          // Force a reflow so the assignment below sees the grown range.
          void el.scrollHeight;
        }
      }
      el.scrollTop = desired;
    };
    applyAnchor();
    // The composer clearing/resizing right after submit shifts the layout —
    // re-apply once it settles.
    window.setTimeout(applyAnchor, 600);
  }, [messages]);

  /** Streaming growth changes the overflow without scroll events — keep the pill honest. */
  useEffect(() => {
    updateScrollButton();
  }, [messages, updateScrollButton]);

  useEffect(() => () => debouncedHandleScroll.cancel(), [debouncedHandleScroll]);

  const handleSmoothToRef = useCallback<React.MouseEventHandler<HTMLButtonElement>>(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return {
    scrollableRef,
    contentRef,
    messagesEndRef,
    showScrollButton,
    handleSmoothToRef,
    debouncedHandleScroll,
  };
}
