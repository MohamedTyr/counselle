// /ingest/*: a same-origin proxy to PostHog, so ad blockers that hide
// *.posthog.com don't hide the visit. Built from PostHog's Cloudflare proxy
// doc (posthog.com/docs/advanced/proxy/cloudflare); recheck the upstream
// hosts and asset paths there if events stop arriving.

const API_HOST = "us.i.posthog.com";
const ASSET_HOST = "us-assets.i.posthog.com";
const PREFIX = "/ingest";
const ALLOWED_METHODS = ["GET", "POST", "OPTIONS"];

function isAsset(path: string): boolean {
  return path.startsWith("/static/") || path.startsWith("/array/");
}

async function retrieveAsset(
  request: Request,
  upstream: string,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const cached = await caches.default.match(request);
  if (cached) return cached;
  const response = await fetch(upstream);
  if (response.ok) waitUntil(caches.default.put(request, response.clone()));
  return response;
}

async function forward(request: Request, upstream: string): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("authorization");
  // PostHog works out the visitor's location from this.
  headers.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") ?? "");
  const body = request.method === "POST" ? await request.arrayBuffer() : null;
  return fetch(upstream, { method: request.method, headers, body });
}

export const onRequest: PagesFunction = async ({ request, waitUntil }) => {
  if (!ALLOWED_METHODS.includes(request.method))
    return new Response(null, {
      status: 405,
      headers: { Allow: ALLOWED_METHODS.join(", ") },
    });
  const url = new URL(request.url);
  const path = url.pathname.slice(PREFIX.length) || "/";
  const host = isAsset(path) ? ASSET_HOST : API_HOST;
  const upstream = `https://${host}${path}${url.search}`;
  if (isAsset(path) && request.method === "GET")
    return retrieveAsset(request, upstream, waitUntil);
  return forward(request, upstream);
};
