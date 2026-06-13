/**
 * The feedback client (B5c) — `POST /v1/sessions/{id}/messages/{id}/feedback`.
 *
 * Wire body `{ rating: 'up' | 'down' | null }`: `null` clears → 204; `up`/`down`
 * upserts → 200 `{rating}`. Owned-session (404 on a foreign session). The FE↔wire
 * mapping (`thumbsUp↔up`) lives in the hooks layer; this client speaks the wire.
 * A non-ok response throws so the optimistic thumb can roll back honestly.
 */
import { errorFromResponse } from './errors';
import { BASE } from './constants';
import { safeFetch } from './safeFetch';

/** The wire rating — `null` clears the stored feedback. */
export type WireRating = 'up' | 'down' | null;

/** POST the rating; resolves on 200/204, throws (typed) on any non-ok status. */
export async function setFeedback(
  sessionId: string,
  messageId: string,
  rating: WireRating,
): Promise<void> {
  const response = await safeFetch(
    `${BASE}/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/feedback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ rating }),
    },
  );
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
}
