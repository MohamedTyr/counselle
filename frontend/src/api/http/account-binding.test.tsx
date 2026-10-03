import { chatTransport } from "@/api/chat/transport";
import { updateEssayKeepalive } from "@/api/workspace/essays";
import { createWorkspaceEventSource } from "@/api/workspace/event-source";
import { act, renderHook, waitFor } from "@testing-library/react";
import { AppProviders } from "@/app/AppProviders";
import { authQueryKey } from "@/app/auth";
import { useProfile, useUpdateProfile } from "@/api/workspace/hooks/profile";
import {
  bindHttpAccount,
  accountBoundFetch,
  accountBoundEventUrl,
} from "./account-binding";
import { requestJson } from "./client";
import {
  authUserFixture,
  createTestQueryClient,
  jsonResponse,
} from "@/test/render-app";

it("binds private reads and writes to the tab's owner while exempting discovery and public auth", async () => {
  const mock = vi.fn((...args: [RequestInfo | URL, RequestInit?]) => {
    void args;
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", mock);
  const release = bindHttpAccount(
    () => "owner-a",
    () => undefined,
  );
  try {
    for (const [path, method] of [
      ["/profile", "GET"],
      ["/config", "GET"],
      ["/profile", "PATCH"],
      ["/me", "DELETE"],
      ["/sat/stats", "GET"],
      ["/sessions", "GET"],
    ]) {
      await requestJson(path, { method });
      const init = mock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
      expect(new Headers(init?.headers).get("X-Expected-User-Id")).toBe(
        "owner-a",
      );
    }
    for (const path of [
      "/me",
      "/config/public",
      "/auth/login",
      "/auth/register",
      "/auth/reset-password",
      "/auth/verify",
    ]) {
      await requestJson(path);
      const init = mock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
      expect(new Headers(init?.headers).has("X-Expected-User-Id")).toBe(false);
    }
    await requestJson("/me", {
      headers: { "X-Expected-User-Id": "captured-a" },
    });
    expect(
      new Headers((mock.mock.calls.at(-1)?.[1] as RequestInit).headers).get(
        "X-Expected-User-Id",
      ),
    ).toBe("captured-a");
    expect(accountBoundEventUrl("/v1/workspace/events")).toBe(
      "/v1/workspace/events?expected_user_id=owner-a",
    );
  } finally {
    release();
  }
});

it("reports a mismatch once and retains the response for the endpoint's error parser", async () => {
  const changed = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => jsonResponse({ detail: "ACCOUNT_CHANGED" }, { status: 409 })),
  );
  const release = bindHttpAccount(() => "owner-a", changed);
  try {
    const response = await accountBoundFetch("/v1/profile", {
      method: "PATCH",
    });
    expect(changed).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ detail: "ACCOUNT_CHANGED" });
    await expect(requestJson("/profile")).rejects.toMatchObject({
      kind: "account_changed",
      status: 409,
    });
  } finally {
    release();
  }
});

it("does not send account identity to other origins", async () => {
  const mock = vi.fn((...args: [RequestInfo | URL, RequestInit?]) => {
    void args;
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", mock);
  const release = bindHttpAccount(
    () => "owner-a",
    () => undefined,
  );
  try {
    await accountBoundFetch("https://example.com/v1/profile");
    expect(
      new Headers((mock.mock.calls[0]?.[1] as RequestInit)?.headers).has(
        "X-Expected-User-Id",
      ),
    ).toBe(false);
  } finally {
    release();
  }
});

it.each(["read", "write"])(
  "refreshes identity after an actual profile %s sees a different cookie owner without retrying",
  async (kind) => {
    const client = createTestQueryClient();
    client.setQueryData(authQueryKey, { ...authUserFixture, id: "owner-a" });
    let privateRequests = 0;
    const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/v1/me"))
        return jsonResponse({ ...authUserFixture, id: "owner-b" });
      if (String(input).endsWith("/v1/profile")) {
        const expectedOwner = new Headers(init?.headers).get(
          "X-Expected-User-Id",
        );
        if (expectedOwner === "owner-b" && (init?.method ?? "GET") === "GET")
          return jsonResponse({ academics: {} });
        privateRequests += 1;
        expect(expectedOwner).toBe("owner-a");
        return jsonResponse({ detail: "ACCOUNT_CHANGED" }, { status: 409 });
      }
      throw new Error(`Unexpected request ${input}`);
    });
    vi.stubGlobal("fetch", mock);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AppProviders queryClient={client}>{children}</AppProviders>
    );
    const useOperation = kind === "read" ? useProfile : useUpdateProfile;
    const { result, unmount } = renderHook(() => useOperation(), { wrapper });
    if (kind === "write") {
      await act(async () => {
        if ("mutateAsync" in result.current)
          await result.current.mutateAsync({}).catch(() => undefined);
      });
    }
    await waitFor(() =>
      expect(client.getQueryData<{ id: string }>(authQueryKey)?.id).toBe(
        "owner-b",
      ),
    );
    expect(privateRequests).toBe(1);
    unmount();
  },
);

it("binds direct chat, keepalive, and native workspace event transports", async () => {
  const requests: { path: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ path: String(path), init });
      return jsonResponse({});
    }),
  );
  const eventUrls: string[] = [];
  vi.stubGlobal(
    "EventSource",
    class {
      constructor(url: string) {
        eventUrls.push(url);
      }
    },
  );
  const release = bindHttpAccount(
    () => "owner-a",
    () => undefined,
  );
  try {
    await chatTransport.renameSession("session-a", "A chat");
    await updateEssayKeepalive("essay-a", {});
    createWorkspaceEventSource();
    expect(requests).toHaveLength(2);
    for (const request of requests)
      expect(new Headers(request.init?.headers).get("X-Expected-User-Id")).toBe(
        "owner-a",
      );
    expect(requests[1].init?.keepalive).toBe(true);
    expect(eventUrls).toEqual([
      "/v1/workspace/events?expected_user_id=owner-a",
    ]);
  } finally {
    release();
  }
});
