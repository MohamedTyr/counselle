import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useEssayAutosave } from "@/features/essays/useEssayAutosave";
import { createTestQueryClient, jsonResponse } from "@/test/render-app";

/*
 * Two regressions, both about a save landing at the wrong moment.
 *
 * `flush()` has to be genuinely awaitable, because the accept flow flushes the
 * student's typing before it POSTs — a flush that resolves on the next
 * microtask would let the accept run against a copy of the essay the server
 * has not seen.
 *
 * And every save has to carry `expected_updated_at`, because without it the
 * backend's staleness check is a documented no-op: an autosave built from the
 * pre-accept buffer would land after the accept and silently overwrite the
 * edit the student had just approved, with the suggestion already gone from
 * the queue and no way to get it back.
 */

const savedEssay = {
  content: { type: "doc", content: [{ type: "paragraph" }] },
  id: "stanford-roommate",
  updated_at: "2026-09-04T13:00:00Z",
  word_count: 2,
};

function draft(text: string) {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function renderAutosave() {
  return renderHook(
    () =>
      useEssayAutosave("stanford-roommate", {
        content: savedEssay.content,
        updatedAt: "2026-09-04T12:00:00Z",
        wordCount: 2,
      }),
    { wrapper },
  );
}

/* The same hook, but with the server version arriving as a changing prop —
 * which is how a write this hook did not issue (an accepted suggestion) gets
 * here: the accept endpoint's response is written into the query cache, and
 * the route hands the new `updated_at` back down. */
function renderAdoptingAutosave(updatedAt: string) {
  return renderHook(
    ({ at }: { at: string }) =>
      useEssayAutosave("stanford-roommate", {
        content: savedEssay.content,
        updatedAt: at,
        wordCount: 2,
      }),
    { initialProps: { at: updatedAt }, wrapper },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useEssayAutosave", () => {
  test("flush() resolves only once the underlying save has landed", async () => {
    let release!: () => void;
    const landed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await landed;
      return jsonResponse(savedEssay);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderAutosave();
    act(() => {
      result.current.queueSave(draft("Autosaved text"), 2);
    });

    let flushed = false;
    let flushing!: Promise<void>;
    act(() => {
      flushing = result.current.flush().then(() => {
        flushed = true;
      });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // The request is out and unanswered: a flush that resolved here would let
    // the caller act against the server's pre-flush copy.
    await Promise.resolve();
    expect(flushed).toBe(false);

    await act(async () => {
      release();
      await flushing;
    });
    expect(flushed).toBe(true);
  });

  test("flush() resolves immediately when there is nothing pending", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(savedEssay));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderAutosave();
    await act(async () => {
      await result.current.flush();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a save carries expected_updated_at, and adopts the version it gets back", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(savedEssay));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderAutosave();
    act(() => {
      result.current.queueSave(draft("Autosaved text"), 2);
    });
    await act(async () => {
      await result.current.flush();
    });

    const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(first.body))).toMatchObject({
      expected_updated_at: "2026-09-04T12:00:00Z",
    });

    act(() => {
      result.current.queueSave(draft("Autosaved text again"), 3);
    });
    await act(async () => {
      await result.current.flush();
    });

    const [, second] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(second.body))).toMatchObject({
      expected_updated_at: savedEssay.updated_at,
    });
  });

  test("a version that arrives while the buffer is clean is adopted", async () => {
    /* Accepting a suggestion bumps `updated_at` behind this hook's back. If
     * the next save still carried the pre-accept version the backend would
     * reject it and the student would see "Retry" for a conflict that does not
     * exist — after every accept. */
    const fetchMock = vi.fn(async () => jsonResponse(savedEssay));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender, result } = renderAdoptingAutosave("2026-09-04T12:00:00Z");
    await act(async () => {
      rerender({ at: "2026-09-04T14:00:00Z" });
    });

    act(() => {
      result.current.queueSave(draft("Typed after accepting"), 3);
    });
    await act(async () => {
      await result.current.flush();
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      expected_updated_at: "2026-09-04T14:00:00Z",
    });
  });

  test("a version that arrives while a draft is still unsent is NOT adopted", async () => {
    /* The other half of the same rule, and the one that loses writing when it
     * is broken. This draft was written against the PRE-accept text. Pairing
     * it with the POST-accept version makes it pass the backend's staleness
     * check, so it lands and silently overwrites the edit the student just
     * accepted — no error, no conflict, no way back. Keeping the old version
     * on it is what turns that into an honest, visible rejection. */
    const fetchMock = vi.fn(async () => jsonResponse(savedEssay));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender, result } = renderAdoptingAutosave("2026-09-04T12:00:00Z");
    act(() => {
      result.current.queueSave(draft("Typed mid-accept"), 3);
    });
    await act(async () => {
      rerender({ at: "2026-09-04T14:00:00Z" });
    });
    await act(async () => {
      await result.current.flush();
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      expected_updated_at: "2026-09-04T12:00:00Z",
    });
  });

  test("versions are ordered as instants, not as strings", async () => {
    /* The backend omits the fractional seconds entirely on a whole second, so
     * `…:00Z` sorts AFTER `…:00.500000Z` while being half a second earlier.
     * Compared as strings, the newer fractional version below is not adopted
     * (every later save then 409s against a version the server has moved
     * past), and the older whole-second one that follows it IS adopted, which
     * walks the version backwards and makes that permanent. */
    const fetchMock = vi.fn(async () => jsonResponse(savedEssay));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender, result } = renderAdoptingAutosave("2026-09-04T12:00:00Z");
    await act(async () => {
      rerender({ at: "2026-09-04T12:00:00.500000Z" });
    });
    // A stale prop replaying the earlier whole-second version must not win.
    await act(async () => {
      rerender({ at: "2026-09-04T12:00:00Z" });
    });

    act(() => {
      result.current.queueSave(draft("Typed after the fractional bump"), 3);
    });
    await act(async () => {
      await result.current.flush();
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      expected_updated_at: "2026-09-04T12:00:00.500000Z",
    });
  });

  test("retry stays a fire-and-forget caller after the return-type widening", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(savedEssay));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderAutosave();
    act(() => {
      result.current.queueSave(draft("Autosaved text"), 2);
    });
    act(() => {
      expect(result.current.retry()).toBeUndefined();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.saveState).toBe("saved"));
  });
});
