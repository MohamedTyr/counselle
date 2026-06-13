/**
 * The Transport seam (frontend-plan §3, ADR 0020).
 *
 * Two implementations, one interface:
 *   - MockTransport (src/api/mock/transport.ts) — fixture replay, this plan.
 *   - HttpTransport (FE-7) — fetch-streaming SSE against /v1. Nothing above
 *     this seam changes when it lands; that's the point.
 *
 * Nothing in FE-0…FE-6 may import anything below this seam.
 */
import type { ProtocolEvent, TranscriptEntry } from './protocol';

export type SendMessageBody = {
  text: string;
  /** Per-conversation source toggles (ADR 0013); shape owned by sourceStore. */
  source_config?: Record<string, unknown>;
  /** G3 (B2): a prior user_message_id — edit & regenerate via history rewrite. */
  replace_message_id?: string;
};

export interface Transport {
  /** POST .../messages — start a turn, stream its events. */
  sendMessage(sessionId: string, body: SendMessageBody): AsyncIterable<ProtocolEvent>;
  /**
   * GET .../stream — reattach to an in-flight turn: replay events already
   * emitted after `lastEventId`, then continue live (§27.3).
   */
  attach(sessionId: string, lastEventId?: string): AsyncIterable<ProtocolEvent>;
  /** POST .../cancel — stop the active turn; the stream terminates with done(cancelled). */
  cancel(sessionId: string): Promise<void>;
  /** GET /v1/sessions/{id} — the persisted transcript (§27.5). */
  transcript(sessionId: string): Promise<TranscriptEntry[]>;
}
