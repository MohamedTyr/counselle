import { authQueryKey, discardPrivateQueryData } from "@/app/auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useEssay } from "@/api/workspace/hooks/essays";
import { workspaceKeys } from "@/api/workspace/keys";
import { useEssaySuggestions } from "@/features/essays/suggestions/useEssaySuggestions";
import { SuggestionPluginKey } from "@/features/essays/suggestions/suggestionExtension";
import { createTestQueryClient } from "@/test/render-app";

/*
 * Resolving a change is the one place in this feature that can destroy a
 * student's writing, so it is the one place tested hard.
 *
 * Everything here is a regression for a bug an earlier design of this flow
 * actually had: two accepts racing each other out of order, an accept applied
 * locally and then re-saved as plain text over the server's formatted result,
 * a content replacement that flipped every other pending change to stale, and
 * a second key press firing a second request that 404s and tells the student
 * their successful accept failed.
 */

const accept = vi.hoisted(() => vi.fn());
const acceptAll = vi.hoisted(() => vi.fn());
const getEssay = vi.hoisted(() => vi.fn());
const reject = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());

vi.mock("@/api/workspace/essays", () => ({
  acceptAllSuggestions: acceptAll,
  acceptSuggestion: accept,
  getEssay,
  rejectAllSuggestions: vi.fn(),
  rejectSuggestion: reject,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: warn },
}));

const ESSAY_ID = "6f1a0f7e-0000-4000-8000-000000000001";

function serverEssay(
  suggestions: unknown[] = [],
  updatedAt = "2026-09-05T10:00:00Z",
) {
  return {
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Accepted." }] },
      ],
    },
    id: ESSAY_ID,
    suggestions,
    updated_at: updatedAt,
  };
}

function suggestionRow(id: string) {
  return {
    created_at: "2026-09-05T09:00:00Z",
    id,
    new_text: "new",
    new_text_plain: "new",
    old_text: "old",
    old_text_plain: "old",
    rationale: "tighter",
  };
}

/* A stand-in for the editor that records exactly what was asked of it: the
 * point of these tests is which transactions the flow issues, not what
 * ProseMirror does with them. */
function fakeEditor() {
  const setContentCalls: { content: unknown; options: unknown }[] = [];
  const metaCalls: { key: unknown; value: unknown }[] = [];
  let runCount = 0;

  const chain = {
    command(build: (props: { tr: unknown }) => boolean) {
      build({
        tr: {
          setMeta: (key: unknown, value: unknown) =>
            metaCalls.push({ key, value }),
        },
      });
      return chain;
    },
    run() {
      runCount += 1;
      return true;
    },
    setContent(content: unknown, options: unknown) {
      setContentCalls.push({ content, options });
      return chain;
    },
  };

  return {
    chain: () => chain,
    commands: { focus: vi.fn() },
    isFocused: false,
    metaCalls,
    get runCount() {
      return runCount;
    },
    setContentCalls,
    state: { doc: { content: { size: 12 } }, selection: { from: 3 } },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderController(
  editor: ReturnType<typeof fakeEditor>,
  /* Live, not a captured boolean — the flow reads it before the request and
   * again after the response, and the gap between those two reads is the
   * whole point of the mid-flight test below. */
  hasUnsavedChanges: () => boolean = () => false,
) {
  const flush = vi.fn(() => Promise.resolve());
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(authQueryKey, { id: "A" });
  const view = renderHook(
    () =>
      useEssaySuggestions({
        // The fake stands in for a real Editor at the two seams used here.
        editor: editor as never,
        essayId: ESSAY_ID,
        flush,
        hasUnsavedChanges,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      ),
    },
  );
  return { flush, queryClient, view };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolving is serialised across the whole panel", () => {
  test("a second accept on the same change never reaches the network", async () => {
    const pending = deferred<unknown>();
    accept.mockReturnValue(pending.promise);
    const editor = fakeEditor();
    const { view } = renderController(editor);

    act(() => {
      view.result.current.acceptOne("a");
    });
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));

    act(() => {
      view.result.current.acceptOne("a");
    });
    expect(accept).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(serverEssay());
      await pending.promise;
    });
    await waitFor(() => expect(view.result.current.isResolving).toBe(false));
  });

  test("rejecting a DIFFERENT change mid-accept is blocked too", async () => {
    /* The lock is panel-wide, not per suggestion: B's reject would be racing a
     * response that is about to replace the whole document, and B's own anchor
     * can shift underneath it the instant A's response lands. */
    const pending = deferred<unknown>();
    accept.mockReturnValue(pending.promise);
    const editor = fakeEditor();
    const { view } = renderController(editor);

    act(() => {
      view.result.current.acceptOne("a");
    });
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));

    act(() => {
      view.result.current.rejectOne("b");
      view.result.current.acceptAll();
    });
    expect(reject).not.toHaveBeenCalled();
    expect(acceptAll).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(serverEssay());
      await pending.promise;
    });
    await waitFor(() => expect(view.result.current.isResolving).toBe(false));
  });

  test("a double key press in one tick fires one request", async () => {
    /* `Mod+Enter` twice in quick succession. The guard is a ref, not state:
     * two calls in the same tick both read state as "free", and the second
     * request would 404 on an already-resolved change — telling the student a
     * successful accept had failed. */
    const pending = deferred<unknown>();
    accept.mockReturnValue(pending.promise);
    const editor = fakeEditor();
    const { view } = renderController(editor);

    await act(async () => {
      view.result.current.acceptOne("a");
      /* No await between them, and no React commit — the lock has to already
       * be closed by the first call's own synchronous ref write. */
      view.result.current.acceptOne("a");
    });

    expect(accept).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(serverEssay());
      await pending.promise;
    });
    await waitFor(() => expect(view.result.current.isResolving).toBe(false));
  });
});

