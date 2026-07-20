import { BASE } from "@/api/http/constants";
import { requestJson, requestVoid, safeFetch } from "@/api/http/client";
import { errorFromResponse } from "@/api/http/errors";
import type { Document, DocumentType } from "@/api/workspace/types";

export function listDocuments() {
  return requestJson<Document[]>("/documents");
}

export async function uploadDocument(input: {
  file: File;
  title: string;
  docType: DocumentType;
}) {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("title", input.title);
  formData.append("doc_type", input.docType);
  const response = await safeFetch("/documents", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return (await response.json()) as Document;
}

export function archiveDocument(documentId: string) {
  return requestVoid(`/documents/${documentId}`, { method: "DELETE" });
}

/** Raw-bytes download URL for `<a href>`/download links — never fetch this
 * with JSON parsing, `GET /documents/{id}/file` returns the file body. */
export function documentFileUrl(documentId: string) {
  return `${BASE}/documents/${documentId}/file`;
}
