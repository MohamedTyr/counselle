/**
 * streamReconcile — pure helpers for the stream-consumption loop
 * (Phase 5 / FE-CONSUMESTREAM-SIZE). They take explicit state and return values
 * (no React, no setState); the hook applies the result. Extracted from
 * ChatContext's inline `consumeStream` body so the branchy id-swap + terminal/
 * errored card construction is independently testable.
 */
import { assistantMessage, type ChatMessage } from '@/api/projectTranscript';
import { logger } from '@/lib/logger';
import type { TurnState } from '@/api/turn-reducer';

/**
 * Identity adoption (G1): the stream's `meta` carries the canonical backend user
 * id. On send a temp user echo is in `persisted` — swap its id exactly once.
 * Returns the new array + whether the temp id was found (the caller logs the
 * honesty warn through the logger seam when not).
 */
export function reconcileMetaIds(
  prev: ChatMessage[],
  prevUserId: string,
  backendUserId: string,
): { next: ChatMessage[]; matched: boolean } {
  let matched = false;
  const next = prev.map((m) => {
    if (m.messageId === prevUserId) {
      matched = true;
      return { ...m, messageId: backendUserId, hasBackendId: true };
    }
    return m;
  });
  if (!matched) {
    // The temp user id wasn't found — a permanently-temp id silently breaks
    // feedback/edit addressing for this user message.
    logger.warn(
      `[chat] meta.user_message_id arrived but temp id ${prevUserId} ` +
        'was not found in the projection; identity not reconciled.',
    );
  }
  return { next, matched };
}

/**
 * Build the terminal (completed) assistant card from reducer state, stamping the
 * reconciled backend-id flag. The server already persisted it; a reload
 * re-fetches via transport.transcript.
 */
export function persistTerminalTurn(
  convoId: string,
  assistantMessageId: string,
  userMessageId: string,
  hasBackendId: boolean,
  state: TurnState,
): ChatMessage {
  const done = assistantMessage(
    convoId,
    assistantMessageId,
    userMessageId,
    state,
    new Date().toISOString(),
  );
  done.hasBackendId = hasBackendId;
  return done;
}

/**
 * Build the errored assistant card (accepted-then-failed mid-stream): the
 * partial answer is kept and rendered with the protocol error appended.
 */
export function persistErroredTurn(
  convoId: string,
  assistantMessageId: string,
  userMessageId: string,
  hasBackendId: boolean,
  state: TurnState,
  message: string,
): ChatMessage {
  const errored: TurnState = {
    ...state,
    status: 'error',
    error: state.error ?? { message, trace_id: '' },
  };
  const card = assistantMessage(
    convoId,
    assistantMessageId,
    userMessageId,
    errored,
    new Date().toISOString(),
  );
  card.hasBackendId = hasBackendId;
  return card;
}
