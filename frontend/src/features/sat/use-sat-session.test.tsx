import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/app/query-client";
import type { SatSessionRow, SatSubmitResult } from "@/api/sat/types";
import { jsonResponse } from "@/test/render-app";

import { useSatSession } from "./use-sat-session";

function row(overrides: Partial<SatSessionRow> = {}): SatSessionRow {
  return {
    id: "q1",
    score_band: 4,
    content_sha: "sha1",
    bookmarked: false,
    ever_correct: false,
    ever_incorrect: false,
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = createQueryClient();
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSatSession", () => {
  it("loads a filter-sourced session and exposes it as ready", async () => {
    const rows = [row({ id: "q1" }), row({ id: "q2" })];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse(rows)),
    );

    const { result } = renderHook(
      () => useSatSession({ kind: "filter", filter: {} }),
      { wrapper },
    );

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.current?.id).toBe("q1");
  });

  it("goes to error, not stuck loading, on a genuine fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    const { result } = renderHook(
      () => useSatSession({ kind: "filter", filter: {} }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("treats a 404 for a deep-linked question as an empty ready session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        jsonResponse({ detail: "That question was not found." }, { status: 404 }),
      ),
    );

    const { result } = renderHook(
      () => useSatSession({ kind: "question", questionId: "nope" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.rows).toHaveLength(0);
  });

  it("does not treat its own cleanup abort as an error (StrictMode double-mount)", async () => {
    // Simulate an aborted fetch whose signal is the caller's own combined
    // controller — safeFetch/getSession would normally throw a rejected
    // fetch here; the hook must recognise this came from its own unmount
    // cleanup and never flip to "error".
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          capturedSignal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }),
    );

    const { result, unmount } = renderHook(
      () => useSatSession({ kind: "filter", filter: {} }),
      { wrapper },
    );

    expect(result.current.status).toBe("loading");
    unmount();
    // No assertion possible on unmounted state (React discards it), but the
    // unmount itself must not throw / log an unhandled rejection — vitest
    // fails the test run on an unhandled rejection escaping this act().
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("applies a submit response by question_id, even after the student has moved on", async () => {
    const rows = [row({ id: "q1" }), row({ id: "q2" })];
    let resolveSubmit!: (value: Response) => void;
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/session")) return jsonResponse(rows);
      if (url.includes("/attempts")) {
        return new Promise<Response>((resolve) => {
          resolveSubmit = resolve;
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useSatSession({ kind: "filter", filter: {} }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.answer("A"));
    act(() => {
      void result.current.submit(10);
    });
    await waitFor(() => expect(result.current.isInFlight("q1")).toBe(true));

    // The student navigates to q2 before q1's grading lands.
    act(() => result.current.goTo(1));
    expect(result.current.current?.id).toBe("q2");

    const submitResult: SatSubmitResult = {
      is_correct: true,
      correct_answers: ["A"],
      rationale: "because",
      attempts: [],
    };
    act(() => resolveSubmit(jsonResponse(submitResult)));

    await waitFor(() => expect(result.current.isInFlight("q1")).toBe(false));
    expect(result.current.getReveal("q1")).toEqual({
      isCorrect: true,
      correctAnswers: ["A"],
      rationale: "because",
    });
    // q2, the now-current question, was never touched by q1's response.
    expect(result.current.getReveal("q2")).toBeUndefined();
  });

  it("guards submit per question — a slow submit on the current question does not block another", async () => {
    const rows = [row({ id: "q1" }), row({ id: "q2" })];
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/session")) return jsonResponse(rows);
      if (url.includes("/attempts")) return new Promise<Response>(() => {});
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(
      () => useSatSession({ kind: "filter", filter: {} }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.answer("A"));
    act(() => {
      void result.current.submit(5);
    });
    await waitFor(() => expect(result.current.isInFlight("q1")).toBe(true));

    act(() => result.current.goTo(1));
    act(() => result.current.answer("B"));
    // q2 is answerable/submittable independent of q1's in-flight submit.
    expect(result.current.isInFlight("q2")).toBe(false);
    expect(result.current.getAnswer("q2")).toBe("B");
  });
});
