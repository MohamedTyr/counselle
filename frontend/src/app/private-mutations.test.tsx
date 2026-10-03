import { useEssayAutosave } from "@/features/essays/useEssayAutosave";
import { useSatSession } from "@/features/sat/use-sat-session";
import { satKeys } from "@/api/sat/keys";
import { workspaceEssayFixture } from "@/test/render-app";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import {
  PrivateMutationExpiredError,
  usePrivateMutation,
} from "@/app/private-mutations";
import {
  authQueryKey,
  discardPrivateQueryData,
  useUpdateOnboardingProgress,
} from "@/app/auth";
import { useUpdateProfile } from "@/api/workspace/hooks/profile";
import { useUpdateActivity } from "@/api/workspace/hooks";
import { workspaceKeys } from "@/api/workspace/keys";
import {
  createTestQueryClient,
  jsonResponse,
  workspaceActivityFixture,
} from "@/test/render-app";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup() {
  const client = createTestQueryClient();
  client.setQueryData(authQueryKey, { id: "A", settings: {} });
  const response = deferred<Response>();
  const fetch = vi.fn(() => response.promise);
  vi.stubGlobal("fetch", fetch);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const switchOwner = async (id = "B") => {
    await discardPrivateQueryData(client);
    client.setQueryData(authQueryKey, { id, settings: {} });
  };
  return { client, response, fetch, wrapper, switchOwner };
}

