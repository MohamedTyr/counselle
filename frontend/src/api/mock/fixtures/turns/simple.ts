/** The simple turn — one db lookup, a short plain answer. The default scenario. */
import type { ProtocolEvent } from '@/api/protocol';
import { deltas } from './deltas';

const ANSWER = `That's a good question to ground in the data. The short answer: it depends on the school's published priorities, and the Common Data Set is where they state them outright.

If you name a school, I can pull its exact CDS factor weightings, test policy, and middle-50% ranges from the database and walk through what they mean for your profile.`;

export const SIMPLE_EVENTS: ProtocolEvent[] = [
  {
    v: 1,
    type: 'meta',
    data: { trace_id: 'mock-trace-simple', session_id: 'mock', model: 'gemini-2.5-pro' },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's1',
      status: 'start',
      kind: 'db_tool',
      label: 'Querying the database: field catalog',
      tier: 'official',
      detail: null,
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's1',
      status: 'end',
      kind: 'db_tool',
      label: 'Querying the database: field catalog',
      tier: 'official',
      detail: { tool: 'search_fields', field_keys: ['adm.*'], row_count: 12, duration_ms: 210 },
    },
  },
  ...deltas(ANSWER),
  {
    v: 1,
    type: 'usage',
    data: { input_tokens: 4210, output_tokens: 96, est_cost_usd: 0.006, tool_calls: 1 },
  },
  { v: 1, type: 'done', data: { status: 'complete' } },
];
