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
