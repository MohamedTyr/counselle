import { jsonRequestInit, requestJson, requestVoid } from "@/api/http/client";
import { BASE } from "@/api/http/constants";
import { errorFromResponse, TransportError } from "@/api/http/errors";
import type {
  Essay,
  EssayCreate,
  EssayPatch,
  EssaySummary,
} from "@/api/workspace/types";

export function listEssays() {
  return requestJson<EssaySummary[]>("/essays");
}

export function createEssay(input: EssayCreate) {
  return requestJson<EssaySummary>("/essays", jsonRequestInit("POST", input));
}

export function getEssay(essayId: string) {
  return requestJson<Essay>(`/essays/${essayId}`);
}

export function updateEssay(essayId: string, patch: EssayPatch) {
  return requestJson<Essay>(
    `/essays/${essayId}`,
    jsonRequestInit("PATCH", patch),
  );
}

export async function updateEssayKeepalive(essayId: string, patch: EssayPatch) {
  let response: Response;
  try {
    response = await fetch(`${BASE}/essays/${essayId}`, {
      ...jsonRequestInit("PATCH", patch),
      credentials: "same-origin",
      keepalive: true,
    });
  } catch (cause) {
    throw new TransportError("network", "Could not reach the server.", {
      cause,
    });
  }

  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return (await response.json()) as Essay;
}

export function archiveEssay(essayId: string) {
  return requestVoid(`/essays/${essayId}`, { method: "DELETE" });
}

/*
 * Suggestions: four resolve endpoints and the essay's own chat thread.
 *
 * None of the four takes a request body. The server resolves from the
 * suggestion it already stored, in markdown space, and hands back the
 * authoritative essay — so nothing the client trimmed, anchored, or painted
 * can ever reach a write. That is the whole reason accept is safe to apply
 * from the response rather than optimistically.
 */

const suggestionPath = (essayId: string, suggestionId: string) =>
  `/essays/${essayId}/suggestions/${suggestionId}`;

export function acceptSuggestion(essayId: string, suggestionId: string) {
  return requestJson<Essay>(`${suggestionPath(essayId, suggestionId)}/accept`, {
    method: "POST",
  });
}

export function rejectSuggestion(essayId: string, suggestionId: string) {
  return requestJson<Essay>(`${suggestionPath(essayId, suggestionId)}/reject`, {
    method: "POST",
  });
}

/** One suggestion a batch could not apply, and the server's stated reason. */
export type SkippedSuggestion = {
  id: string;
  reason: string;
};

/**
 * A batch resolve. `essay` is already the post-batch essay, so a caller reads
 * content and suggestions straight off it rather than re-deriving what is left
 * from the counts. `skipped` is shown to the student, never swallowed.
 */
export type SuggestionBatchResult = {
  applied: number;
  essay: Essay;
  skipped: SkippedSuggestion[];
};

export function acceptAllSuggestions(essayId: string) {
  return requestJson<SuggestionBatchResult>(
    `/essays/${essayId}/suggestions/accept-all`,
    { method: "POST" },
  );
}

export function rejectAllSuggestions(essayId: string) {
  return requestJson<SuggestionBatchResult>(
    `/essays/${essayId}/suggestions/reject-all`,
    { method: "POST" },
  );
}

/**
 * The essay's one durable chat thread — created on first call, returned
 * unchanged after that. Get-or-create server-side, so there is no client-side
 * map of essay to session and the conversation follows the essay to another
 * browser or device.
 */
export function createEssayChatSession(essayId: string) {
  return requestJson<{ session_id: string }>(`/essays/${essayId}/session`, {
    method: "POST",
  });
}

export function restoreEssay(essayId: string) {
  return requestJson<EssaySummary>(`/essays/${essayId}/restore`, {
    method: "POST",
  });
}

export function duplicateEssay(essayId: string) {
  return requestJson<EssaySummary>(`/essays/${essayId}/duplicate`, {
    method: "POST",
  });
}
