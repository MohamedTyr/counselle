/** Default abort timeout for `safeFetch` calls that don't pass their own —
 * sized for quick auth/CRUD calls, not for endpoints that do real work
 * server-side. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** CDS admin calls that trigger a synchronous server-side Gemini detection
 * call (upload) or a full catalog reload (approve) run well past the
 * default — give them real headroom so a slow-but-successful request never
 * gets client-aborted and shown to the admin as "Failed" when the server
 * actually completed it. */
export const CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS = 60_000;

/** `PUT /v1/sat/progress` parses and applies a whole progress export
 * server-side (plan §5.7) — give it the same headroom as the CDS admin's
 * slow requests rather than the default, so a large-but-legitimate import
 * never gets client-aborted mid-apply. */
export const SAT_IMPORT_TIMEOUT_MS = 60_000;

/** `GET /v1/sat/session` returns the whole session's light row list up
 * front (plan §5.4) — a 1,900-question filter is legal, so this gets more
 * headroom than the default quick-CRUD timeout, short of the slow-request
 * ceiling above. */
export const SAT_SESSION_TIMEOUT_MS = 30_000;
