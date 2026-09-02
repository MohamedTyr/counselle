import { toast } from "sonner";

import { authQueryKey } from "@/app/auth";
import { isTransportError, type TransportError } from "@/api/http/errors";

/** Mutation-failure toast copy (DESIGN.md §1.9, table 3) — a mirror of
 * `api/workspace/hook-utils.ts::workspaceErrorMessage`, not a reuse: the
 * message text is CDS-admin-specific ("That edit was rejected", not "That
 * edit is invalid"). [F-01] `useCreateUpload` is the one row-scoped mutation
 * that calls this with `{ silent: true }`: DESIGN.md law 3 requires its
 * failure to render inline in the row (via `markEntryFailed` in
 * `useBatchUpload.ts`), never as a toast, and the inline path is already
 * complete on its own — see `specs/cds-pipeline/plan/cds-admin-polish-2.md` [F-01]'s
 * "Adjudicated in review round 3" note. `usePatchUploadRow` and
 * `useDeleteUploadRow` are also row-scoped but are *not* silenced: neither
 * has an inline affordance yet, and the delete-cleanup mutation on the
 * lost-abort-race path (`useBatchUpload.ts` around the `deletedClientIdsRef`
 * handling) relies on this toast as its only failure signal. Do not silence
 * those without adding an inline affordance first. */
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
 * redirects to login instead of the app quietly failing every request.
 *
 * `silent: true` (F-01) suppresses only the toast, never the 401 redirect —
 * an admin whose session expires mid-upload must still get redirected, even
 * though the row-scoped failure itself is reported inline, not by toast. */
export function handleCdsError(
  error: unknown,
  context: {
    client: {
      invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
    };
  },
  options?: { silent?: boolean },
) {
  if (!isTransportError(error)) {
    if (!options?.silent) {
      toast.error("That action failed. Please try again.");
    }
    return;
  }
  if (error.kind === "unauthorized") {
    void context.client.invalidateQueries({ queryKey: authQueryKey });
  }
  if (!options?.silent) {
    toast.error(cdsAdminErrorMessage(error));
  }
}
