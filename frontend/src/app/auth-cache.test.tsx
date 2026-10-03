import userEvent from "@testing-library/user-event";
import { renderHook, act, waitFor, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import { AppProviders } from "@/app/AppProviders";
import {
  authQueryKey,
  discardPrivateQueryData,
  useLogin,
  useLogout,
} from "@/app/auth";
import { workspaceKeys } from "@/api/workspace/keys";
import {
  authUserFixture,
  createTestQueryClient,
  emptyResponse,
  jsonResponse,
  defaultAuthenticatedFetch,
  renderApp,
} from "@/test/render-app";

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <AppProviders queryClient={queryClient}>{children}</AppProviders>;
  };
}

describe("private auth cache boundary", () => {
  it("removes Profile and workspace caches on logout", async () => {
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (
        String(input).endsWith("/v1/auth/logout") &&
        init?.method === "POST"
      ) {
        return emptyResponse();
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetch);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(authQueryKey, {
      ...authUserFixture,
      id: "owner-a",
    });
    queryClient.setQueryData(workspaceKeys.profile.detail(), {
      academics: { gpa_unweighted: 3.9 },
    });
    queryClient.setQueryData(workspaceKeys.tasks.list(), [{ id: "task-a" }]);

    const { result } = renderHook(() => useLogout(), {
      wrapper: wrapper(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(queryClient.getQueryData(authQueryKey)).toBeNull();
    expect(
      queryClient.getQueryData(workspaceKeys.profile.detail()),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(workspaceKeys.tasks.list()),
    ).toBeUndefined();
  });
});

describe("private query eviction", () => {
  it("clears every private query domain while retaining shared school and public configuration data", async () => {
    const client = createTestQueryClient();
    const privateKeys = [
      ["chat", "sessions", "list", {}],
      ["chat", "session", "a"],
      ["sat", "stats", "today"],
      ["sat", "counts", {}],
      ["sat", "attempts", "q"],
      ["workspace", "tasks"],
      ["onboarding"],
      ["admin-facts", "status"],
      ["cds-admin", "document", 1],
      ["waitlist"],
      ["future-private-feature"],
      ["config", "current-admissions-cycle"],
    ];
    for (const key of privateKeys) client.setQueryData(key, "owner-a");
    client.setQueryData(["schools", "explore"], "shared");
    client.setQueryData(["config", "public"], "shared");
    await discardPrivateQueryData(client);
    for (const key of privateKeys)
      expect(client.getQueryData(key)).toBeUndefined();
    expect(client.getQueryData(["schools", "explore"])).toBe("shared");
    expect(client.getQueryData(["config", "public"])).toBe("shared");
  });

  it.each([["me"], ["chat", "session", "a"], ["sat", "stats", "today"]])(
    "prevents an old in-flight %s read restoring data after sign-out",
    async (...key) => {
      const client = createTestQueryClient();
      let finish!: (value: unknown) => void;
      const pending = client
        .fetchQuery({
          queryKey: key,
          queryFn: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        })
        .catch(() => undefined);
      await discardPrivateQueryData(client);
      client.setQueryData(authQueryKey, null);
      finish(authUserFixture);
      await pending;
      expect(client.getQueryData(authQueryKey)).toBeNull();
      if (key[0] !== "me") expect(client.getQueryData(key)).toBeUndefined();
    },
  );
});

it("evicts private caches synchronously when the cached principal changes", async () => {
  const client = createTestQueryClient();
  client.setQueryData(authQueryKey, { ...authUserFixture, id: "a" });
  const { unmount } = renderHook(() => undefined, { wrapper: wrapper(client) });
  client.setQueryData(["chat", "sessions"], "A titles");
  client.setQueryData(["sat", "stats"], "A progress");
  act(() => {
    client.setQueryData(authQueryKey, { ...authUserFixture, id: "b" });
  });
  expect(client.getQueryData(["chat", "sessions"])).toBeUndefined();
  expect(client.getQueryData(["sat", "stats"])).toBeUndefined();
  unmount();
});

it("clears old account queries when login establishes a new owner", async () => {
  const client = createTestQueryClient();
  client.setQueryData(authQueryKey, null);
  client.setQueryData(["chat", "sessions"], "A titles");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/auth/login")
        ? emptyResponse()
        : jsonResponse(authUserFixture),
    ),
  );
  const { result } = renderHook(() => useLogin(), { wrapper: wrapper(client) });
  await act(async () => {
    await result.current.mutateAsync({
      email: "b@example.com",
      password: "password",
    });
  });
  expect(client.getQueryData(["chat", "sessions"])).toBeUndefined();
  expect(client.getQueryData(authQueryKey)).toEqual(authUserFixture);
});

it.each(["logout-all", "delete", "password", "reset", "email-confirm"])(
  "%s clears chat and SAT caches after success",
  async (action) => {
    const path =
      action === "reset"
        ? "/reset-password?token=valid"
        : action === "email-confirm"
          ? "/confirm-email?token=valid"
          : "/account";
    let signedOut = false;
    const { queryClient } = renderApp(path, {
      fetchHandler: (input, init) => {
        if (String(input).endsWith("/v1/me") && init?.method !== "DELETE")
          return signedOut
            ? jsonResponse({}, { status: 401 })
            : jsonResponse(authUserFixture);
        if (
          (init?.method === "POST" && !String(input).includes("/config")) ||
          init?.method === "DELETE"
        ) {
          signedOut = true;
          return emptyResponse();
        }
        return defaultAuthenticatedFetch(input, init);
      },
    });
    const user = userEvent.setup();
    await screen.findByRole("heading", {
      name:
        action === "reset"
          ? "Reset password"
          : action === "email-confirm"
            ? "Confirm your new email"
            : "Account and security",
    });
    queryClient.setQueryData(["chat", "session", "a"], "A transcript");
    queryClient.setQueryData(["sat", "stats"], "A score");
    if (action === "logout-all")
      await user.click(
        screen.getByRole("button", { name: "Sign out everywhere" }),
      );
    if (action === "delete") {
      await user.click(screen.getByRole("button", { name: "Delete account" }));
      await user.type(
        screen.getByLabelText("Type DELETE to confirm"),
        "DELETE",
      );
      await user.click(
        screen.getByRole("button", { name: "Permanently delete account" }),
      );
    }
    if (action === "password" || action === "reset") {
      await user.type(
        screen.getByLabelText("New password"),
        "new-long-password",
      );
      await user.type(
        screen.getByLabelText("Confirm password"),
        "new-long-password",
      );
      await user.click(
        screen.getByRole("button", {
          name: action === "reset" ? "Reset password" : "Change password",
        }),
      );
    }
    if (action === "email-confirm")
      await user.click(
        screen.getByRole("button", { name: "Confirm new email" }),
      );
    await waitFor(() =>
      expect(queryClient.getQueryData(authQueryKey)).toBeNull(),
    );
    expect(queryClient.getQueryData(["chat", "session", "a"])).toBeUndefined();
    expect(queryClient.getQueryData(["sat", "stats"])).toBeUndefined();
  },
);

it("does not let logout's asynchronous cleanup sign out a newly established owner", async () => {
  const client = createTestQueryClient();
  client.setQueryData(authQueryKey, { ...authUserFixture, id: "owner-a" });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => emptyResponse()),
  );
  const { result, unmount } = renderHook(() => useLogout(), {
    wrapper: wrapper(client),
  });
  const cancelQueries = client.cancelQueries.bind(client);
  vi.spyOn(client, "cancelQueries").mockImplementation((...args) => {
    const cancelled = cancelQueries(...args);
    queueMicrotask(() =>
      client.setQueryData(authQueryKey, { ...authUserFixture, id: "owner-b" }),
    );
    return cancelled;
  });
  await act(async () => {
    await result.current.mutateAsync();
  });
  expect(client.getQueryData<{ id: string }>(authQueryKey)?.id).toBe("owner-b");
  unmount();
});
