import { jsonRequestInit, requestJson, requestVoid } from "@/api/http/client";
import type {
  Essay,
  EssayPromptDraftConvert,
  EssayPromptDraftCreate,
  EssayPromptDraftSummary,
} from "@/api/workspace/types";

export function listEssayPromptDrafts() {
  return requestJson<EssayPromptDraftSummary[]>("/essay-prompt-drafts");
}

export function createEssayPromptDraft(input: EssayPromptDraftCreate) {
  return requestJson<EssayPromptDraftSummary>(
    "/essay-prompt-drafts",
    jsonRequestInit("POST", input),
  );
}

export function archiveEssayPromptDraft(draftId: string) {
  return requestVoid(`/essay-prompt-drafts/${draftId}`, { method: "DELETE" });
}

export function restoreEssayPromptDraft(draftId: string) {
  return requestJson<EssayPromptDraftSummary>(
    `/essay-prompt-drafts/${draftId}/restore`,
    { method: "POST" },
  );
}

export function convertEssayPromptDraft(
  draftId: string,
  input: EssayPromptDraftConvert,
) {
  return requestJson<Essay>(
    `/essay-prompt-drafts/${draftId}/convert`,
    jsonRequestInit("POST", input),
  );
}
