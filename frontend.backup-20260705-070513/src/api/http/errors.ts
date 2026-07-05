/**
 * Typed transport errors (B5a) — ChatContext branches on `kind`.
 *
 * The HTTP transport maps backend status codes to a discriminated `kind`:
 *   401 → 'unauthorized' (B5b builds login; B5a surfaces it)
 *   409 → 'conflict'     (a turn already streaming for this session — single-flight)
 *   429 → 'rate_limited' (carries `retryAfter` seconds from the Retry-After header)
 *   422 → 'invalid_edit' (bad replace_message_id)
 *   5xx → 'server'
 *   fetch/stream failure → 'network'
 */

export type TransportErrorKind =
  | 'unauthorized'
  | 'conflict'
  | 'rate_limited'
  | 'invalid_edit'
  | 'network'
  | 'server';

export class TransportError extends Error {
  readonly kind: TransportErrorKind;
  /** Seconds to wait, parsed from Retry-After on a 429. */
  readonly retryAfter?: number;
  /** The HTTP status, when the failure was a non-ok response. */
  readonly status?: number;

  constructor(
    kind: TransportErrorKind,
    message: string,
    options?: { retryAfter?: number; status?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'TransportError';
    this.kind = kind;
    this.retryAfter = options?.retryAfter;
    this.status = options?.status;
  }
}

export function isTransportError(error: unknown): error is TransportError {
  return error instanceof TransportError;
}

/** Parse `Retry-After` (seconds form only — the backend sends an integer). */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) {
    return undefined;
  }
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** Build a TransportError from a non-ok Response (status → kind). */
export async function errorFromResponse(response: Response): Promise<TransportError> {
  const status = response.status;
  if (status === 401) {
    return new TransportError('unauthorized', 'You are not signed in.', { status });
  }
  if (status === 409) {
    return new TransportError('conflict', 'A response is already in progress.', { status });
  }
  if (status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
    return new TransportError('rate_limited', 'You are sending messages too quickly.', {
      status,
      retryAfter,
    });
  }
  if (status === 422) {
    return new TransportError('invalid_edit', 'That message can no longer be edited.', { status });
  }
  return new TransportError('server', `The server returned an error (${status}).`, { status });
}
