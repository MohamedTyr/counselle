/** The error turn — dies mid-answer with a terminal `error` event (§27.4 MVP1 shape). */
import type { ProtocolEvent } from '@/api/protocol';
import { deltas } from './deltas';

const PARTIAL = `## Comparing acceptance rates

Pulling the latest CDS numbers for both schools now. The first thing to know is that`;

export const ERROR_EVENTS: ProtocolEvent[] = [
  {
    v: 1,
    type: 'meta',
    data: { trace_id: 'mock-trace-error', session_id: 'mock', model: 'gemini-2.5-pro' },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's1',
      status: 'start',
      kind: 'db_tool',
      label: 'Querying the database: admissions fields',
      tier: 'official',
      detail: null,
    },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's1',
      status: 'error',
      kind: 'db_tool',
      label: 'Querying the database: admissions fields',
      tier: 'official',
      detail: { tool: 'get_school_fields', duration_ms: 5021 },
    },
  },
  ...deltas(PARTIAL),
  {
    v: 1,
    type: 'error',
    data: {
      message: 'Something went wrong while answering — please try again.',
      trace_id: 'mock-trace-error',
    },
  },
];
