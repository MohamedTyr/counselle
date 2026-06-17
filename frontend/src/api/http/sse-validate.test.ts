/**
 * FE-SSE-NOSCHEMA — the SSE parser drops identity-bearing frames that are
 * missing a load-bearing field (a malformed meta/step/done/error would otherwise
 * flow into identity reconciliation as `undefined`), with a console.warn, while
 * the stream survives and non-identity frames pass through unvalidated.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ProtocolEvent } from '@/api/protocol';
import { parseSseStream } from './sse';

/** Build a fetch-style ReadableStream from raw SSE frame strings. */
function streamOf(...frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = frames.join('');
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

/** One SSE frame: `data:` line carrying compact JSON, terminated by a blank line. */
function frame(obj: unknown, id?: string): string {
  const idLine = id !== undefined ? `id: ${id}\n` : '';
  return `${idLine}data: ${JSON.stringify(obj)}\n\n`;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ProtocolEvent[]> {
  const out: ProtocolEvent[] = [];
  for await (const f of parseSseStream(stream)) {
    out.push(f.event);
  }
  return out;
}

describe('FE-SSE-NOSCHEMA — identity-frame validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('drops a meta frame missing message_id, keeps a well-formed one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = await collect(
      streamOf(
        frame({ v: 1, type: 'meta', data: {} }),
        frame({
          v: 1,
          type: 'meta',
          data: { message_id: 'm1', user_message_id: 'u1' },
        }),
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('meta');
    expect(warn).toHaveBeenCalled();
  });

  test('drops a step frame missing step_id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = await collect(
      streamOf(frame({ v: 1, type: 'step', data: { status: 'start' } })),
    );
    expect(events).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  test('drops a step frame missing status', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = await collect(
      streamOf(frame({ v: 1, type: 'step', data: { step_id: 's1' } })),
    );
    expect(events).toHaveLength(0);
  });

  test('drops a done frame missing status', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = await collect(streamOf(frame({ v: 1, type: 'done', data: {} })));
    expect(events).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  test('drops an error frame missing message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = await collect(
      streamOf(frame({ v: 1, type: 'error', data: { trace_id: 't1' } })),
    );
    expect(events).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  test('passes a delta frame unchanged (non-identity, trusted)', async () => {
    const events = await collect(streamOf(frame({ v: 1, type: 'delta', data: { text: 'hi' } })));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delta');
  });

  test('passes a thinking frame unchanged (non-identity, trusted)', async () => {
    const events = await collect(
      streamOf(frame({ v: 1, type: 'thinking', data: { text: 'pondering' } })),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('thinking');
  });

  test('a malformed identity frame does not abort the surrounding stream', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = await collect(
      streamOf(
        frame({ v: 1, type: 'delta', data: { text: 'a' } }),
        frame({ v: 1, type: 'meta', data: {} }), // dropped
        frame({ v: 1, type: 'delta', data: { text: 'b' } }),
      ),
    );
    expect(events.map((e) => e.type)).toEqual(['delta', 'delta']);
  });
});
