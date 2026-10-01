// Every /admin, /admin/ and /admin/api/* request passes through here first.
// Cloudflare Access guards acceptra.ai/admin, but *.pages.dev and every
// preview serve these same Functions with the production D1 bound, so this
// check never relies on Access: it verifies the Access JWT itself and checks
// the email against ADMIN_EMAILS.

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { SITE_HOST } from "../../src/features/landing/brand";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  ADMIN_DEV_EMAIL?: string;
};
export type AdminData = { adminEmail: string };
type Deny = "config" | "host" | "token" | "jwt" | "email";
type Decision = { ok: true; email: string } | { ok: false; reason: Deny };
type Verify = (token: string) => Promise<JWTPayload>;

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/** _headers is not documented to reach responses that pass through a
 * Function, so the middleware sets every one itself. */
const ADMIN_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
};

export function makeVerify(env: Env, keys: JWTVerifyGetKey): Verify {
  return async (token) =>
    (
      await jwtVerify(token, keys, {
        issuer: env.ACCESS_TEAM_DOMAIN,
        audience: env.ACCESS_AUD,
        algorithms: ["RS256"],
      })
    ).payload;
}

function allowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** jose skips the issuer and audience checks when given an empty string, so
 * an incomplete config must fail closed before any token is verified. */
function configured(env: Env): boolean {
  return (
    (env.ACCESS_TEAM_DOMAIN ?? "").startsWith("https://") &&
    Boolean(env.ACCESS_AUD) &&
    allowlist(env.ADMIN_EMAILS).length > 0
  );
}

/** Who may see /admin. The first failing step decides the reason. */
export async function authorize(
  url: URL,
  headers: Headers,
  env: Env,
  verify: Verify,
): Promise<Decision> {
  if (LOCAL_HOSTS.includes(url.hostname) && env.ADMIN_DEV_EMAIL)
    return { ok: true, email: env.ADMIN_DEV_EMAIL.toLowerCase() };
  if (url.hostname !== SITE_HOST) return { ok: false, reason: "host" };
  if (!configured(env)) return { ok: false, reason: "config" };
  const token = headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, reason: "token" };

  let payload: JWTPayload;
  try {
    payload = await verify(token);
  } catch {
    return { ok: false, reason: "jwt" };
  }
  // A service token's JWT carries common_name, not email.
  const email = payload.email;
  if (typeof email !== "string") return { ok: false, reason: "email" };
  const normalised = email.toLowerCase();
  if (!allowlist(env.ADMIN_EMAILS).includes(normalised))
    return { ok: false, reason: "email" };
  return { ok: true, email: normalised };
}

let jwks: { domain: string; keys: JWTVerifyGetKey } | undefined;

/** Built on first use, since a Pages Function only sees env in a handler.
 * jose caches the keys per isolate and refetches on an unknown kid. */
function remoteKeys(domain: string): JWTVerifyGetKey {
  if (jwks?.domain !== domain)
    jwks = {
      domain,
      keys: createRemoteJWKSet(new URL("/cdn-cgi/access/certs", domain)),
    };
  return jwks.keys;
}

function withAdminHeaders(response: Response): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(ADMIN_HEADERS))
    copy.headers.set(name, value);
  copy.headers.delete("Access-Control-Allow-Origin");
  return copy;
}

/** The same 404 any unknown path gets, so a denied request learns nothing. */
async function notFound(env: Env, url: URL): Promise<Response> {
  const page = await env.ASSETS.fetch(new URL("/404.html", url));
  return withAdminHeaders(
    new Response(page.body, { status: 404, headers: page.headers }),
  );
}

export const onRequest: PagesFunction<Env, string, AdminData> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const verify = makeVerify(env, (...args) =>
    remoteKeys(env.ACCESS_TEAM_DOMAIN)(...args),
  );
  const decision = await authorize(url, request.headers, env, verify);
  if (!decision.ok) {
    console.warn(`admin: denied (${decision.reason})`);
    return notFound(env, url);
  }
  ctx.data.adminEmail = decision.email;
  return withAdminHeaders(await ctx.next());
};
