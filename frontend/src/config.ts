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
