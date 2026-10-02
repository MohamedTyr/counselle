export type TransportErrorKind =
  | "unauthorized"
  | "conflict"
  | "rate_limited"
  | "invalid_edit"
  | "network"
  | "server";

export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  readonly retryAfter?: number;
  readonly status?: number;
  /** The parsed error envelope, when the response carried one. */
  readonly body?: unknown;

  constructor(
    kind: TransportErrorKind,
    message: string,
    options?: { retryAfter?: number; status?: number; cause?: unknown; body?: unknown },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "TransportError";
    this.kind = kind;
    this.retryAfter = options?.retryAfter;
    this.status = options?.status;
    this.body = options?.body;
  }
}

export function isTransportError(error: unknown): error is TransportError {
  return error instanceof TransportError;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) {
    return undefined;
  }
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Every route wraps a raised business error as `{"error": {"message", "trace_id"}}`
 * (`api/deps.py::envelope_error_handler`) — `str(exc)` from the narrow
 * `CdsAdmin*Error`/`WorkspaceNotFoundError`-style families, always already
 * user-safe (a raiser writes it to be shown). Read it here, once, so every
 * caller of `errorFromResponse` gets the server's own specific reason
 * instead of a generic per-status placeholder that's identical no matter
 * which check actually failed. Falls back to `undefined` — never throws —
 * on a body that isn't this envelope (fastapi-users' own `{"detail": ...}`
 * shape on `/auth/*`, a network layer with no body, or anything
 * unparseable), so every existing per-status default below still applies
 * unchanged when there's nothing more specific to say. */
async function readEnvelope(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function envelopeMessage(body: unknown): string | undefined {
  const message = (body as { error?: { message?: unknown } } | null | undefined)?.error?.message;
  return typeof message === "string" && message.trim() ? message : undefined;
}

export async function errorFromResponse(
  response: Response,
): Promise<TransportError> {
  const status = response.status;
  // A response body can be read only once: parse it here and keep it.
  const body = await readEnvelope(response);
  const detail = envelopeMessage(body);
  if (status === 401) {
    return new TransportError("unauthorized", detail ?? "You are not signed in.", {
      status,
      body,
    });
  }
  if (status === 409) {
    return new TransportError(
      "conflict",
      detail ?? "A request is already in progress.",
      { status, body },
    );
  }
  if (status === 429) {
    return new TransportError(
      "rate_limited",
      detail ?? "Too many attempts. Please try again shortly.",
      {
        retryAfter: parseRetryAfter(response.headers.get("Retry-After")),
        status,
        body,
      },
    );
  }
  if (status === 422) {
    return new TransportError("invalid_edit", detail ?? "That request is invalid.", {
      status,
      body,
    });
  }
  return new TransportError("server", detail ?? `The server returned ${status}.`, {
    status,
    body,
  });
}
