// POST /api/waitlist: stores one waitlist signup in D1. A repeat email is an
// update under the rule in UPSERT, and new and repeat emails get the same
// response, so the endpoint never reveals who is on the list.

import { SITE_HOST } from "../../src/features/landing/brand";
import {
  CLASS_YEARS,
  emailShape,
  PLAN_IDS,
  ROLES,
  SIDES,
  SOURCES,
  UTM_KEYS,
} from "../../src/features/landing/waitlist/contract";

type Env = { DB: D1Database };

const MAX_BODY_BYTES = 2048;
const UTM_SHAPE = /^[\w\-.~ ]{1,100}$/;
/** Production, plus wrangler pages dev. Previews share the production D1. */
const WRITE_HOSTS = [SITE_HOST, "localhost", "127.0.0.1"];
/** _headers never applies to Functions, so every reply carries its own. */
const REPLY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

/**
 * Same side: fill answers in, never replace one with null. Side changed: take
 * the new side's answers and drop the old side's. source, plan, utm_* and
 * created_at are first-touch and never change. Pinned by
 * src/features/landing/waitlist/upsert.test.ts.
 */
export const UPSERT = `
INSERT INTO waitlist (email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
ON CONFLICT (email) DO UPDATE SET
  role       = CASE WHEN excluded.side <> waitlist.side THEN excluded.role
                    ELSE COALESCE(excluded.role, waitlist.role) END,
  class_of   = CASE WHEN excluded.side <> waitlist.side THEN excluded.class_of
                    ELSE COALESCE(excluded.class_of, waitlist.class_of) END,
  side       = excluded.side,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

type Signup = {
  email: string;
  side: string;
  source: string;
  plan: string | null;
  role: string | null;
  classOf: string | null;
  utm: (string | null)[];
};

class Invalid extends Error {}

function reply(status: number, body: object, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { ...REPLY_HEADERS, ...headers },
  });
}

function fail(status: number, error: string, headers?: HeadersInit) {
  return reply(status, { ok: false, error }, headers);
}

function normaliseEmail(value: unknown): string {
  if (typeof value !== "string") throw new Invalid("email");
  const email = value.trim().normalize("NFC").toLowerCase();
  if (!emailShape(email)) throw new Invalid("email");
  return email;
}

/** A required value from a fixed list. */
function oneOf(
  value: unknown,
  allowed: readonly string[],
  field: string,
): string {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new Invalid(field);
  return value;
}

/** An optional value from a fixed list: absent is null, anything else must fit. */
function optionalOneOf(
  value: unknown,
  allowed: readonly string[],
  field: string,
) {
  return value === undefined || value === null
    ? null
    : oneOf(value, allowed, field);
}

/** A mangled campaign tag is dropped, never a reason to lose the signup. */
function utm(value: unknown): string | null {
  return typeof value === "string" && UTM_SHAPE.test(value) ? value : null;
}

function parseSignup(text: string): Signup {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Invalid("body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new Invalid("body");
  const fields = body as Record<string, unknown>;
  return {
    email: normaliseEmail(fields.email),
    side: oneOf(fields.side, SIDES, "side"),
    source: oneOf(fields.source, SOURCES, "source"),
    plan: optionalOneOf(fields.plan, PLAN_IDS, "plan"),
    role: optionalOneOf(fields.role, ROLES, "role"),
    classOf: optionalOneOf(fields.classOf, CLASS_YEARS, "classOf"),
    utm: UTM_KEYS.map((key) => utm(fields[key])),
  };
}

/** The request's checks before its body is trusted, or null when it passes. */
function rejectRequest(request: Request): Response | null {
  if (request.method !== "POST")
    return fail(405, "method not allowed", { Allow: "POST" });
  const url = new URL(request.url);
  if (
    !WRITE_HOSTS.includes(url.hostname) ||
    request.headers.get("Origin") !== url.origin
  )
    return fail(403, "forbidden");
  const type = request.headers.get("Content-Type") ?? "";
  if (type.split(";")[0].trim().toLowerCase() !== "application/json")
    return fail(415, "expected application/json");
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES)
    return fail(413, "too large");
  return null;
}

/** An error's code for the log, never its message: that can carry the email. */
function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const code = message.match(/\b(?:D1|SQLITE)_[A-Z_]+\b/)?.[0];
  return code ?? (error instanceof Error ? error.name : "unknown");
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const rejected = rejectRequest(request);
  if (rejected) return rejected;
  const text = await request.text();
  // A chunked body has no Content-Length, so measure what actually arrived.
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)
    return fail(413, "too large");

  let signup: Signup;
  try {
    signup = parseSignup(text);
  } catch (error) {
    if (error instanceof Invalid) return fail(400, `invalid ${error.message}`);
    throw error;
  }

  const { email, side, plan, role, classOf } = signup;
  try {
    await env.DB.prepare(UPSERT)
      .bind(email, side, signup.source, plan, role, classOf, ...signup.utm)
      .run();
  } catch (error) {
    console.error(`waitlist: write failed (${errorCode(error)})`);
    return fail(503, "unavailable");
  }
  return reply(200, { ok: true });
};
