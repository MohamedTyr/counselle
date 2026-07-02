import { describe, expect, test } from 'vitest';
import { activeLatestMessage, visibleChatMessages, type ChatMessage } from '@/app/ChatContext';

function user(messageId: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId,
    conversationId: 'c1',
    parentMessageId: null,
    text: 'answer',
    isCreatedByUser: true,
    sender: '',
    error: false,
    unfinished: false,
    ts: null,
    ...over,
  };
}

function assistant(messageId: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId,
    conversationId: 'c1',
    parentMessageId: 'u1',
    text: '',
    isCreatedByUser: false,
    sender: 'Counselle',
    error: false,
    unfinished: false,
    ts: null,
    ...over,
  };
}

describe('activeLatestMessage', () => {
  test('returns the final message when no turn is awaiting input', () => {
    const latest = user('u2');
    expect(activeLatestMessage([user('u1'), assistant('a1'), latest])).toBe(latest);
  });

  test('keeps a parked assistant active even when a synthesized answer bubble follows it', () => {
    const parked = assistant('a1', {
      turnStatus: 'awaiting_input',
      clarify: {
        v: 1,
        question: 'Review the plan.',
        header: 'Deep research',
        multi_select: false,
        options: [
          { label: 'Run deep research', hint: '' },
          { label: 'Cancel', hint: '' },
        ],
      },
    });
    const synthesized = user('scope-answer', { synthesized: true });

    expect(activeLatestMessage([user('u1'), parked, synthesized])).toBe(parked);
  });
});

describe('visibleChatMessages', () => {
  test('hides synthesized clarify-answer bubbles from the chat surface', () => {
    const normal = user('u1');
    const synthesized = user('u2', { synthesized: true });
    const answer = assistant('a1');

    expect(visibleChatMessages([normal, synthesized, answer])).toEqual([normal, answer]);
  });
});
