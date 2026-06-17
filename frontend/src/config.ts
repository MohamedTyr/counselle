/**
 * config — centralized frontend network timings + favicon CDN host (CFG-04, CFG-10).
 *
 * The single home for the two values that have no natural component owner:
 *   - the network timeouts (auth-request hang cap, cancel-wait ceiling), so a
 *     network-behavior change is one edit; and
 *   - the keyless favicon CDN host + size, so a CDN/size swap is one edit.
 *
 * Cosmetic micro-timings (hover open/close, scroll anchor delay) deliberately
 * stay local to their components — they are presentation polish, not network
 * config (LA-3).
 */

// --- Network timings (CFG-10) -------------------------------------------------

/**
 * Max ms a short auth/me request may hang before it's treated as a network
 * failure. A half-open server (TCP accepted, no response) would otherwise leave
 * the request pending forever — and the AuthGate spinner with it. SCOPED to the
 * auth client: the long-lived SSE stream fetches use their own no-timeout path.
 */
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Max ms to wait for an in-flight turn to terminate after a cancel, before
 * surfacing a conflict (the send-while-generating path in useTurnEngine). If the
 * running turn doesn't clear within this window, the new message is NOT silently
 * dropped — an honest error is surfaced instead.
 */
export const CANCEL_WAIT_TIMEOUT_MS = 5_000;

// --- Favicon CDN (CFG-04) -----------------------------------------------------

/** Keyless favicon CDN (Google s2). Swap here once. The host is always dynamic. */
export const FAVICON_CDN_BASE = 'https://www.google.com/s2/favicons';

/** Default favicon edge size (px) when a caller doesn't specify one. */
export const DEFAULT_FAVICON_SIZE = 64;

/** Build the keyless favicon URL for a host. The host is encoded exactly once. */
export function faviconUrl(host: string, size: number = DEFAULT_FAVICON_SIZE): string {
  return `${FAVICON_CDN_BASE}?domain=${encodeURIComponent(host)}&sz=${size}`;
}
