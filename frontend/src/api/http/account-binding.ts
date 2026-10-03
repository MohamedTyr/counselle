/** The app binds its displayed account here before mounting private children.
 * Keeping this module independent of React and query caches avoids an auth /
 * transport import cycle. Each browser tab has its own binding.
 */
type AccountBinding = {
  owner: () => string | null | undefined;
  changed: () => void;
};
let binding: AccountBinding | undefined;

export function bindHttpAccount(
  owner: AccountBinding["owner"],
  changed: AccountBinding["changed"],
) {
  const current = { owner, changed };
  binding = current;
  return () => {
    if (binding === current) binding = undefined;
  };
}

const publicAuthPaths = new Set([
  "/v1/auth/login",
  "/v1/auth/register",
  "/v1/auth/forgot-password",
  "/v1/auth/reset-password",
  "/v1/auth/request-verify-token",
  "/v1/auth/verify",
  "/v1/auth/email/confirm",
  "/v1/auth/google/authorize",
  "/v1/auth/google/callback",
]);

function privateRequest(url: URL, method: string) {
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/v1/"))
    return false;
  if (url.pathname === "/v1/me" && method === "GET") return false;
  if (url.pathname === "/v1/config/public") return false;
  return !publicAuthPaths.has(url.pathname);
}

/** Explicit headers are captured by a caller and must never be replaced with a
 * newer identity. Implicit headers protect ordinary private reads and writes.
 */
export async function accountBoundFetch(path: string, init: RequestInit = {}) {
  const requestBinding = binding;
  const url = new URL(path, window.location.origin);
  const explicitOwner = new Headers(init.headers).get("X-Expected-User-Id");
  const owner =
    explicitOwner ??
    (requestBinding && privateRequest(url, (init.method ?? "GET").toUpperCase())
      ? (requestBinding.owner() ?? "signed-out")
      : undefined);
  const headers =
    init.headers instanceof Headers || Array.isArray(init.headers)
      ? Object.fromEntries(new Headers(init.headers).entries())
      : init.headers;
  const response = await fetch(path, {
    ...init,
    ...(owner && !explicitOwner
      ? { headers: { ...headers, "X-Expected-User-Id": owner } }
      : {}),
  });
  if (
    response.status === 409 &&
    requestBinding &&
    owner &&
    url.origin === window.location.origin &&
    binding === requestBinding
  ) {
    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      return response;
    }
    if (
      payload &&
      typeof payload === "object" &&
      "detail" in payload &&
      payload.detail === "ACCOUNT_CHANGED"
    ) {
      requestBinding.changed();
    }
  }
  return response;
}

/** Native EventSource cannot send headers; its one endpoint accepts this UUID. */
export function accountBoundEventUrl(path: string) {
  const url = new URL(path, window.location.origin);
  if (
    !binding ||
    url.origin !== window.location.origin ||
    url.pathname !== "/v1/workspace/events"
  )
    return path;
  if (!url.searchParams.has("expected_user_id"))
    url.searchParams.set("expected_user_id", binding.owner() ?? "signed-out");
  return `${url.pathname}${url.search}${url.hash}`;
}
