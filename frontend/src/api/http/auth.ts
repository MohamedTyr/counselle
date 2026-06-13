/**
 * The real auth client (B5b) — pure functions over `/v1/auth/*` + `/v1/me`.
 *
 * Reuses B5a's transport conventions: `credentials: 'same-origin'` on every
 * request, a local `safeFetch` that surfaces connection failures as a typed
 * `TransportError('network')`, and `errorFromResponse` for status→kind mapping.
 *
 * The session is the httpOnly cookie the backend sets on login/register-then-
 * login/Google-callback; the FE never reads it. `fetchMe()` returns `null` on
 * 401 — "not logged in" is a state, not an error.
 */
import { errorFromResponse, isTransportError, TransportError } from './errors';
import { BASE } from './constants';

/**
 * A 400 from an auth endpoint, carrying the backend's error code so the
 * friendly mapper can branch (bad credentials / existing email / weak
 * password / bad reset token). The transport's `TransportError` collapses
 * every 400 to a generic 'server' kind and drops the body — auth needs the
 * code, so these endpoints throw `AuthError` on 400 instead.
 */
export class AuthError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
  }
}

function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

/** Pull the backend error code from a `{detail}` body: string or `{code}`. */
function extractCode(body: unknown): string {
  if (body !== null && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (detail !== null && typeof detail === 'object' && 'code' in detail) {
      const code = (detail as { code: unknown }).code;
      if (typeof code === 'string') {
        return code;
      }
    }
  }
  return 'UNKNOWN';
}

/**
 * Map a non-ok auth response to an error. A 400 becomes a coded `AuthError`
 * (body parsed); every other status defers to the shared `errorFromResponse`
 * (401/409/429/422/5xx → typed kind).
 */
async function authError(response: Response): Promise<Error> {
  if (response.status === 400) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // No/invalid JSON body — fall through to the UNKNOWN code.
    }
    return new AuthError(extractCode(body));
  }
  return errorFromResponse(response);
}

/** The signed-in user, as returned by `GET /v1/me`. */
export interface MeData {
  id: string;
  name: string;
  email: string;
  has_password: boolean;
  google_connected: boolean;
  settings: UserSettings;
}

/** `users.settings` — a free jsonb bag. `default_source_config` is owned by B5c. */
export interface UserSettings {
  theme?: string;
  default_source_config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ResetInput {
  token: string;
  password: string;
}

export interface PatchMeInput {
  name?: string;
  settings?: UserSettings;
}

/** The PATCH /v1/me response (a subset of MeData). */
interface PatchMeResponse {
  id: string;
  name: string;
  settings: UserSettings;
}

/**
 * How long a short auth/me request may hang before we treat it as a network
 * failure. A half-open server (TCP accepted, no response) would otherwise leave
 * the request pending forever — and the AuthGate spinner with it. SCOPED to the
 * auth client: the SSE stream fetches in `http/transport.ts` (sendMessage /
 * attach) are long-lived and use their own `safeFetch` with NO timeout.
 */
const AUTH_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Wrap a fetch so connection failures surface as a typed 'network' error, and
 * cap it with a 15s timeout (auth/me requests are short — a hang means the
 * server is half-open). The abort lands in the `catch` as a 'network' kind, so
 * the AuthGate's error state renders instead of an infinite spinner.
 */
async function safeFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS) });
  } catch (cause) {
    throw new TransportError('network', 'Could not reach the server.', { cause });
  }
}

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

/** POST /v1/auth/register → 201. Does NOT log in (the caller follows with login). */
export async function register(input: RegisterInput): Promise<void> {
  const response = await safeFetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

/** POST /v1/auth/login — form-encoded (fields `username`,`password`) → 204 + cookie. */
export async function login(input: LoginInput): Promise<void> {
  const form = new URLSearchParams();
  form.set('username', input.email);
  form.set('password', input.password);
  const response = await safeFetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'same-origin',
    body: form.toString(),
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

/** POST /v1/auth/logout → 204, clears the cookie. */
export async function logout(): Promise<void> {
  const response = await safeFetch(`${BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

/** POST /v1/auth/forgot-password → 202 always (no account-existence leak). */
export async function forgotPassword(email: string): Promise<void> {
  const response = await safeFetch(`${BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

/** POST /v1/auth/reset-password → 200. 400 on a bad/expired token. */
export async function resetPassword(input: ResetInput): Promise<void> {
  const response = await safeFetch(`${BASE}/auth/reset-password`, {
    method: 'POST',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

/** GET /v1/me → MeData, or `null` on 401 (the unauthenticated signal). */
export async function fetchMe(): Promise<MeData | null> {
  const response = await safeFetch(`${BASE}/me`, {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw await authError(response);
  }
  return (await response.json()) as MeData;
}

/** PATCH /v1/me → the updated name/settings. */
export async function patchMe(input: PatchMeInput): Promise<PatchMeResponse> {
  const response = await safeFetch(`${BASE}/me`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await authError(response);
  }
  return (await response.json()) as PatchMeResponse;
}

/** DELETE /v1/me → 204 — deletes the account. */
export async function deleteAccount(): Promise<void> {
  const response = await safeFetch(`${BASE}/me`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

/** DELETE /v1/me/chats → 204 — clears chats, keeps the account. */
export async function deleteMyChats(): Promise<void> {
  const response = await safeFetch(`${BASE}/me/chats`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

/** PATCH /v1/auth/users/me → 200 — story 49 password change (fastapi-users router). */
export async function changePassword(newPassword: string): Promise<void> {
  const response = await safeFetch(`${BASE}/auth/users/me`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    credentials: 'same-origin',
    body: JSON.stringify({ password: newPassword }),
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

interface GoogleAuthorizeResponse {
  authorization_url: string;
}

/** GET /v1/auth/google/authorize → the URL the browser redirects to for consent. */
export async function googleAuthorizeUrl(): Promise<string> {
  const response = await safeFetch(`${BASE}/auth/google/authorize`, {
    method: 'GET',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw await authError(response);
  }
  const json = (await response.json()) as GoogleAuthorizeResponse;
  return json.authorization_url;
}

/** Friendly message for a coded 400 (the auth-specific failures). */
function messageForCode(code: string): string {
  switch (code) {
    case 'LOGIN_BAD_CREDENTIALS':
      return 'Incorrect email or password.';
    case 'REGISTER_USER_ALREADY_EXISTS':
      return 'An account with that email already exists.';
    case 'REGISTER_INVALID_PASSWORD':
    case 'UPDATE_USER_INVALID_PASSWORD':
      return 'Password must be at least 8 characters.';
    case 'RESET_PASSWORD_BAD_TOKEN':
    case 'RESET_PASSWORD_INVALID_PASSWORD':
      return 'That reset link is invalid or expired.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/**
 * Map a thrown error to a friendly, inline message for auth surfaces.
 * Coded 400s (bad credentials / existing email / weak password / bad reset
 * token) arrive as `AuthError`; transport-kinded failures (429/network/server)
 * arrive as `TransportError`; everything else gets a safe default.
 */
export function authErrorMessage(error: unknown): string {
  if (isAuthError(error)) {
    return messageForCode(error.code);
  }
  if (isTransportError(error)) {
    if (error.kind === 'rate_limited') {
      const seconds = error.retryAfter;
      return seconds !== undefined
        ? `Too many attempts — try again in ${seconds} seconds.`
        : 'Too many attempts — please wait a moment and try again.';
    }
    if (error.kind === 'network') {
      return 'Could not reach the server. Check your connection and try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}
