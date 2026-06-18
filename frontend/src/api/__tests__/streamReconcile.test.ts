/**
 * streamReconcile — the pure consumeStream helpers (Phase 5 /
 * FE-CONSUMESTREAM-SIZE). They take explicit state and return values, so the
 * branchy id-swap + terminal/errored card construction is testable in isolation
 * (the point of the extraction).
 */
import { describe, expect, test, vi } from 'vitest';
import {
  persistErroredTurn,
  persistTerminalTurn,
  reconcileMetaIds,
  upsertAssistantMessage,
} from '@/api/streamReconcile';
import type { ChatMessage } from '@/api/projectTranscript';
import { initialTurnState, type TurnState } from '@/api/turn-reducer';

function user(messageId: string): ChatMessage {
  return {
    messageId,
    conversationId: 'c1',
    parentMessageId: null,
    text: 'hi',
    isCreatedByUser: true,
    sender: '',
    error: false,
    unfinished: false,
    ts: null,
  };
}

function assistant(messageId: string, conversationId = 'c1'): ChatMessage {
  return {
    messageId,
    conversationId,
    parentMessageId: 'user-1',
    text: 'old',
    isCreatedByUser: false,
    sender: 'assistant',
    error: false,
    unfinished: false,
    ts: '2026-06-18T00:00:00.000Z',
    turnStatus: 'streaming',
  };
}

describe('reconcileMetaIds — temp user-id swap (G1)', () => {
  test('matched: swaps the temp id to the backend id and flags hasBackendId', () => {
    const prev = [user('temp-user-1'), user('temp-user-2')];
    const { next, matched } = reconcileMetaIds(prev, 'temp-user-2', 'backend-2');
    expect(matched).toBe(true);
    expect(next[1].messageId).toBe('backend-2');
    expect(next[1].hasBackendId).toBe(true);
    // The other entry is untouched (same reference is not required; value is).
    expect(next[0].messageId).toBe('temp-user-1');
  });

  test('unmatched: returns the array unchanged and warns via the logger seam', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prev = [user('temp-user-1')];
    const { next, matched } = reconcileMetaIds(prev, 'temp-user-MISSING', 'backend-x');
    expect(matched).toBe(false);
    expect(next.map((m) => m.messageId)).toEqual(['temp-user-1']);
    // logger.warn forwards to console.warn in DEV (the test env).
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('upsertAssistantMessage — terminal assistant card upsert', () => {
  test('upsert replaces existing assistant card in place for completed streams', () => {
    const state: TurnState = { ...initialTurnState(), status: 'complete' };
    const terminal = persistTerminalTurn('c1', 'asst-1', 'user-1', true, state);
    const other = assistant('asst-other');
    const prev = [user('user-1'), assistant('asst-1'), other];

    const next = upsertAssistantMessage(prev, terminal);

    expect(next).toHaveLength(3);
    expect(next[0]).toBe(prev[0]);
    expect(next[1]).toBe(terminal);
    expect(next[2]).toBe(other);
    expect(next.map((m) => m.messageId)).toEqual(['user-1', 'asst-1', 'asst-other']);
    expect(next.filter((m) => m.messageId === 'asst-1')).toHaveLength(1);
  });

  test('upsert replaces existing assistant card in place for accepted-then-failed streams', () => {
    const state: TurnState = { ...initialTurnState(), status: 'streaming' };
    const terminal = persistErroredTurn('c1', 'asst-1', 'user-1', true, state, 'boom');
    const prev = [user('user-1'), assistant('asst-1'), assistant('asst-other')];

    const next = upsertAssistantMessage(prev, terminal);

    expect(next).toHaveLength(3);
    expect(next[1]).toBe(terminal);
    expect(next[1].turnStatus).toBe('error');
    expect(next.filter((m) => m.messageId === 'asst-1')).toHaveLength(1);
  });

  test('upsert does not replace user or other conversation assistant matches', () => {
    const state: TurnState = { ...initialTurnState(), status: 'complete' };
    const terminal = persistTerminalTurn('c1', 'shared-id', 'user-1', true, state);
    const sameIdUser = user('shared-id');
    const otherConversationAssistant = assistant('shared-id', 'c2');
    const prev = [sameIdUser, otherConversationAssistant];

    const next = upsertAssistantMessage(prev, terminal);

    expect(next).toHaveLength(3);
    expect(next[0]).toBe(sameIdUser);
    expect(next[1]).toBe(otherConversationAssistant);
    expect(next[2]).toBe(terminal);
  });

  test('upsert appends when absent', () => {
    const state: TurnState = { ...initialTurnState(), status: 'complete' };
    const terminal = persistTerminalTurn('c1', 'asst-new', 'user-1', true, state);
    const prev = [user('user-1'), assistant('asst-old')];

    const next = upsertAssistantMessage(prev, terminal);

    expect(next).toHaveLength(3);
    expect(next.slice(0, 2)).toEqual(prev);
    expect(next[2]).toBe(terminal);
  });
});

describe('persistTerminalTurn — the completed assistant card', () => {
  test('builds an assistant card with the reconciled ids + hasBackendId', () => {
    const state: TurnState = { ...initialTurnState(), status: 'complete' };
    const card = persistTerminalTurn('c1', 'asst-1', 'user-1', true, state);
    expect(card.isCreatedByUser).toBe(false);
    expect(card.messageId).toBe('asst-1');
    expect(card.parentMessageId).toBe('user-1');
    expect(card.hasBackendId).toBe(true);
    expect(card.turnStatus).toBe('complete');
    expect(card.error).toBe(false);
    expect(card.streamError).toBeUndefined();
  });
});

describe('persistErroredTurn — the accepted-then-failed card', () => {
  test('forces error status and carries the message (keeps partial state)', () => {
    const state: TurnState = { ...initialTurnState(), status: 'streaming' };
    const card = persistErroredTurn('c1', 'asst-1', 'user-1', true, state, 'boom');
    expect(card.turnStatus).toBe('error');
    expect(card.hasBackendId).toBe(true);
    expect(card.streamError).toEqual({ message: 'boom', trace_id: '' });
  });

  test('keeps an existing reducer error over the passed message', () => {
    const state: TurnState = {
      ...initialTurnState(),
      status: 'streaming',
      error: { message: 'from-reducer', trace_id: 't1' },
    };
    const card = persistErroredTurn('c1', 'asst-1', 'user-1', false, state, 'fallback');
    expect(card.streamError).toEqual({ message: 'from-reducer', trace_id: 't1' });
    expect(card.hasBackendId).toBe(false);
  });
});
