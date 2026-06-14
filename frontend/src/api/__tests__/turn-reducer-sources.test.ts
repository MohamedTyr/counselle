/**
 * Source chips survive the start→end step merge (feat/reasoning-experience).
 * The `end` event carries `sources`; the `start` event doesn't — `mergeStep`'s
 * shallow spread must surface them, and a source-less step must stay source-less.
 */
import { describe, expect, test } from 'vitest';
import type { ProtocolEvent, StepData } from '@/api/protocol';
import { initialTurnState, reduce } from '@/api/turn-reducer';

function stepEvent(step: Partial<StepData> & Pick<StepData, 'step_id' | 'status'>): ProtocolEvent {
  return {
    v: 1,
    type: 'step',
    data: { kind: 'web_search', label: 'Searching', tier: null, detail: null, ...step },
  };
}

describe('step sources merge', () => {
  test('end-event sources surface onto the started step', () => {
    let state = initialTurnState();
    state = reduce(state, stepEvent({ step_id: 's1', status: 'start' }));
    expect(state.steps[0].sources).toBeUndefined();
    state = reduce(
      state,
      stepEvent({
        step_id: 's1',
        status: 'end',
        sources: [{ label: 'usnews.com', favicon: 'https://cdn/f', url: 'https://usnews.com/x' }],
      }),
    );
    expect(state.steps[0].status).toBe('end');
    expect(state.steps[0].sources).toEqual([
      { label: 'usnews.com', favicon: 'https://cdn/f', url: 'https://usnews.com/x' },
    ]);
    // The timeline entry merged in place (no duplicate row).
    const stepEntries = state.timeline.filter((e) => e.type === 'step');
    expect(stepEntries).toHaveLength(1);
  });

  test('a source-less step stays source-less', () => {
    let state = initialTurnState();
    state = reduce(state, stepEvent({ step_id: 's1', status: 'start' }));
    state = reduce(state, stepEvent({ step_id: 's1', status: 'end', kind: 'db_tool' }));
    expect(state.steps[0].sources).toBeUndefined();
  });
});
