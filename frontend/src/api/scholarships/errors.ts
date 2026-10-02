import { toast } from "sonner";

import { isTransportError } from "@/api/http/errors";
import type { PublishCheck } from "@/api/scholarships/types";

/* Reading the scholarship routes' error envelopes (`api/routes/scholarships.py`). */

const PUBLISH_CHECKS: readonly PublishCheck[] = [
  "basics",
  "apply_url",
  "award",
  "rules_complete",
  "deadline",
  "source_url",
  "fresh",
];

function errorField(error: unknown, key: string): unknown {
  if (!isTransportError(error)) return undefined;
  const envelope = (error.body as { error?: Record<string, unknown> } | null | undefined)?.error;
  return envelope?.[key];
}

/** The failing publish checks a 422 names; empty for any other error. */
export function publishProblems(error: unknown): PublishCheck[] {
  const problems = errorField(error, "problems");
  return Array.isArray(problems)
    ? problems.filter((item): item is PublishCheck => PUBLISH_CHECKS.includes(item as PublishCheck))
    : [];
}

/** The server's current version on a 409; null otherwise. */
export function conflictVersion(error: unknown): number | null {
  const version = errorField(error, "current_version");
  return typeof version === "number" ? version : null;
}

export function scholarshipErrorMessage(error: unknown): string {
  if (!isTransportError(error)) return "Something went wrong. Please try again.";
  if (error.kind === "network") return "Could not reach the server. Check your connection and try again.";
  if (error.kind === "unauthorized") return "Your session expired. Sign in again.";
  return error.message;
}

export function toastScholarshipError(error: unknown): void {
  toast.error(scholarshipErrorMessage(error));
}
