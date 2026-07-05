export type TransportErrorKind =
  | "unauthorized"
  | "conflict"
  | "rate_limited"
  | "invalid_edit"
  | "network"
  | "server"

export class TransportError extends Error {
  readonly kind: TransportErrorKind
  readonly retryAfter?: number
  readonly status?: number

  constructor(
    kind: TransportErrorKind,
    message: string,
    options?: { retryAfter?: number; status?: number; cause?: unknown },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    )
    this.name = "TransportError"
    this.kind = kind
    this.retryAfter = options?.retryAfter
    this.status = options?.status
  }
}

export function isTransportError(error: unknown): error is TransportError {
  return error instanceof TransportError
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) {
    return undefined
  }
  const seconds = Number.parseInt(header, 10)
  return Number.isFinite(seconds) ? seconds : undefined
}

export async function errorFromResponse(
  response: Response,
): Promise<TransportError> {
  const status = response.status
  if (status === 401) {
    return new TransportError("unauthorized", "You are not signed in.", {
      status,
    })
  }
  if (status === 409) {
    return new TransportError("conflict", "A request is already in progress.", {
      status,
    })
  }
  if (status === 429) {
    return new TransportError(
      "rate_limited",
      "Too many attempts. Please try again shortly.",
      { retryAfter: parseRetryAfter(response.headers.get("Retry-After")), status },
    )
  }
  if (status === 422) {
    return new TransportError("invalid_edit", "That request is invalid.", {
      status,
    })
  }
  return new TransportError("server", `The server returned ${status}.`, {
    status,
  })
}
