import { safeFetch } from "@/api/http/client";
import { errorFromResponse, isTransportError } from "@/api/http/errors";

export class AuthError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "AuthError";
    this.code = code;
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export interface MeData {
  id: string;
  name: string | null;
  email: string;
  is_verified: boolean;
  pending_email: string | null;
  reauthentication_required: boolean;
  has_password: boolean;
  google_connected: boolean;
  settings: UserSettings;
  is_superuser: boolean;
}

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

const JSON_HEADERS = { "Content-Type": "application/json" };

function extractCode(body: unknown): string {
  if (body !== null && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (detail !== null && typeof detail === "object" && "code" in detail) {
      const code = (detail as { code: unknown }).code;
      if (typeof code === "string") {
        return code;
      }
    }
  }
  return "UNKNOWN";
}

async function authError(response: Response): Promise<Error> {
  if (
    response.status === 400 ||
    response.status === 403 ||
    response.status === 409
  ) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Keep UNKNOWN when the backend does not return parseable JSON.
    }
    return new AuthError(extractCode(body));
  }
  return errorFromResponse(response);
}

export async function fetchMe(): Promise<MeData | null> {
  const response = await safeFetch("/me", {
    method: "GET",
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw await authError(response);
  }
  return (await response.json()) as MeData;
}

export async function login(input: LoginInput): Promise<void> {
  const form = new URLSearchParams();
  form.set("username", input.email);
  form.set("password", input.password);

  const response = await safeFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

export async function register(input: RegisterInput): Promise<void> {
  const response = await safeFetch("/auth/register", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

export async function logout(expectedUserId?: string): Promise<void> {
  const response = await safeFetch("/auth/logout", {
    method: "POST",
    headers: expectedUserHeaders(expectedUserId),
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

function messageForCode(code: string): string {
  switch (code) {
    case "LOGIN_BAD_CREDENTIALS":
      return "Incorrect email or password.";
    case "REAUTHENTICATION_REQUIRED":
    case "RECENT_AUTH_REQUIRED":
      return "Confirm your identity below, then try again.";
    case "ACCOUNT_CHANGED":
      return "Your signed-in account changed in another tab. Review the account details before trying again.";
    case "EMAIL_NOT_VERIFIED":
      return "Verify your email to continue.";
    case "INVALID_REAUTHENTICATION_TOKEN":
      return "This link expired, was already used, or belongs to another browser. Request a new link in account settings.";
    case "INVALID_EMAIL_CHANGE_TOKEN":
    case "INVALID_OR_EXPIRED_TOKEN":
    case "RESET_PASSWORD_BAD_TOKEN":
    case "VERIFY_USER_BAD_TOKEN":
      return "This link has expired or already been used. Request a new link below.";
    case "VERIFY_USER_ALREADY_VERIFIED":
      return "This email is already verified. You can continue to log in.";
    case "EMAIL_UNCHANGED":
      return "Enter a different email address.";
    case "EMAIL_UNAVAILABLE":
    case "EMAIL_ALREADY_EXISTS":
    case "UPDATE_USER_EMAIL_ALREADY_EXISTS":
      return "That email cannot be used. Try another address or contact support.";
    case "REAUTHENTICATION_FAILED":
      return "Incorrect password. Please try again.";
    case "INVALID_PASSWORD":
      return "Check your password and try again. New passwords must use 8–128 characters.";
    case "GOOGLE_REAUTHENTICATION_REQUIRED":
      return "Use Google or email to confirm your identity.";
    case "REGISTER_USER_ALREADY_EXISTS":
      return "An account with that email already exists.";
    case "REGISTER_INVALID_PASSWORD":
    case "UPDATE_USER_INVALID_PASSWORD":
      return "Password must be at least 8 characters.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export function authErrorMessage(error: unknown): string {
  if (isAuthError(error)) {
    return messageForCode(error.code);
  }
  if (isTransportError(error)) {
    if (error.kind === "unauthorized")
      return "Your session expired. Log in again to continue.";
    if (error.kind === "rate_limited") {
      return error.retryAfter !== undefined
        ? `Too many attempts. Try again in ${error.retryAfter} seconds.`
        : "Too many attempts. Please wait a moment and try again.";
    }
    if (error.kind === "network") {
      return "Could not reach the server. Check your connection and try again.";
    }
  }
  return "Something went wrong. Please try again.";
}

/** Security actions share typed auth errors, including recent-auth 403s. */
export async function authAction(
  path: string,
  body?: unknown,
  method = "POST",
  expectedUserId?: string,
): Promise<void> {
  const response = await safeFetch(path, {
    method,
    headers: { ...JSON_HEADERS, ...expectedUserHeaders(expectedUserId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await authError(response);
}

export const forgotPassword = (email: string) =>
  authAction("/auth/forgot-password", { email });
export const resetPassword = (token: string, password: string) =>
  authAction("/auth/reset-password", { token, password });
export const requestVerification = (email: string) =>
  authAction("/auth/request-verify-token", { email });
export async function verifyEmail(
  token: string,
): Promise<Pick<MeData, "id" | "email">> {
  const response = await safeFetch("/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw await authError(response);
  const user: unknown = await response.json();
  if (
    !user ||
    typeof user !== "object" ||
    !("id" in user) ||
    typeof user.id !== "string" ||
    !("email" in user) ||
    typeof user.email !== "string"
  ) {
    throw new AuthError("INVALID_VERIFICATION_RESPONSE");
  }
  return { id: user.id, email: user.email };
}
export const confirmEmail = (token: string) =>
  authAction("/auth/email/confirm", { token });
function expectedUserHeaders(expectedUserId?: string): Record<string, string> {
  return expectedUserId ? { "X-Expected-User-Id": expectedUserId } : {};
}
export const reauthenticate = (password: string, expectedUserId?: string) =>
  authAction("/auth/reauthenticate", { password }, "POST", expectedUserId);
export const changePassword = (password: string, expectedUserId?: string) =>
  authAction("/auth/password", { password }, "POST", expectedUserId);
export const changeEmail = (email: string, expectedUserId?: string) =>
  authAction("/auth/email/change", { email }, "POST", expectedUserId);
export const updateName = (name: string, expectedUserId?: string) =>
  authAction("/me", { name }, "PATCH", expectedUserId);
export const logoutAll = (expectedUserId?: string) =>
  authAction("/auth/logout-all", undefined, "POST", expectedUserId);
export const deleteAccount = (expectedUserId?: string) =>
  authAction("/me", undefined, "DELETE", expectedUserId);

export type GoogleMode = "login" | "associate" | "reauth";
export async function googleAuthorization(
  mode: GoogleMode,
  next: string,
  expectedUserId?: string,
): Promise<string> {
  const suffix = mode === "login" ? "" : `/${mode}`;
  const response = await safeFetch(
    `/auth/google${suffix}/authorize?${new URLSearchParams({ next })}`,
    { headers: expectedUserHeaders(expectedUserId) },
  );
  if (!response.ok) throw await authError(response);
  const body: unknown = await response.json();
  const url =
    body && typeof body === "object" && "authorization_url" in body
      ? body.authorization_url
      : undefined;
  if (
    typeof url !== "string" ||
    new URL(url).origin !== "https://accounts.google.com"
  ) {
    throw new AuthError("INVALID_AUTHORIZATION_URL");
  }
  return url;
}
export const requestEmailReauthentication = (expectedUserId?: string) =>
  authAction("/auth/reauthenticate/email", undefined, "POST", expectedUserId);
export const confirmEmailReauthentication = (
  token: string,
  expectedUserId?: string,
) =>
  authAction(
    "/auth/reauthenticate/email/confirm",
    { token },
    "POST",
    expectedUserId,
  );
