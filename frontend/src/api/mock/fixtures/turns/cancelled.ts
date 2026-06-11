/**
 * The cancelled turn — a scripted replay of a turn the student stopped:
 * partial prose, then `done(status="cancelled")` (§27.4). Also a long, slow
 * stream — convenient for manually exercising the Stop button.
 */
import type { ProtocolEvent } from '@/api/protocol';
import { deltas } from './deltas';

const PARTIAL = `## Financial aid at private universities

Let me walk through how need-based aid actually gets computed, because the sticker price is almost never the real number.

### The order of operations

First, the school computes your **demonstrated need**: cost of attendance minus your expected family contribution. Then its aid policy decides how much of that need it meets — and with what mix of grants versus loans. The Common Data Set's H2 table states both numbers plainly, and they vary enormously between schools that look similar on`;

export const CANCELLED_EVENTS: ProtocolEvent[] = [
  {
    v: 1,
    type: 'meta',
    data: { trace_id: 'mock-trace-cancelled', session_id: 'mock', model: 'gemini-2.5-pro' },
  },
  {
    v: 1,
    type: 'step',
    data: {
      step_id: 's1',
      status: 'start',
      kind: 'db_tool',
      label: 'Querying the database: financial aid fields',
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
      label: 'Querying the database: financial aid fields',
      tier: 'official',
      detail: {
        tool: 'get_school_fields',
        field_keys: ['fin.need_met_pct', 'fin.avg_grant'],
        row_count: 2,
        duration_ms: 260,
      },
    },
  },
  ...deltas(PARTIAL),
  { v: 1, type: 'done', data: { status: 'cancelled' } },
];
