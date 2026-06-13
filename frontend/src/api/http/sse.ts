/**
 * SSE frame parser (B5a) — a reusable async generator over a fetch
 * `Response.body` that yields `ProtocolEvent`s plus their wire `id:` seq.
 *
 * Wire format (verified against `api/sse.py`): each event is one frame
 *   id: <seq>\r\n
 *   event: <type>\r\n
 *   data: <compact-json of {v,type,data}>\r\n
 *   \r\n
 * - Keepalive comments are lines starting with `:` — ignored (they paint nothing).
 * - `data:` MAY span multiple lines (concatenated with `\n` per the SSE spec).
 * - CRLF and LF are both handled; frames are separated by a blank line.
 * - The `event:` line is redundant with the json `type` — we trust the json.
 * - The `id:` value is the internal Last-Event-ID cursor (GET attach reconnect).
 *
 * A malformed frame is skipped with a `console.warn` (the stream survives); a
 * network/decode failure propagates as the caller's thrown error.
 */
import type { ProtocolEvent, ProtocolEventType } from '@/api/protocol';
import { TransportError } from './errors';

const KNOWN_TYPES: ReadonlySet<ProtocolEventType> = new Set<ProtocolEventType>([
  'meta',
  'delta',
  'step',
  'thinking',
  'viz',
  'clarify',
  'sources',
  'usage',
  'done',
  'error',
]);

/** Hard ceiling on the buffer: guards against OOM if a server bug never emits a
 *  frame boundary. At this size we cancel the reader and fail the stream. */
const MAX_SSE_BUFFER_BYTES = 5 * 1024 * 1024;

/** One parsed frame: the protocol event plus its wire seq (the `id:` value). */
export type SseFrame = {
  event: ProtocolEvent;
  /** The `id:` field, when present — the Last-Event-ID cursor value. */
  id?: string;
};

function isKnownType(value: unknown): value is ProtocolEventType {
  return typeof value === 'string' && KNOWN_TYPES.has(value as ProtocolEventType);
}

/** Parse one raw frame (its lines already split) into an SseFrame, or null. */
function parseFrame(block: string): SseFrame | null {
  let id: string | undefined;
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0 || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('id:')) {
      id = line.slice(3).trimStart();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }
    // `event:` and any other field — redundant with the json; ignore.
  }
  if (dataLines.length === 0) {
    return null;
  }
  const payload = dataLines.join('\n');
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    console.warn('[sse] dropped a frame with unparseable data');
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    console.warn('[sse] dropped a non-object frame');
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (!isKnownType(obj.type)) {
    console.warn(`[sse] dropped a frame with unknown type: ${String(obj.type)}`);
    return null;
  }
  // Trust boundary: the body comes from our same-origin, authed backend. We
  // validate the `type` is a known member (above) but trust the rest of the
  // frame's shape — the reducer is the consumer and tolerates extra fields.
  return { event: obj as unknown as ProtocolEvent, id };
}

/**
 * Yield SseFrames from a fetch response stream, buffering partial chunks
 * across reads until a blank-line frame boundary (CRLF or LF).
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      // Normalize CRLF to LF so the frame boundary is always a blank LF line.
      buffer = buffer.replace(/\r\n/g, '\n');
      // Cap the buffer: a server bug that never emits a frame boundary would
      // otherwise grow it without bound. Cancel the reader and fail the stream.
      if (buffer.length > MAX_SSE_BUFFER_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new TransportError('server', 'Stream exceeded the maximum allowed size.');
      }
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrame(block);
        if (frame !== null) {
          yield frame;
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    // Flush the decoder so trailing multibyte bytes aren't dropped, then parse
    // any trailing frame with no terminating blank line.
    buffer += decoder.decode();
    const tail = buffer.replace(/\r\n/g, '\n').trim();
    if (tail.length > 0) {
      const frame = parseFrame(tail);
      if (frame !== null) {
        yield frame;
      }
    }
  } finally {
    // Cancel the reader BEFORE releasing the lock: an early break (e.g. the
    // consumer stops iterating after cancel) leaves the connection dangling if
    // we only releaseLock. cancel() aborts the underlying fetch body.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
