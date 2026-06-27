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
import type { SourceConfigWire } from './source-config';

export type SendMessageBody = {
  text: string;
  /** Per-conversation source toggles (ADR 0013); the wire shape — mapped from
   *  the FE store by `source-config.ts toWire` at the call site (§4 boundary). */
  source_config?: SourceConfigWire;
  /** G3 (B2): a prior user_message_id — edit & regenerate via history rewrite. */
  replace_message_id?: string;
  /** True when the user has armed "Deep research" for this send. */
  deep_research?: boolean;
};

/** POST /v1/sessions — the new-chat flow mints a real session id before sending. */
export type CreatedSession = {
  session_id: string;
  source_config: SourceConfigWire | null;
};

/** GET /v1/sessions/{id} — the persisted transcript plus the session's stored
 *  source config (B5c: seeds the dropdown from server truth on chat open). */
export type SessionTranscript = {
  entries: TranscriptEntry[];
  sourceConfig: SourceConfigWire | null;
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
  /** GET /v1/sessions/{id} — the persisted transcript + stored source config (§27.5). */
  transcript(sessionId: string): Promise<SessionTranscript>;
  /** POST /v1/sessions — mint a new session (new-chat flow). */
  createSession(sourceConfig?: SourceConfigWire): Promise<CreatedSession>;
}