describe("accept applies only what the server returned", () => {
  test("the flush is awaited, then the server's content is set without emitting an update", async () => {
    const essay = serverEssay([suggestionRow("b")]);
    accept.mockResolvedValue(essay);
    const editor = fakeEditor();
    const { flush, view } = renderController(editor);

    await act(async () => {
      view.result.current.acceptOne("a");
    });
    await waitFor(() => expect(editor.setContentCalls).toHaveLength(1));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(editor.setContentCalls[0].content).toBe(essay.content);
    /* No `onUpdate` means no autosave is queued: the server already holds
     * this content, and re-saving the editor's plain-text rendering of it is
     * how an accepted edit used to lose its formatting. */
    expect(editor.setContentCalls[0].options).toEqual({ emitUpdate: false });
  });

  test("content and the new suggestion list land in ONE transaction", async () => {
    /* A bare `setContent` carries no meta, which makes the plugin MAP every
     * other anchor through a whole-document replacement — re-validation then
     * fails and every sibling flips to stale the moment one change is
     * accepted. The meta has to ride the same chained transaction. */
    accept.mockResolvedValue(serverEssay([suggestionRow("b")]));
    const editor = fakeEditor();
    const { view } = renderController(editor);

    await act(async () => {
      view.result.current.acceptOne("a");
    });
    await waitFor(() => expect(editor.metaCalls).toHaveLength(1));

    expect(editor.runCount).toBe(1);
    expect(editor.metaCalls[0].key).toBe(SuggestionPluginKey);
    expect(editor.metaCalls[0].value).toEqual({
      suggestions: [expect.objectContaining({ id: "b", oldTextPlain: "old" })],
    });
  });

  test("typing DURING the round trip is neither overwritten nor silently dropped", async () => {
    /* The document stays editable while a resolve is in flight (plan Part 2
     * §7), so `hasUnsavedChanges()` answering "clean" before the POST says
     * nothing about the moment the response lands. It used to be read once,
     * and the response was applied unconditionally: `setContent` wiped the
     * student's mid-flight typing off the screen, and because `emitUpdate` is
     * false autosave was never told — it kept a pre-accept draft that then
     * saved over the accepted edit. Both edits vanished, in opposite
     * directions, with no error either time. */
    const pending = deferred<unknown>();
    accept.mockReturnValue(pending.promise);
    const essay = serverEssay([suggestionRow("b")]);
    const editor = fakeEditor();
    let dirty = false;
    const { queryClient, view } = renderController(editor, () => dirty);

    act(() => {
      view.result.current.acceptOne("a");
    });
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));

    // The student keeps writing while the accept is still unanswered.
    dirty = true;

    await act(async () => {
      pending.resolve(essay);
      await pending.promise;
    });
    await waitFor(() => expect(view.result.current.isResolving).toBe(false));

    // Their typing is left standing: no whole-document replacement ran.
    expect(editor.setContentCalls).toHaveLength(0);
    expect(editor.metaCalls).toHaveLength(0);
    // The accepted edit is not thrown away either — the server's essay is
    // adopted, so the version it carries is what any later save is judged
    // against, and a reload shows the accepted text.
    expect(
      queryClient.getQueryData(workspaceKeys.essays.detail(ESSAY_ID)),
    ).toBe(essay);
    // And the student is told, rather than left to notice.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("a response the server has already moved past is dropped, not applied", async () => {
    /* Found in a real browser, not in a mock: with a slow accept, the
     * student's own 1.5s debounced autosave lands INSIDE the round trip. By
     * the time the response arrives the buffer is clean again — so a dirty
     * check alone waves it through — but the essay the server now stores is
     * newer than the copy this response is carrying, and already contains the
     * accepted text. Writing the response over the top rewound the document
     * to before their sentence and rewound the cache with it, and the next
     * save then made that loss permanent on the server too. */
    const pending = deferred<unknown>();
    accept.mockReturnValue(pending.promise);
    const editor = fakeEditor();
    const { queryClient, view } = renderController(editor);

    act(() => {
      view.result.current.acceptOne("a");
    });
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));

    // The student's autosave lands first and moves the essay past the
    // response that is still in flight.
    const saved = serverEssay([], "2026-09-05T10:00:05Z");
    queryClient.setQueryData(workspaceKeys.essays.detail(ESSAY_ID), saved);

    await act(async () => {
      pending.resolve(
        serverEssay([suggestionRow("b")], "2026-09-05T10:00:00Z"),
      );
      await pending.promise;
    });
    await waitFor(() => expect(view.result.current.isResolving).toBe(false));

    expect(editor.setContentCalls).toHaveLength(0);
    // The cache keeps the newer essay rather than being walked backwards.
    expect(
      queryClient.getQueryData(workspaceKeys.essays.detail(ESSAY_ID)),
    ).toBe(saved);
    /* And no warning: nothing diverged. What the student is looking at is
     * already at least as new as what was dropped, so saying otherwise would
     * be the dishonest move. */
    expect(warn).not.toHaveBeenCalled();
  });

  test("a whole-second response is not mistaken for one the server moved past", async () => {
    /* The staleness check above compares two `updated_at` values, and the
     * backend writes a whole second with no fractional part at all — so
     * `…:00Z` sorts AFTER `…:00.500000Z` as a string while being half a second
     * EARLIER as a time. Compared as strings, this accept — genuinely newer
     * than what is cached — looks stale, and the flow silently drops an edit
     * the server has already committed: the change vanishes from the queue,
     * the text never appears, and nothing says so. */
    accept.mockResolvedValue(
      serverEssay([suggestionRow("b")], "2026-09-05T10:00:00.500000Z"),
    );
    const editor = fakeEditor();
    const { queryClient, view } = renderController(editor);

    queryClient.setQueryData(
      workspaceKeys.essays.detail(ESSAY_ID),
      serverEssay([], "2026-09-05T10:00:00Z"),
    );

    await act(async () => {
      view.result.current.acceptOne("a");
    });
    await waitFor(() => expect(view.result.current.isResolving).toBe(false));

    expect(editor.setContentCalls).toHaveLength(1);
    expect(
      queryClient.getQueryData<{ updated_at: string }>(
        workspaceKeys.essays.detail(ESSAY_ID),
      )?.updated_at,
    ).toBe("2026-09-05T10:00:00.500000Z");
  });

  test("a background read still in flight cannot re-show the accepted change", async () => {
    /* The editor is not the only thing reading this essay. Every agent turn
     * that settles in the docked chat panel invalidates the same query key
     * (`EssayEditorRoute.refetchEssay`), and that read is issued against the
     * server as it was BEFORE the accept committed. Landing after the accept's
     * own cache write, it used to overwrite it — content and suggestion list
     * together — and the change the student had just accepted came back on
     * screen as pending, with the honesty readout counting it. The server was
     * right the whole time; only the screen lied.
     *
     * The fix is not to drop the background read: an agent writing the essay
     * from the main chat has to reach this editor. It is to re-issue it, which
     * both cancels the in-flight stale one and guarantees the state that lands
     * is the one after the accept. */
    const stale = serverEssay([suggestionRow("a")], "2026-09-05T10:00:00Z");
    const accepted = serverEssay([], "2026-09-05T10:00:05Z");
    const backgroundRead = deferred<unknown>();
    const acceptResponse = deferred<unknown>();
    accept.mockReturnValue(acceptResponse.promise);
    getEssay
      // The editor's own first read of the essay.
      .mockResolvedValueOnce(stale)
      // The agent turn's refetch — issued before the accept commits, and
      // deliberately left unanswered until after it has.
      .mockReturnValueOnce(backgroundRead.promise)
      // Whatever is read after that sees the accept.
      .mockResolvedValue(accepted);

    const editor = fakeEditor();
    const queryClient = createTestQueryClient();
    const view = renderHook(
      () => ({
        essay: useEssay(ESSAY_ID),
        suggestions: useEssaySuggestions({
          editor: editor as never,
          essayId: ESSAY_ID,
          flush: () => Promise.resolve(),
          hasUnsavedChanges: () => false,
        }),
      }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(view.result.current.essay.data).toEqual(stale));

    act(() => {
      view.result.current.suggestions.acceptOne("a");
    });
    await waitFor(() => expect(accept).toHaveBeenCalledTimes(1));

    // An agent turn settles in the docked panel while the accept is in flight.
    act(() => {
      void queryClient.invalidateQueries({
        queryKey: workspaceKeys.essays.detail(ESSAY_ID),
      });
    });
    await waitFor(() => expect(getEssay).toHaveBeenCalledTimes(2));

    await act(async () => {
      acceptResponse.resolve(accepted);
      await acceptResponse.promise;
    });
    // Only now does the pre-accept read come back.
    await act(async () => {
      backgroundRead.resolve(stale);
      await backgroundRead.promise;
    });
    await waitFor(() =>
      expect(view.result.current.suggestions.isResolving).toBe(false),
    );

    expect(
      queryClient.getQueryData(workspaceKeys.essays.detail(ESSAY_ID)),
    ).toEqual(accepted);
    // Re-issued, not dropped: a genuinely newer server state still has a way in.
    await waitFor(() => expect(getEssay).toHaveBeenCalledTimes(3));
    expect(view.result.current.essay.data).toEqual(accepted);
  });

  test("reject never touches the document", async () => {
    reject.mockResolvedValue(serverEssay([]));
    const editor = fakeEditor();
    const { view } = renderController(editor);

    await act(async () => {
      view.result.current.rejectOne("a");
    });
    await waitFor(() => expect(reject).toHaveBeenCalledTimes(1));

    expect(editor.setContentCalls).toHaveLength(0);
  });
  test("a late resolve cannot adopt A's essay into B's cache or editor", async () => {
    const pending = deferred<unknown>();
    accept.mockReturnValue(pending.promise);
    const editor = fakeEditor();
    const { queryClient, view } = renderController(editor);
    act(() => view.result.current.acceptOne("a"));
    await waitFor(() => expect(accept).toHaveBeenCalledOnce());
    view.unmount();
    await discardPrivateQueryData(queryClient);
    queryClient.setQueryData(authQueryKey, { id: "B" });
    const b = { ...serverEssay(), title: "B private" };
    queryClient.setQueryData(workspaceKeys.essays.detail(ESSAY_ID), b);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      pending.resolve(serverEssay());
      await pending.promise;
    });
    expect(
      queryClient.getQueryData(workspaceKeys.essays.detail(ESSAY_ID)),
    ).toEqual(b);
    expect(editor.setContentCalls).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test("changing account during autosave flush prevents the resolve request", async () => {
    const pending = deferred<void>();
    const editor = fakeEditor();
    const { flush, queryClient, view } = renderController(editor);
    flush.mockReturnValue(pending.promise);
    act(() => view.result.current.acceptOne("a"));
    await discardPrivateQueryData(queryClient);
    queryClient.setQueryData(authQueryKey, { id: "B" });
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(accept).not.toHaveBeenCalled();
    expect(editor.setContentCalls).toHaveLength(0);
  });
});
