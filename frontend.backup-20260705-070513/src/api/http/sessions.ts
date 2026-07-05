/**
 * The sessions client (B5c) — pure functions over `/v1/sessions`.
 *
 * Reuses the auth client's conventions: `credentials: 'same-origin'` on every
 * request, `errorFromResponse` for status→typed-kind mapping (401 → the AuthGate
 * redirect; 5xx → a surfaced 'server' error). The sidebar list, rename, delete,
 * and create all live here; hooks.ts wraps them in TanStack mutations.
 */
import { errorFromResponse } from './errors';
import type { SourceConfigWire } from '@/api/source-config';
import type { ChatSummary } from '@/api/types';
import { BASE } from './constants';
import { safeFetch } from './safeFetch';

/** The route caps `limit` at 50 (ge=1, le=50); we treat 50 as the full list for
 *  MVP2. Load-more / infinite scroll is deferred (see TODOS "sessions-list load-more"). */
const SESSIONS_LIMIT = 50;

/** A single row from `GET /v1/sessions`. */
interface SessionRow {
  session_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  source_config: SourceConfigWire | null;
  is_generating: boolean;
}

interface SessionsResponse {
  sessions: SessionRow[];
  next_cursor: string | null;
}

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

function rowToSummary(row: SessionRow): ChatSummary {
  return {
    conversationId: row.session_id,
    title: row.title ?? 'New chat',
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    isGenerating: row.is_generating,
  };
}

/** GET /v1/sessions?limit=50 → the most-recent sessions as `ChatSummary` rows. */
export async function listSessions(): Promise<ChatSummary[]> {
  const response = await safeFetch(`${BASE}/sessions?limit=${SESSIONS_LIMIT}`, {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  const json = (await response.json()) as SessionsResponse;
  return json.sessions.map(rowToSummary);
}

/** PATCH /v1/sessions/{id} `{title}` → 200. */
export async function renameSession(sessionId: string, title: string): Promise<void> {
  const response = await safeFetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
}

/** DELETE /v1/sessions/{id} → 204 (cancels live turns + drops the checkpoint).
 *  May 500 with a retryable envelope — surfaced as a 'server' error so the
 *  optimistic UI can keep the row rather than claim a delete that didn't happen. */
export async function deleteSession(sessionId: string): Promise<void> {
  const response = await safeFetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (response.status === 204) {
    return;
  }
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
}
