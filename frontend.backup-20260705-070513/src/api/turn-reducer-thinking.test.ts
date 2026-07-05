/**
 * Stable thinking-entry ids (FE-H3). The timeline interleaves steps and thinking
 * in arrival order; thinking entries must carry a reducer-assigned id that is
 * stable across re-reduces and unique even when the thinking text repeats — so
 * the renderer can key on the id instead of the positional array index.
 */
import { describe, expect, test } from 'vitest';
import type { ProtocolEvent, StepData } from '@/api/protocol';
import type { TimelineEntry } from '@/api/turn-reducer';
import { initialTurnState, reduce } from '@/api/turn-reducer';

function thinkingEvent(text: string): ProtocolEvent {
  return { v: 1, type: 'thinking', data: { text } };
}

function stepEvent(
  step: Partial<StepData> & Pick<StepData, 'step_id' | 'status'>,
): ProtocolEvent {
  return {
    v: 1,
    type: 'step',
    data: { kind: 'web_search', label: 'Searching', tier: null, detail: null, ...step },
  };
}

function thinkingEntries(timeline: TimelineEntry[]): Array<{ id: string; text: string }> {
  return timeline
    .filter((e): e is Extract<TimelineEntry, { type: 'thinking' }> => e.type === 'thinking')
    .map((e) => ({ id: e.id, text: e.text }));
}

describe('thinking timeline entry ids', () => {
  test('thinking entries get stable, unique ids that survive interleaved steps', () => {
    let state = initialTurnState();
    state = reduce(state, thinkingEvent('a'));
    state = reduce(state, stepEvent({ step_id: 's1', status: 'start' }));
    state = reduce(state, thinkingEvent('b'));
    state = reduce(state, stepEvent({ step_id: 's1', status: 'end' }));
    state = reduce(state, thinkingEvent('a'));

    const entries = thinkingEntries(state.timeline);
    // Three thinking entries, distinct ids even though text "a" repeats; the
    // ordinal (count of thinking lines, not text) is the id — steps don't shift it.
    expect(entries).toEqual([
      { id: 'think-0', text: 'a' },
      { id: 'think-1', text: 'b' },
      { id: 'think-2', text: 'a' },
    ]);
  });

  test("a later event does not change an earlier entry's id", () => {
    let state = initialTurnState();
    state = reduce(state, thinkingEvent('first'));
    const firstAfterOne = thinkingEntries(state.timeline)[0];

    state = reduce(state, stepEvent({ step_id: 's1', status: 'start' }));
    state = reduce(state, thinkingEvent('second'));
    state = reduce(state, stepEvent({ step_id: 's1', status: 'end' }));
    const firstAfterMore = thinkingEntries(state.timeline)[0];

    // The first entry's id is unchanged by everything that arrived after it.
    expect(firstAfterMore.id).toBe(firstAfterOne.id);
    expect(firstAfterMore.id).toBe('think-0');
  });

  test('a duplicate thinking text does not collide on key', () => {
    let state = initialTurnState();
    state = reduce(state, thinkingEvent('same'));
    state = reduce(state, thinkingEvent('same'));

    const ids = thinkingEntries(state.timeline).map((e) => e.id);
    expect(ids).toEqual(['think-0', 'think-1']);
    expect(new Set(ids).size).toBe(2);
  });
});
