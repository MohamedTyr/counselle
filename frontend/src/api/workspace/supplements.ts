import { jsonRequestInit, requestJson, requestVoid } from "@/api/http/client";
import type {
  ApplicationSupplements,
  EssaySummary,
} from "@/api/workspace/types";

export function listSupplements() {
  return requestJson<ApplicationSupplements[]>("/supplements");
}

export function startSupplementEssay(applicationId: string, key: string) {
  return requestJson<EssaySummary>(
    `/applications/${applicationId}/supplements/${key}/essay`,
    jsonRequestInit("POST", {}),
  );
}

export function acknowledgePromptChange(essayId: string) {
  return requestVoid(
    `/essays/${essayId}/prompt-change/acknowledge`,
    jsonRequestInit("POST", {}),
  );
}
