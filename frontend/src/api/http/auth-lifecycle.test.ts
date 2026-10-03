import {
  authAction,
  authErrorMessage,
  AuthError,
  googleAuthorization,
  requestEmailReauthentication,
  confirmEmailReauthentication,
  reauthenticate,
  changePassword,
  changeEmail,
  updateName,
  deleteAccount,
  logoutAll,
  verifyEmail,
} from "./auth";
import { emptyResponse, jsonResponse } from "@/test/render-app";

describe("auth security API", () => {
  it("preserves recent-auth 403 details for the identity-confirmation UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({ detail: "REAUTHENTICATION_REQUIRED" }, { status: 403 }),
      ),
    );
    await expect(
      authAction("/auth/password", { password: "new-secret" }),
    ).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    expect(
      authErrorMessage(new AuthError("REAUTHENTICATION_REQUIRED")),
    ).toContain("Confirm your identity");
  });
  it("encodes an internal Google destination without dropping query or hash", async () => {
    const mock = vi.fn(() =>
      jsonResponse({
        authorization_url:
          "https://accounts.google.com/o/oauth2/v2/auth?state=state",
      }),
    );
    vi.stubGlobal("fetch", mock);
    await googleAuthorization("associate", "/account?from=security#google");
    expect(mock).toHaveBeenCalledWith(
      "/v1/auth/google/associate/authorize?next=%2Faccount%3Ffrom%3Dsecurity%23google",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
  it.each([
    "javascript:alert(1)",
    "https://accounts.google.com.attacker.test/login",
    "https://attacker.test",
  ])("rejects unexpected authorization URL %s", async (url) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ authorization_url: url })),
    );
    await expect(googleAuthorization("login", "/app/ai")).rejects.toMatchObject(
      { code: "INVALID_AUTHORIZATION_URL" },
    );
  });
  it("confirms emailed reauthentication using the current browser cookie", async () => {
    const mock = vi.fn(() => emptyResponse());
    vi.stubGlobal("fetch", mock);
    await requestEmailReauthentication();
    await confirmEmailReauthentication("single-use-token");
    expect(mock).toHaveBeenLastCalledWith(
      "/v1/auth/reauthenticate/email/confirm",
      expect.objectContaining({
        credentials: "same-origin",
        body: JSON.stringify({ token: "single-use-token" }),
      }),
    );
  });
});

it("binds sensitive account requests to the displayed account", async () => {
  const mock = vi.fn(() => emptyResponse());
  vi.stubGlobal("fetch", mock);
  const ownerId = "00000000-0000-4000-8000-000000000001";
  await reauthenticate("password", ownerId);
  await changePassword("password", ownerId);
  await changeEmail("new@example.com", ownerId);
  await updateName("Student", ownerId);
  await deleteAccount(ownerId);
  await logoutAll(ownerId);
  await requestEmailReauthentication(ownerId);
  await confirmEmailReauthentication("token", ownerId);
  for (const [, init] of mock.mock.calls as unknown as [
    string,
    RequestInit,
  ][]) {
    expect(new Headers(init.headers).get("X-Expected-User-Id")).toBe(ownerId);
  }
});

it("binds Google linking authorization to the displayed account", async () => {
  const mock = vi.fn(() =>
    jsonResponse({
      authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
    }),
  );
  vi.stubGlobal("fetch", mock);
  await googleAuthorization("associate", "/account", "owner-a");
  expect(mock).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      headers: expect.objectContaining({ "X-Expected-User-Id": "owner-a" }),
    }),
  );
});

it("preserves the identity confirmed by email verification", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      jsonResponse({
        id: "owner-a",
        email: "a@example.com",
        is_verified: true,
      }),
    ),
  );
  await expect(verifyEmail("token")).resolves.toEqual({
    id: "owner-a",
    email: "a@example.com",
  });
});
