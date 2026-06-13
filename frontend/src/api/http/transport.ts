/**
 * HttpTransport (B5a) — the real `/v1` implementation of the Transport seam.
 *
 * fetch-streaming SSE for POST send and GET attach (delegating to the reusable
 * `parseSseStream`), an internal per-session Last-Event-ID cursor (§6 of the
 * wire-contract — internal to the transport, never seen by the reducer),
 * `cancel`/`transcript`, `credentials: 'same-origin'` on every request, and
 * typed 401/409/429/422/5xx errors.
 */
import type { ProtocolEvent, TranscriptEntry } from '@/api/protocol';
import type { CreatedSession, SendMessageBody, Transport } from '@/api/transport';
import { errorFromResponse, TransportError } from './errors';
import { parseSseStream } from './sse';
import { BASE } from './constants';

type TranscriptResponse = {
  session_id: string;
  title: string | null;
  created_at: string | null;
  source_config: Record<string, unknown> | null;
  transcript: TranscriptEntry[];
};

/** Wrap a fetch so connection failures surface as a typed 'network' error. */
async function safeFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (cause) {
    throw new TransportError('network', 'Could not reach the server.', { cause });
  }
}

export class HttpTransport implements Transport {
  /** Per-session cursor: the last `id:` seq parsed for the active turn (§6). */
  private readonly cursors = new Map<string, string>();

  /** Stream a fetch response's SSE body, tracking the Last-Event-ID cursor. */
  private async *streamEvents(
    sessionId: string,
    response: Response,
  ): AsyncGenerator<ProtocolEvent, void, undefined> {
    if (response.body === null) {
      // 204 (no active turn) or an empty body — yield nothing; the caller
      // falls back to the transcript read (§27.3's 204 path).
      return;
    }
    for await (const frame of parseSseStream(response.body)) {
      if (frame.id !== undefined) {
        this.cursors.set(sessionId, frame.id);
      }
      yield frame.event;
      // The cursor resets at each terminal event — the next turn restarts seq.
      if (frame.event.type === 'done' || frame.event.type === 'error') {
        this.cursors.delete(sessionId);
      }
    }
  }

  async *sendMessage(
    sessionId: string,
    body: SendMessageBody,
  ): AsyncGenerator<ProtocolEvent, void, undefined> {
    // A new turn restarts the seq — drop any stale cursor before streaming.
    this.cursors.delete(sessionId);
    const response = await safeFetch(`${BASE}/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    yield* this.streamEvents(sessionId, response);
  }

  async *attach(
    sessionId: string,
    lastEventId?: string,
  ): AsyncGenerator<ProtocolEvent, void, undefined> {
    const cursor = lastEventId ?? this.cursors.get(sessionId);
    const headers: Record<string, string> =
      cursor !== undefined ? { 'Last-Event-ID': cursor } : {};
    const response = await safeFetch(`${BASE}/sessions/${sessionId}/stream`, {
      method: 'GET',
      headers,
      credentials: 'same-origin',
    });
    // 204 — no active turn; yield nothing (the client falls back to transcript).
    if (response.status === 204) {
      return;
    }
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    yield* this.streamEvents(sessionId, response);
  }

  async cancel(sessionId: string): Promise<void> {
    const response = await safeFetch(`${BASE}/sessions/${sessionId}/cancel`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    // 202 (cancelled) | 204 (idle/parked) — both resolve void.
    if (response.status === 202 || response.status === 204) {
      return;
    }
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
  }

  async transcript(sessionId: string): Promise<TranscriptEntry[]> {
    const response = await safeFetch(`${BASE}/sessions/${sessionId}`, {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    const json = (await response.json()) as TranscriptResponse;
    return json.transcript;
  }

  /** New-chat flow: mint a real session id before the first send. A network
   *  failure surfaces as TransportError('network') (reuses `safeFetch`). */
  async createSession(sourceConfig?: Record<string, unknown>): Promise<CreatedSession> {
    const body = sourceConfig !== undefined ? { source_config: sourceConfig } : {};
    const response = await safeFetch(`${BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    return (await response.json()) as CreatedSession;
  }
}

export const httpTransport = new HttpTransport();
