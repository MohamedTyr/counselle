import { jsonRequestInit, requestJson, requestVoid, safeFetch } from "@/api/http/client";
import { errorFromResponse } from "@/api/http/errors";
import { CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS } from "@/config";
import type {
  ProcessResult,
  UploadBatch,
  UploadPatchBody,
  UploadRow,
} from "@/api/cds-admin/types";

/** `POST /admin/cds/uploads` — one file per request (per plan §D row 3), the
 * batch upload screen fires up to 4 of these in parallel. `batchId` is a
 * client-generated UUID (`crypto.randomUUID()`) shared by every file in the
 * batch, not something the server assigns — this is how a reload can
 * rebuild the staging table via `GET /uploads?batch_id=`. */
export async function createUpload(input: {
  file: File;
  batchId: string;
  /** Lets the caller cancel the in-flight upload — batch-upload's delete
   * action (staging-model.ts / useBatchUpload.ts) aborts this the moment an
   * admin deletes a row before its server row exists. */
  signal?: AbortSignal;
}): Promise<UploadRow> {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("batch_id", input.batchId);
  const response = await safeFetch(
    "/admin/cds/uploads",
    { method: "POST", body: formData, signal: input.signal },
    CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return (await response.json()) as UploadRow;
}

export function listBatch(batchId: string) {
  const params = new URLSearchParams({ batch_id: batchId });
  return requestJson<UploadBatch>(`/admin/cds/uploads?${params}`);
}

export function patchUploadRow(input: {
  fileId: string;
  body: UploadPatchBody;
}) {
  return requestJson<UploadRow>(
    `/admin/cds/uploads/${input.fileId}`,
    jsonRequestInit("PATCH", input.body),
  );
}

export function deleteUploadRow(fileId: string) {
  return requestVoid(`/admin/cds/uploads/${fileId}`, { method: "DELETE" });
}

export function processBatch(batchId: string) {
  return requestJson<ProcessResult>(
    `/admin/cds/uploads/${batchId}/process`,
    { method: "POST" },
    CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS,
  );
}
