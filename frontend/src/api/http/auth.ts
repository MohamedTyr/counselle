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
  if (response.status === 400) {
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

export async function logout(): Promise<void> {
  const response = await safeFetch("/auth/logout", {
    method: "POST",
  });
  if (!response.ok) {
    throw await authError(response);
  }
}

function messageForCode(code: string): string {
  switch (code) {
    case "LOGIN_BAD_CREDENTIALS":
      return "Incorrect email or password.";
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
