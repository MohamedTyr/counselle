import {
  authErrorMessage,
  fetchMe,
  login,
  logout,
  register,
} from "@/api/http/auth";
import { TransportError } from "@/api/http/errors";
import {
  authUserFixture,
  emptyResponse,
  jsonResponse,
} from "@/test/render-app";

describe("auth http client", () => {
  it("fetchMe returns the signed-in user on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(authUserFixture)),
    );

    await expect(fetchMe()).resolves.toEqual(authUserFixture);
  });

  it("fetchMe returns null on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({}, { status: 401 })),
    );

    await expect(fetchMe()).resolves.toBeNull();
  });

  it("fetchMe throws a typed network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("failed"))),
    );

    await expect(fetchMe()).rejects.toMatchObject({ kind: "network" });
  });

  it("login sends form-encoded username and password", async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return emptyResponse();
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await login({ email: "ada@example.com", password: "  exact password  " });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(String(init?.body)).toBe(
      "username=ada%40example.com&password=++exact+password++",
    );
  });

  it("register sends JSON with credentials", async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return jsonResponse({}, { status: 201 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await register({
      email: "ada@example.com",
      name: "Ada",
      password: "password123",
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "ada@example.com",
      name: "Ada",
      password: "password123",
    });
  });

  it("logout sends credentials", async () => {
    const fetchMock = vi.fn(() => emptyResponse());
    vi.stubGlobal("fetch", fetchMock);

    await logout();

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/auth/logout",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST",
      }),
    );
  });

  it("extracts auth codes from string and object detail bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ detail: "LOGIN_BAD_CREDENTIALS" }, { status: 400 }),
        )
        .mockResolvedValueOnce(
          jsonResponse(
            { detail: { code: "REGISTER_INVALID_PASSWORD" } },
            { status: 400 },
          ),
        ),
    );

    await expect(
      login({ email: "ada@example.com", password: "wrong-password" }),
    ).rejects.toMatchObject({ code: "LOGIN_BAD_CREDENTIALS" });
    await expect(
      register({
        email: "ada@example.com",
        name: "Ada",
        password: "short",
      }),
    ).rejects.toMatchObject({ code: "REGISTER_INVALID_PASSWORD" });
  });

  it("maps friendly auth error messages", () => {
    expect(
      authErrorMessage(
        new TransportError("rate_limited", "slow", { retryAfter: 9 }),
      ),
    ).toBe("Too many attempts. Try again in 9 seconds.");
    expect(authErrorMessage(new TransportError("network", "offline"))).toBe(
      "Could not reach the server. Check your connection and try again.",
    );
  });

  it("maps 429 responses for auth endpoints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({}, { headers: { "Retry-After": "12" }, status: 429 }),
      ),
    );

    await expect(
      login({ email: "ada@example.com", password: "password123" }),
    ).rejects.toMatchObject({ kind: "rate_limited", retryAfter: 12 });
  });
});
