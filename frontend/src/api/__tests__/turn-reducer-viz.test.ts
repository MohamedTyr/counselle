import { describe, expect, test } from 'vitest';
import type { ProtocolEvent, RenderSpec, TranscriptAssistantEntry } from '@/api/protocol';
import type { ContentBlock, TurnState } from '@/api/turn-reducer';
import {
  initialTurnState,
  reduce,
  reduceTranscriptEntry,
  transcriptEntryToEvents,
} from '@/api/turn-reducer';

function spec(overrides: Partial<RenderSpec> = {}): RenderSpec {
  return {
    v: 1,
    type: 'comparison_table',
    title: 'Admission rates',
    schools: [
      { unitid: 100, name: 'North College', domain: 'north.edu' },
      { unitid: 200, name: 'South University', domain: 'south.edu' },
    ],
    rows: [
      {
        label: 'Acceptance rate',
        cells: [
          {
            v: 1,
            field: 'admissions.acceptance_rate',
            label: 'Acceptance rate',
            display: '12%',
            raw: 0.12,
            available: true,
            unit: 'percent',
            citation: {
              source: 'cds',
              tier: 'official',
              vintage: 'CDS 2024-25',
              caveat: null,
              raw_table: 'B',
              url: null,
            },
          },
          {
            v: 1,
            field: 'admissions.acceptance_rate',
            label: 'Acceptance rate',
            display: '42%',
            raw: 0.42,
            available: true,
            unit: 'percent',
            citation: {
              source: 'ipeds',
              tier: 'official',
              vintage: 'IPEDS 2024-25',
              caveat: 'provisional',
              raw_table: null,
              url: null,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function vizEvent(renderSpec: RenderSpec): ProtocolEvent {
  return { v: 1, type: 'viz', data: renderSpec };
}

function reduceEvents(events: ProtocolEvent[]): TurnState {
  return events.reduce(reduce, initialTurnState());
}

function vizBlocks(state: TurnState): Array<Extract<ContentBlock, { kind: 'viz' }>> {
  return state.blocks.filter((block): block is Extract<ContentBlock, { kind: 'viz' }> => block.kind === 'viz');
}

function assistantEntry(parts: TranscriptAssistantEntry['parts']): TranscriptAssistantEntry {
  return {
    role: 'assistant',
    text: '',
    ts: null,
    parts,
    status: 'complete',
  };
}

describe('visualization reducer idempotency', () => {
  test('duplicate live viz events append one block', () => {
    const renderSpec = spec();

    const state = reduceEvents([vizEvent(renderSpec), vizEvent(renderSpec)]);

    expect(vizBlocks(state)).toHaveLength(1);
  });

  test('transcript duplicate equivalent viz parts replay to one block', () => {
    const renderSpec = spec();

    const state = reduceTranscriptEntry(
      assistantEntry([
        { type: 'viz', spec: renderSpec },
        { type: 'viz', spec: renderSpec },
      ]),
    );

    expect(vizBlocks(state)).toHaveLength(1);
  });

  test('attach replay with overlapping live and persisted viz frames keeps one card', () => {
    const liveSpec = spec({ title: 'Live card title' });
    const replaySpec = spec({
      title: 'Replay card title',
      schools: [
        { unitid: 100, name: 'North College', domain: 'northcollege.edu' },
        { unitid: 200, name: 'South University', domain: null },
      ],
    });
    const liveState = reduceEvents([
      { v: 1, type: 'delta', data: { text: 'Live intro.' } },
      vizEvent(liveSpec),
    ]);
    const replayEvents = transcriptEntryToEvents(
      assistantEntry([
        { type: 'text', text: 'Replayed intro.' },
        { type: 'viz', spec: replaySpec },
        { type: 'viz', spec: replaySpec },
        { type: 'text', text: 'Replayed closing.' },
      ]),
    );

    const attachedState = replayEvents.reduce(reduce, liveState);

    expect(vizBlocks(attachedState)).toHaveLength(1);
    expect(vizBlocks(attachedState)[0].spec.title).toBe('Live card title');
  });

  test('same data different titles dedupes', () => {
    const first = spec({ title: 'Admissions snapshot' });
    const second = spec({ title: 'Different heading' });

    const state = reduceEvents([vizEvent(first), vizEvent(second)]);

    expect(vizBlocks(state)).toHaveLength(1);
    expect(vizBlocks(state)[0].spec.title).toBe('Admissions snapshot');
  });

  test('same data different school domains dedupes', () => {
    const first = spec();
    const second = spec({
      schools: [
        { unitid: 100, name: 'North College', domain: 'northcollege.edu' },
        { unitid: 200, name: 'South University', domain: null },
      ],
    });

    const state = reduceEvents([vizEvent(first), vizEvent(second)]);

    expect(vizBlocks(state)).toHaveLength(1);
    expect(vizBlocks(state)[0].spec.schools).toEqual(first.schools);
  });

  test('different viz specs are not collapsed', () => {
    const first = spec();
    const second = spec({
      rows: [
        {
          label: 'Graduation rate',
          cells: [
            {
              v: 1,
              field: 'outcomes.grad_rate',
              label: 'Graduation rate',
              display: '91%',
              raw: 0.91,
              available: true,
              unit: 'percent',
              citation: {
                source: 'scorecard',
                tier: 'official',
                vintage: 'Scorecard 2024',
                caveat: null,
                raw_table: null,
                url: null,
              },
            },
          ],
        },
      ],
    });

    const state = reduceEvents([vizEvent(first), vizEvent(second)]);

    expect(vizBlocks(state)).toHaveLength(2);
  });

  test('renders one card for duplicate equivalent viz events', () => {
    const first = spec({ title: 'Original card title' });
    const duplicate = spec({ title: 'Duplicate render title' });

    const state = reduceEvents([
      { v: 1, type: 'delta', data: { text: 'Final answer intro.' } },
      vizEvent(first),
      vizEvent(duplicate),
      { v: 1, type: 'done', data: { status: 'complete' } },
    ]);

    expect(state.blocks.filter((block) => block.kind === 'markdown')).toHaveLength(1);
    expect(vizBlocks(state)).toHaveLength(1);
    expect(vizBlocks(state)[0].spec.title).toBe('Original card title');
  });

  test('renders distinct cards for semantically different viz specs', () => {
    const first = spec({ title: 'Admissions card' });
    const second = spec({
      title: 'Cost card',
      rows: [
        {
          label: 'Net price',
          cells: [
            {
              v: 1,
              field: 'cost.net_price',
              label: 'Net price',
              display: '$24,000',
              raw: 24000,
              available: true,
              unit: 'usd',
              citation: {
                source: 'scorecard',
                tier: 'official',
                vintage: 'Scorecard 2024',
                caveat: null,
                raw_table: null,
                url: null,
              },
            },
          ],
        },
      ],
    });

    const state = reduceEvents([vizEvent(first), vizEvent(second)]);

    expect(vizBlocks(state).map((block) => block.spec.title)).toEqual([
      'Admissions card',
      'Cost card',
    ]);
  });
});
