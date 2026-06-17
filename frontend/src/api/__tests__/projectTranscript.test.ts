/**
 * projectTranscript — the pure transcript → ChatMessage projection helpers
 * (Phase 5 / FE-CHATCONTEXT-GOD). Covers the user/assistant/synthesized/
 * feedback/clarifyAnswer mapping and the FE-TYPE-DERIVED-STORED reference-stable
 * `activities` memo.
 */
import { describe, expect, test } from 'vitest';
import {
  assistantMessage,
  messagesFromTranscript,
} from '@/api/projectTranscript';
import { initialTurnState, type TurnState, type TimelineEntry } from '@/api/turn-reducer';
import type { TranscriptEntry } from '@/api/protocol';

describe('messagesFromTranscript — projection mapping', () => {
  test('user entry → user bubble; assistant entry → assistant card', () => {
    const entries: TranscriptEntry[] = [
      { role: 'user', text: 'What is NYU?', ts: '2026-06-01T00:00:00Z', message_id: 'u1' },
      { role: 'assistant', text: 'A school.', ts: '2026-06-01T00:00:01Z', message_id: 'a1' },
    ];
    const msgs = messagesFromTranscript('c1', entries);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].isCreatedByUser).toBe(true);
    expect(msgs[0].messageId).toBe('u1');
    expect(msgs[0].hasBackendId).toBe(true);
    expect(msgs[1].isCreatedByUser).toBe(false);
    expect(msgs[1].messageId).toBe('a1');
    // The assistant parents on the preceding user message.
    expect(msgs[1].parentMessageId).toBe('u1');
  });

  test('no message_id → synthesized fallback id + hasBackendId false', () => {
    const entries: TranscriptEntry[] = [{ role: 'user', text: 'hi', ts: null }];
    const msgs = messagesFromTranscript('c1', entries);
    expect(msgs[0].messageId).toBe('msg-c1-0');
    expect(msgs[0].hasBackendId).toBe(false);
  });

  test('synthesized clarify-answer bubble carries the synthesized flag', () => {
    const entries: TranscriptEntry[] = [
      { role: 'user', text: 'Early Decision', ts: null, message_id: 'u1', synthesized: true },
    ];
    const msgs = messagesFromTranscript('c1', entries);
    expect(msgs[0].synthesized).toBe(true);
  });

  test('feedback maps up/down → thumbsUp/thumbsDown', () => {
    const entries: TranscriptEntry[] = [
      { role: 'assistant', text: 'A.', ts: null, message_id: 'a1', feedback: { rating: 'up' } },
      { role: 'assistant', text: 'B.', ts: null, message_id: 'a2', feedback: { rating: 'down' } },
    ];
    const msgs = messagesFromTranscript('c1', entries);
    expect(msgs[0].feedback).toEqual({ rating: 'thumbsUp' });
    expect(msgs[1].feedback).toEqual({ rating: 'thumbsDown' });
  });

  test('clarifyAnswer is threaded from the entry (outside the reducer replay)', () => {
    const entries: TranscriptEntry[] = [
      {
        role: 'assistant',
        text: 'Which round?',
        ts: null,
        message_id: 'a1',
        clarify: {
          spec: { v: 1, question: 'Which round?', header: '', multi_select: false, options: [] },
          answer: 'Regular Decision',
        },
      },
    ];
    const msgs = messagesFromTranscript('c1', entries);
    expect(msgs[0].clarifyAnswer).toBe('Regular Decision');
  });
});

describe('assistantMessage — reference-stable activities (FE-TYPE-DERIVED-STORED)', () => {
  test('same state.timeline reference → same activities array reference', () => {
    const timeline: TimelineEntry[] = [
      { type: 'step', step: { step_id: 's1', label: 'Reading CDS', status: 'end', kind: 'db' } as never },
      { type: 'thinking', id: 't1', text: 'pondering' },
    ];
    const state: TurnState = { ...initialTurnState(), timeline, status: 'complete' };
    const a = assistantMessage('c1', 'a1', 'u1', state, null);
    const b = assistantMessage('c1', 'a1', 'u1', state, null);
    // The WeakMap memo keyed on `state.timeline` returns the same array.
    expect(a.activities).toBe(b.activities);
    expect(a.activities).toEqual(['Reading CDS', 'Thinking…']);
  });

  test('a different timeline reference yields a different activities array', () => {
    const t1: TimelineEntry[] = [
      { type: 'step', step: { step_id: 's1', label: 'A', status: 'end', kind: 'db' } as never },
    ];
    const t2: TimelineEntry[] = [
      { type: 'step', step: { step_id: 's1', label: 'B', status: 'end', kind: 'db' } as never },
    ];
    const a = assistantMessage('c1', 'a1', 'u1', { ...initialTurnState(), timeline: t1 }, null);
    const b = assistantMessage('c1', 'a1', 'u1', { ...initialTurnState(), timeline: t2 }, null);
    expect(a.activities).not.toBe(b.activities);
    expect(a.activities).toEqual(['A']);
    expect(b.activities).toEqual(['B']);
  });
});
