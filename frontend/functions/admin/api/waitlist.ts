// /admin/api/waitlist: the whole list for the admin page (GET) and the
// deletion of one signup on request (DELETE). _middleware.ts has already
// checked who is asking; nothing here runs for anyone else.

import { emailShape } from "../../../src/features/landing/waitlist/contract";
import {
  errorCode,
  fail,
  reply,
} from "../../../src/features/landing/waitlist/http";
import type { AdminData, Env } from "../_middleware";

export const LIST = `SELECT email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign, created_at, updated_at
  FROM waitlist ORDER BY created_at DESC LIMIT ?1`;
export const COUNT = `SELECT count(*) AS total FROM waitlist`;
export const DELETE_ONE = `DELETE FROM waitlist WHERE email = ?1`;

/** Past this the page says so and the counts still come from COUNT. */
const MAX_ROWS = 10_000;
const MAX_DELETE_BYTES = 512;

type Handler = PagesFunction<Env, string, AdminData>;

async function list(db: D1Database): Promise<Response> {
  const [count, rows] = await db.batch([
    db.prepare(COUNT),
    db.prepare(LIST).bind(MAX_ROWS),
  ]);
  const total = (count.results[0] as { total: number }).total;
  return reply(200, {
    ok: true,
    rows: rows.results,
    total,
    capped: total > rows.results.length,
  });
}

/** The DELETE's checks before its body is trusted, or null when it passes. */
function rejectDelete(request: Request, url: URL): Response | null {
  if (request.headers.get("Origin") !== url.origin)
    return fail(403, "forbidden");
  const type = request.headers.get("Content-Type") ?? "";
  if (type.split(";")[0].trim().toLowerCase() !== "application/json")
    return fail(415, "expected application/json");
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_DELETE_BYTES)
    return fail(413, "too large");
  return null;
}

/** The email exactly as stored: the page sends back the key it was given. */
function parseEmail(text: string): string | null {
  try {
    const body: unknown = JSON.parse(text);
    const email = (body as { email?: unknown } | null)?.email;
    return typeof email === "string" && emailShape(email) ? email : null;
  } catch {
    return null;
  }
}

async function remove(
  request: Request,
  db: D1Database,
  admin: string,
): Promise<Response> {
  const rejected = rejectDelete(request, new URL(request.url));
  if (rejected) return rejected;
  const text = await request.text();
  // A chunked body has no Content-Length, so measure what actually arrived.
  if (new TextEncoder().encode(text).length > MAX_DELETE_BYTES)
    return fail(413, "too large");
  const email = parseEmail(text);
  if (!email) return fail(400, "invalid email");

  const { meta } = await db.prepare(DELETE_ONE).bind(email).run();
  console.log(`admin: deleted ${meta.changes} row(s) by ${admin}`);
  return reply(200, { ok: true, deleted: meta.changes });
}

export const onRequest: Handler = async ({ request, env, data }) => {
  try {
    if (request.method === "GET") return await list(env.DB);
    if (request.method === "DELETE")
      return await remove(request, env.DB, data.adminEmail);
  } catch (error) {
    console.error(`admin: waitlist query failed (${errorCode(error)})`);
    return fail(503, "unavailable");
  }
  return fail(405, "method not allowed", { Allow: "GET, DELETE" });
};
