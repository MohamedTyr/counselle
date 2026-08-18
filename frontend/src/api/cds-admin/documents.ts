import { BASE } from "@/api/http/constants";
import { jsonRequestInit, requestJson, requestVoid } from "@/api/http/client";
import { CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS } from "@/config";
import type {
  ApproveBody,
  ApproveResult,
  DocumentReviewOut,
  MetricEditsBody,
  RejectBody,
  RerunBody,
  RerunResult,
} from "@/api/cds-admin/types";

export function getDocument(documentId: number) {
  return requestJson<DocumentReviewOut>(`/admin/cds/documents/${documentId}`);
}

export function patchMetrics(input: {
  documentId: number;
  body: MetricEditsBody;
}) {
  return requestJson<DocumentReviewOut>(
    `/admin/cds/documents/${input.documentId}/metrics`,
    jsonRequestInit("PATCH", input.body),
  );
}

/** Throws a `TransportError` with `kind: "conflict"` (HTTP 409) when the
 * document has unresolved flags and `body.override_flags` is not set — a
 * recoverable state the review screen should offer an "Approve anyway"
 * retry for, not a generic failure toast. `kind: "invalid_edit"` (422)
 * means the document isn't a candidate — a real validation error, not
 * something a retry fixes.
 *
 * Extended timeout: approving also forces a full school-catalog reload
 * (`catalog.maybe_refresh(force=True)`) server-side, which can run past the
 * shared default on a large catalog. */
export function approveDocument(input: {
  documentId: number;
  body: ApproveBody;
}) {
  return requestJson<ApproveResult>(
    `/admin/cds/documents/${input.documentId}/approve`,
    jsonRequestInit("POST", input.body),
    CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS,
  );
}

export function rejectDocument(input: {
  documentId: number;
  body: RejectBody;
}) {
  return requestVoid(
    `/admin/cds/documents/${input.documentId}/reject`,
    jsonRequestInit("POST", input.body),
  );
}

export function rerunExtraction(input: {
  documentId: number;
  body: RerunBody;
}) {
  return requestJson<RerunResult>(
    `/admin/cds/documents/${input.documentId}/rerun`,
    jsonRequestInit("POST", input.body),
  );
}

/** Plain path, not a fetch call — the `<img>` tag carries the same-origin
 * session cookie automatically. `Cache-Control: private, max-age=86400,
 * immutable` on the response means paging back to a page already viewed is
 * free (endpoint #10). */
export function pageImageUrl(
  documentId: number,
  page: number,
  width?: number,
): string {
  const query = width !== undefined ? `?w=${width}` : "";
  return `${BASE}/admin/cds/documents/${documentId}/pages/${page}.png${query}`;
}
