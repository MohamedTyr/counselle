// The JSON envelope and error logging the waitlist's Pages Functions share.
// Import-free: the Functions import it by relative path.

/** _headers never applies to Functions, so every reply carries its own. */
const REPLY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

export function reply(status: number, body: object, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { ...REPLY_HEADERS, ...headers },
  });
}

export function fail(status: number, error: string, headers?: HeadersInit) {
  return reply(status, { ok: false, error }, headers);
}

/** An error's code for the log, never its message: that can carry the email. */
export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const code = message.match(/\b(?:D1|SQLITE)_[A-Z_]+\b/)?.[0];
  return code ?? (error instanceof Error ? error.name : "unknown");
}
