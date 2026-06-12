/**
 * FE-4: the clarify turn — the agent does a little work, pauses on a
 * clarifying question, and parks as awaiting_input (PRD stories 23–25;
 * MVP1 stories 13–17). The composer stays live — typing is answering.
 */
import type { ProtocolEvent } from '@/api/protocol';
import { deltas } from './deltas';

export const CLARIFY_EVENTS: ProtocolEvent[] = [
  {
    v: 1,
    type: 'meta',
    data: { trace_id: 'mock-trace-clarify', session_id: 'mock', model: 'gemini-2.5-pro' },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's1',
      status: 'start',
      kind: 'db_tool',
      label: 'Querying the database: cost fields for both schools',
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
      label: 'Querying the database: cost fields for both schools',
      tier: 'official',
      detail: {
        tool: 'get_school_fields',
        field_keys: ['cost.tuition_in_state', 'cost.tuition_out_state', 'cost.total_price'],
        row_count: 6,
        duration_ms: 310,
      },
    },
  },
  {
    v: 1,
    type: 'thinking',
    data: { text: 'Cost depends heavily on residency and aid — better to ask than assume.' },
  },
  ...deltas('Quick question first — '),
  {
    v: 1,
    type: 'clarify',
    data: {
      v: 1,
      header: 'To compare costs',
      question: 'Which cost picture matters most to you?',
      multi_select: false,
      options: [
        { label: 'Sticker price', hint: 'Published tuition, fees, room & board' },
        { label: 'Net price after aid', hint: 'What families actually pay at your income level' },
        { label: 'Out-of-state / international', hint: 'No in-state discount applies' },
      ],
    },
  },
  { v: 1, type: 'done', data: { status: 'awaiting_input' } },
];
