/**
 * FE-ATTACH-CURSOR — the transport persists its per-turn Last-Event-ID cursor in
 * sessionStorage so a reattach survives a full page reload (a fresh module
 * singleton). A terminal event and a new sendMessage clear the durable cursor.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HttpTransport } from './transport';

const CURSOR_KEY = 'counselle:cursor:S';

/** A fetch Response whose SSE body is the given raw frames. */
function sseResponse(...frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames.join('')));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function frame(obj: unknown, id?: string): string {
  const idLine = id !== undefined ? `id: ${id}\n` : '';
  return `${idLine}data: ${JSON.stringify(obj)}\n\n`;
}

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) {
    // discard — we only care about side effects on the cursor
  }
}

describe('FE-ATTACH-CURSOR — durable Last-Event-ID cursor', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  test('attach reads a persisted cursor after a simulated reload', async () => {
    // A previous page load left a cursor in sessionStorage; the singleton is gone.
    sessionStorage.setItem(CURSOR_KEY, '7');

    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers;
        return new Response(null, { status: 204 });
      }),
    );

    // A FRESH transport instance simulates the post-reload module singleton.
    const transport = new HttpTransport();
    await drain(transport.attach('S'));

    expect(new Headers(capturedHeaders).get('Last-Event-ID')).toBe('7');
  });

  test('a terminal done event clears the persisted cursor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(
          frame({ v: 1, type: 'delta', data: { text: 'hi' } }, '0'),
          frame({ v: 1, type: 'done', data: { status: 'complete' } }, '1'),
        ),
      ),
    );

    const transport = new HttpTransport();
    await drain(transport.sendMessage('S', { text: 'q' }));

    expect(sessionStorage.getItem(CURSOR_KEY)).toBeNull();
  });

  test('sendMessage clears a stale cursor before streaming', async () => {
    sessionStorage.setItem(CURSOR_KEY, '99');
    let capturedHeaders: HeadersInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers;
        // An empty body means streamEvents yields nothing — the cursor stays cleared.
        return new Response(null, { status: 200 });
      }),
    );

    const transport = new HttpTransport();
    await drain(transport.sendMessage('S', { text: 'q' }));

    // POST carries no Last-Event-ID, and the stale cursor is gone.
    expect(new Headers(capturedHeaders).get('Last-Event-ID')).toBeNull();
    expect(sessionStorage.getItem(CURSOR_KEY)).toBeNull();
  });

  test('a streamed non-terminal frame persists its id to sessionStorage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(frame({ v: 1, type: 'delta', data: { text: 'hi' } }, '3'))),
    );

    const transport = new HttpTransport();
    await drain(transport.attach('S'));

    // The stream ended without a terminal event, so the last seen id stays durable.
    expect(sessionStorage.getItem(CURSOR_KEY)).toBe('3');
  });
});
