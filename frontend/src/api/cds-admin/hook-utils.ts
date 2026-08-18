import { toast } from "sonner";

import { authQueryKey } from "@/app/auth";
import { isTransportError, type TransportError } from "@/api/http/errors";

/** Mutation-failure toast copy (DESIGN.md §1.9, table 3) — a mirror of
 * `api/workspace/hook-utils.ts::workspaceErrorMessage`, not a reuse: the
 * message text is CDS-admin-specific ("That edit was rejected", not "That
 * edit is invalid"). Row-scoped failures (a single upload row, a single
 * metric) are never routed through this — those render inline in the row
 * per DESIGN.md law 3; this is for page- and action-scoped failures only
 * (process batch, approve, reject, rerun). */
function cdsAdminErrorMessage(error: TransportError): string {
  switch (error.kind) {
    case "unauthorized":
      return "Your session expired. Sign in again.";
    case "conflict":
      return "That changed on the server. Reload and try again.";
    case "invalid_edit":
      return `That edit was rejected: ${error.message}`;
    case "rate_limited":
      return "Too many requests. Wait a moment.";
    case "network":
      return "Could not reach the server.";
    default:
      return "That action failed. Please try again.";
  }
}

/** `onError` handler for CDS admin mutations — toasts a page/action-scoped
 * failure and, on a 401, invalidates the session query so `RequireAuth`
 * redirects to login instead of the app quietly failing every request. */
export function handleCdsError(
  error: unknown,
  context: {
    client: {
      invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
    };
  },
) {
  if (!isTransportError(error)) {
    toast.error("That action failed. Please try again.");
    return;
  }
  if (error.kind === "unauthorized") {
    void context.client.invalidateQueries({ queryKey: authQueryKey });
  }
  toast.error(cdsAdminErrorMessage(error));
}
