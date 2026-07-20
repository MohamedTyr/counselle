import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatMessage } from "./model";

/**
 * Question-anchored scrolling, ported from the old app's
 * `useQuestionAnchoredScroll`. Deliberately NOT a bottom-chasing scroll
 * container (AI Elements' `Conversation`/`use-stick-to-bottom` always
 * follows the bottom, which is the wrong behavior here — see the plan's
 * "AI Elements vs Custom State" rejection note for `Conversation`).
 *
 * Behavior:
 * - Opening a conversation jumps straight to the bottom (latest exchange).
 * - Sending a message anchors the new user question near the top of the
 *   viewport once; the answer streams downward below it. No continuous
 *   bottom-chasing while tokens arrive.
 * - User wheel/touch scroll during streaming is never fought — this hook
 *   only forces scroll position on the two events above, never on a timer.
 * - The scroll-to-bottom button shows whenever the view is more than
 *   `BOTTOM_THRESHOLD_PX` from the bottom.
 */

const BOTTOM_THRESHOLD_PX = 100;
const ANCHOR_TOP_OFFSET_PX = 12;
const SCROLL_HANDLER_THROTTLE_MS = 100;
const ANCHOR_REAPPLY_DELAY_MS = 600;

function throttle(fn: () => void, waitMs: number) {
  let scheduled = false;
  let lastCall = 0;

  const invoke = () => {
    lastCall = Date.now();
    scheduled = false;
    fn();
  };

  const throttled = () => {
    const elapsed = Date.now() - lastCall;
    if (elapsed >= waitMs) {
      invoke();
      return;
    }
    if (!scheduled) {
      scheduled = true;
      window.setTimeout(invoke, waitMs - elapsed);
    }
  };

  throttled.cancel = () => {
    scheduled = false;
  };

  return throttled;
}

export type UseQuestionAnchoredScrollOptions = {
  sessionId: string;
  messages: ChatMessage[];
  isSubmitting: boolean;
};

export function useQuestionAnchoredScroll({
  sessionId,
  messages,
  isSubmitting,
}: UseQuestionAnchoredScrollOptions) {
  const scrollableRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const lastAnchoredIdRef = useRef<string | null>(null);
  const isSubmittingRef = useRef(isSubmitting);
  // Render-time ref sync (mirrors useTurnEngine.ts's sessionIdRef pattern):
  // event handlers below (scroll, timers) need the LATEST isSubmitting
  // without re-subscribing on every change.
  // eslint-disable-next-line react-hooks/refs -- intentional render-time ref sync, see comment above.
  isSubmittingRef.current = isSubmitting;

  const updateScrollButton = useCallback(() => {
    const el = scrollableRef.current;
    if (!el) {
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollButton(distanceFromBottom > BOTTOM_THRESHOLD_PX);
  }, []);

  const debouncedHandleScroll = useMemo(
    // eslint-disable-next-line react-hooks/refs -- updateScrollButton only reads scrollableRef.current inside its own body when invoked (never during this render); throttle() just wraps the function reference.
    () => throttle(updateScrollButton, SCROLL_HANDLER_THROTTLE_MS),
    [updateScrollButton],
  );

  const needsBottomJumpRef = useRef(false);

  // Opening a conversation: jump straight to the latest exchange.
  useEffect(() => {
    if (isSubmittingRef.current) {
      return;
    }
    lastAnchoredIdRef.current = null;
    needsBottomJumpRef.current = true;
    if (contentRef.current) {
      contentRef.current.style.paddingBottom = "";
    }
    const el = scrollableRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    updateScrollButton();
  }, [sessionId, updateScrollButton]);

  // The transcript loads asynchronously — re-jump once when messages render.
  useEffect(() => {
    if (!needsBottomJumpRef.current || messages.length === 0) {
      return;
    }
    needsBottomJumpRef.current = false;
    const el = scrollableRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    updateScrollButton();
  }, [messages, updateScrollButton]);

  // A newly sent user message anchors near the top of the viewport — once.
  useEffect(() => {
    const lastUser = [...messages].reverse().find((m) => m.kind === "user");
    if (
      lastUser === undefined ||
      lastUser.messageId === lastAnchoredIdRef.current
    ) {
      return;
    }

    const isNewlySent =
      isSubmittingRef.current &&
      (messages.at(-1) === lastUser ||
        messages.at(-1)?.parentMessageId === lastUser.messageId);
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

    const anchoredId = lastUser.messageId;
    const applyAnchor = () => {
      const el = scrollableRef.current;
      const t = document.getElementById(anchoredId);
      const content = contentRef.current;
      if (
        el === null ||
        t === null ||
        lastAnchoredIdRef.current !== anchoredId
      ) {
        return;
      }
      const residual =
        t.getBoundingClientRect().top -
        el.getBoundingClientRect().top -
        ANCHOR_TOP_OFFSET_PX;
      if (Math.abs(residual) <= 4) {
        return;
      }
      const desired = el.scrollTop + residual;
      if (content !== null) {
        const needed = el.clientHeight + desired - content.offsetHeight;
        if (needed > 0) {
          const current =
            Number.parseFloat(content.style.paddingBottom || "0") || 0;
          content.style.paddingBottom = `${Math.ceil(current + needed)}px`;
          void el.scrollHeight;
        }
      }
      el.scrollTop = desired;
    };
    applyAnchor();
    requestAnimationFrame(() => requestAnimationFrame(applyAnchor));
    window.setTimeout(applyAnchor, ANCHOR_REAPPLY_DELAY_MS);
  }, [messages]);

  // Streaming growth changes overflow without scroll events — keep the pill honest.
  useEffect(() => {
    updateScrollButton();
  }, [messages, updateScrollButton]);

  useEffect(
    () => () => debouncedHandleScroll.cancel(),
    [debouncedHandleScroll],
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return {
    scrollableRef,
    contentRef,
    messagesEndRef,
    showScrollButton,
    scrollToBottom,
    onScroll: debouncedHandleScroll,
  };
}
