import { DEFAULT_REQUEST_TIMEOUT_MS } from "@/config";
import { BASE } from "@/api/http/constants";
import { errorFromResponse, TransportError } from "@/api/http/errors";

function withBase(path: string) {
  if (path.startsWith(BASE)) {
    return path;
  }
  return `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/** `timeoutMs` defaults to `DEFAULT_REQUEST_TIMEOUT_MS` — callers whose
 * endpoint legitimately runs long server-side (e.g. CDS admin uploads/
 * approve) should pass their own so a slow-but-successful request never
 * gets client-aborted and mistaken for a failure. */
export async function safeFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(withBase(path), {
      ...init,
      credentials: "same-origin",
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new TransportError("network", "Could not reach the server.", {
      cause,
    });
  }
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const response = await safeFetch(path, init, timeoutMs);
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function requestVoid(
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<void> {
  const response = await safeFetch(path, init, timeoutMs);
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
}

export function jsonRequestInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
