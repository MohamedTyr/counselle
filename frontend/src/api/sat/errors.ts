import { toast } from "sonner";

import { authQueryKey } from "@/app/auth";
import { isTransportError } from "@/api/http/errors";

/**
 * SAT practice's shared error toast (plan §5.5, §5.7). Every SAT surface —
 * submit, bookmark, import, reset — funnels its mutation failures through
 * this one function rather than hand-rolling a `switch` per call site.
 *
 * `TransportError` carries no `413` kind of its own (it arrives as a
 * generic `"server"` error with `status === 413`), so that check comes
 * first; `422` — a bad answer, a malformed import file — is the client's
 * only structured kind, `"invalid_edit"`. `copy` lets a call site swap in
 * its own wording (the import flow's "That file is too large to import." /
 * "Invalid .liprep backup format.") without duplicating the status/kind
 * switch; anything not overridden falls back to a generic sentence.
 */
export interface SatErrorCopy {
  /** `status === 413` (import only — no other SAT route can trigger it). */
  tooLarge?: string;
  /** `kind === "invalid_edit"` (422). */
  invalid?: string;
  /** Anything else. */
  fallback?: string;
}

const DEFAULT_COPY: Required<SatErrorCopy> = {
  tooLarge: "That file is too large to import.",
  invalid: "That request is invalid.",
  fallback: "Something went wrong. Please try again.",
};

function satErrorMessage(error: unknown, copy: SatErrorCopy): string {
  if (!isTransportError(error)) {
    return copy.fallback ?? DEFAULT_COPY.fallback;
  }
  if (error.status === 413) {
    return copy.tooLarge ?? DEFAULT_COPY.tooLarge;
  }
  if (error.kind === "invalid_edit") {
    return copy.invalid ?? DEFAULT_COPY.invalid;
  }
  if (error.kind === "unauthorized") {
    return "Your session expired. Sign in again to keep practicing.";
  }
  if (error.kind === "network") {
    return "Could not reach the server. Check your connection and try again.";
  }
  return copy.fallback ?? DEFAULT_COPY.fallback;
}

/** `client` is optional: a call from inside a TanStack `onError` passes
 * `context.client` (as `handleMutationError` does for the workspace); a call
 * from plain async code (e.g. `useSatSession`'s manual `submit()`) can pass
 * a `QueryClient` from `useQueryClient()`, or omit it and skip the
 * session-expiry refetch. */
export function toastSatError(
  error: unknown,
  options?: {
    client?: { invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown };
    copy?: SatErrorCopy;
  },
): void {
  if (isTransportError(error) && error.kind === "unauthorized" && options?.client) {
    void options.client.invalidateQueries({ queryKey: authQueryKey });
  }
  toast.error(satErrorMessage(error, options?.copy ?? {}));
}