describe("private mutation account ownership", () => {
  it("does not restore A's profile after its hook unmounts and B signs in", async () => {
    const { client, response, fetch, wrapper, switchOwner } = setup();
    const { result, unmount } = renderHook(useUpdateProfile, { wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .mutateAsync({ context: { family: "A private" } })
        .catch(() => undefined);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    unmount();
    await switchOwner();
    const b = { context: { family: "B private" } };
    client.setQueryData(workspaceKeys.profile.detail(), b);
    await act(async () => {
      response.resolve(jsonResponse({ context: { family: "A private" } }));
      await pending;
    });
    expect(client.getQueryData(workspaceKeys.profile.detail())).toEqual(b);
  });

  it("does not apply A's failed optimistic update or settled invalidation to B", async () => {
    const { client, response, fetch, wrapper, switchOwner } = setup();
    client.setQueryData(workspaceKeys.activities.list(), [
      workspaceActivityFixture,
    ]);
    const { result, unmount } = renderHook(useUpdateActivity, { wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .mutateAsync({
          id: workspaceActivityFixture.id,
          patch: { description: "A edit" },
        })
        .catch(() => undefined);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(client.getQueryData(workspaceKeys.activities.list())).toEqual([
      expect.objectContaining({ description: "A edit" }),
    ]);
    unmount();
    await switchOwner();
    const b = [
      {
        ...workspaceActivityFixture,
        id: "B activity",
        description: "B private",
      },
    ];
    client.setQueryData(workspaceKeys.activities.list(), b);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => {
      response.reject(new Error("A failed"));
      await pending;
    });
    expect(client.getQueryData(workspaceKeys.activities.list())).toEqual(b);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not apply old onboarding data or per-call callbacks after an owner change", async () => {
    const { client, response, fetch, wrapper, switchOwner } = setup();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onSettled = vi.fn();
    const { result } = renderHook(useUpdateOnboardingProgress, { wrapper });
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current
        .mutateAsync(
          { action: "advance", step: "academics" },
          { onSuccess, onError, onSettled },
        )
        .catch(() => undefined);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await switchOwner();
    await act(async () => {
      response.resolve(jsonResponse({ current_step: "goals" }));
      await pending;
    });
    expect(client.getQueryData(authQueryKey)).toEqual({
      id: "B",
      settings: {},
    });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });
  it("rejects A's old response even when A signs back in", async () => {
    const { client, response, fetch, wrapper, switchOwner } = setup();
    const { result } = renderHook(useUpdateProfile, { wrapper });
    let outcome!: Promise<unknown>;
    act(() => {
      outcome = result.current
        .mutateAsync({ context: { family: "old A" } })
        .catch((error) => error);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await switchOwner();
    await switchOwner("A");
    const fresh = { context: { family: "fresh A" } };
    client.setQueryData(workspaceKeys.profile.detail(), fresh);
    await act(async () => {
      response.resolve(jsonResponse({ context: { family: "old A" } }));
    });
    expect(await outcome).toBeInstanceOf(PrivateMutationExpiredError);
    expect(client.getQueryData(workspaceKeys.profile.detail())).toEqual(fresh);
  });

  it("keeps overlapping calls from separate account subtrees isolated", async () => {
    const { client, response, fetch, wrapper, switchOwner } = setup();
    const bResponse = deferred<Response>();
    fetch
      .mockImplementationOnce(() => response.promise)
      .mockImplementationOnce(() => bResponse.promise);
    const { result } = renderHook(useUpdateProfile, { wrapper });
    let a!: Promise<unknown>;
    let b!: Promise<unknown>;
    act(() => {
      a = result.current
        .mutateAsync({ context: { family: "A" } })
        .catch((error) => error);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await switchOwner();
    const bHook = renderHook(useUpdateProfile, { wrapper });
    act(() => {
      b = bHook.result.current.mutateAsync({ context: { family: "B" } });
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(async () => {
      bResponse.resolve(jsonResponse({ context: { family: "B" } }));
      await b;
    });
    await act(async () => {
      response.resolve(jsonResponse({ context: { family: "A" } }));
      await a;
    });
    expect(client.getQueryData(workspaceKeys.profile.detail())).toEqual({
      context: { family: "B" },
    });
    expect(await a).toBeInstanceOf(PrivateMutationExpiredError);
  });

  it("stops optimistic setup if the account changes while queries cancel", async () => {
    const { client, fetch, wrapper, switchOwner } = setup();
    const cancelled = deferred<void>();
    vi.spyOn(client, "cancelQueries").mockImplementationOnce(
      () => cancelled.promise,
    );
    const { result } = renderHook(useUpdateActivity, { wrapper });
    let outcome!: Promise<unknown>;
    act(() => {
      outcome = result.current
        .mutateAsync({
          id: workspaceActivityFixture.id,
          patch: { description: "A edit" },
        })
        .catch((error) => error);
    });
    await switchOwner();
    const b = [{ ...workspaceActivityFixture, description: "B data" }];
    client.setQueryData(workspaceKeys.activities.list(), b);
    await act(async () => {
      cancelled.resolve();
      await outcome;
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(client.getQueryData(workspaceKeys.activities.list())).toEqual(b);
    expect(await outcome).toBeInstanceOf(PrivateMutationExpiredError);
  });

  it("keeps the original variables and optimistic snapshot in same-account callbacks", async () => {
    const { wrapper } = setup();
    const success = vi.fn();
    const settled = vi.fn();
    const perCall = vi.fn();
    const { result } = renderHook(
      () =>
        usePrivateMutation({
          mutationFn: async (input: string) => input.toUpperCase(),
          onMutate: () => ({ previous: "snapshot" }),
          onSuccess: success,
          onSettled: settled,
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync("input", { onSuccess: perCall });
    });
    await waitFor(() => expect(result.current.variables).toBe("input"));
    expect(success).toHaveBeenCalledWith(
      "INPUT",
      "input",
      { previous: "snapshot" },
      expect.any(Object),
    );
    expect(perCall).toHaveBeenCalledWith(
      "INPUT",
      "input",
      { previous: "snapshot" },
      expect.any(Object),
    );
    expect(settled).toHaveBeenCalledWith(
      "INPUT",
      null,
      "input",
      { previous: "snapshot" },
      expect.any(Object),
    );
  });
  it.each(["success", "failure"])(
    "drops old essay autosave %s and queued/unmount saves",
    async (outcome) => {
      const { client, response, fetch, wrapper, switchOwner } = setup();
      const { result, unmount } = renderHook(
        () => useEssayAutosave(workspaceEssayFixture.id),
        { wrapper },
      );
      const content = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "A draft" }] },
        ],
      };
      act(() => result.current.queueSave(content, 2));
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.flush();
      });
      await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      act(() => {
        result.current.queueSave({ ...content, extra: "newer A draft" }, 3);
        void result.current.flush();
      });
      await switchOwner();
      const b = { ...workspaceEssayFixture, title: "B essay" };
      client.setQueryData(workspaceKeys.essays.detail(b.id), b);
      client.setQueryData(workspaceKeys.essays.list(), [b]);
      unmount();
      const invalidate = vi.spyOn(client, "invalidateQueries");
      await act(async () => {
        if (outcome === "success")
          response.resolve(jsonResponse({ ...workspaceEssayFixture, content }));
        else response.reject(new Error("A save failed"));
        await pending;
      });
      expect(client.getQueryData(workspaceKeys.essays.detail(b.id))).toEqual(b);
      expect(client.getQueryData(workspaceKeys.essays.list())).toEqual([b]);
      expect(fetch).toHaveBeenCalledOnce();
      expect(invalidate).not.toHaveBeenCalled();
    },
  );

  it("drops a keepalive essay response after the editor's account changes", async () => {
    const { client, response, fetch, wrapper, switchOwner } = setup();
    const { result, unmount } = renderHook(
      () => useEssayAutosave(workspaceEssayFixture.id),
      { wrapper },
    );
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A draft" }] },
      ],
    };
    act(() => {
      result.current.queueSave(content, 2);
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][1]).toMatchObject({ keepalive: true });
    await switchOwner();
    const b = { ...workspaceEssayFixture, title: "B essay" };
    client.setQueryData(workspaceKeys.essays.detail(b.id), b);
    unmount();
    await act(async () => {
      response.resolve(jsonResponse({ ...workspaceEssayFixture, content }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.getQueryData(workspaceKeys.essays.detail(b.id))).toEqual(b);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not flush an unsent editor draft under the next account on unmount", async () => {
    const { fetch, wrapper, switchOwner } = setup();
    const { result, unmount } = renderHook(
      () => useEssayAutosave(workspaceEssayFixture.id),
      { wrapper },
    );
    act(() => result.current.queueSave({ type: "doc", content: [] }, 0));
    await switchOwner();
    unmount();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not write a late SAT attempt into the next account's history", async () => {
    const { client, response, fetch, wrapper, switchOwner } = setup();
    fetch.mockImplementationOnce(() =>
      Promise.resolve(
        jsonResponse([
          {
            id: "q1",
            score_band: 4,
            content_sha: "sha1",
            bookmarked: false,
            ever_correct: false,
            ever_incorrect: false,
          },
        ]),
      ),
    );
    const { result, unmount } = renderHook(
      () => useSatSession({ kind: "filter", filter: {} }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.answer("A"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submit(10);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await switchOwner();
    client.setQueryData(satKeys.attempts("q1"), ["B history"]);
    unmount();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => {
      response.resolve(
        jsonResponse({
          is_correct: true,
          correct_answers: ["A"],
          rationale: "A rationale",
          attempts: ["A history"],
        }),
      );
      await pending;
    });
    expect(client.getQueryData(satKeys.attempts("q1"))).toEqual(["B history"]);
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("never dispatches an old queued activity edit after switching accounts", async () => {
    const { client, response, fetch, wrapper, switchOwner } = setup();
    client.setQueryData(workspaceKeys.activities.list(), [
      workspaceActivityFixture,
    ]);
    const { result } = renderHook(useUpdateActivity, { wrapper });
    let first!: Promise<unknown>;
    let queued!: Promise<unknown>;
    act(() => {
      first = result.current
        .mutateAsync({
          id: workspaceActivityFixture.id,
          patch: { description: "A first" },
        })
        .catch((error) => error);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await act(async () => {
      queued = result.current
        .mutateAsync({
          id: workspaceActivityFixture.id,
          patch: { description: "A queued" },
        })
        .catch((error) => error);
    });
    await waitFor(() =>
      expect(client.getQueryData(workspaceKeys.activities.list())).toEqual([
        expect.objectContaining({ description: "A queued" }),
      ]),
    );
    await switchOwner();
    await act(async () => {
      response.resolve(jsonResponse(workspaceActivityFixture));
      await Promise.all([first, queued]);
    });
    expect(await first).toBeInstanceOf(PrivateMutationExpiredError);
    expect(await queued).toBeInstanceOf(PrivateMutationExpiredError);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects a retained old hook callback instead of starting work as the next account", async () => {
    const { fetch, wrapper, switchOwner } = setup();
    const { result, unmount } = renderHook(useUpdateProfile, { wrapper });
    const retained = result.current.mutateAsync;
    unmount();
    await switchOwner();
    await expect(
      retained({ context: { family: "old A" } }),
    ).rejects.toBeInstanceOf(PrivateMutationExpiredError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves same-owner mutation callbacks retained by Undo after unmount", async () => {
    const { response, fetch, wrapper } = setup();
    const { result, unmount } = renderHook(useUpdateProfile, { wrapper });
    const retained = result.current.mutateAsync;
    unmount();
    const pending = retained({ context: { family: "same owner undo" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    response.resolve(jsonResponse({ context: { family: "same owner undo" } }));
    await expect(pending).resolves.toEqual({
      context: { family: "same owner undo" },
    });
  });
});
