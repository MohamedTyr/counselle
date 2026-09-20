import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestionTimer } from "./use-question-timer";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useQuestionTimer", () => {
  it("starts at 0, running (Q5)", () => {
    const { result } = renderHook(() => useQuestionTimer("q1"));
    expect(result.current.seconds).toBe(0);
    expect(result.current.isRunning).toBe(true);
  });

  it("counts up once per second while running", () => {
    const { result } = renderHook(() => useQuestionTimer("q1"));
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.seconds).toBe(3);
  });

  it("pause stops the count and resume continues it", () => {
    const { result } = renderHook(() => useQuestionTimer("q1"));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => {
      result.current.pause();
    });
    expect(result.current.isRunning).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.readElapsed()).toBe(2);

    act(() => {
      result.current.resume();
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.readElapsed()).toBe(3);
  });

  it("toggleRunning flips between pause and resume", () => {
    const { result } = renderHook(() => useQuestionTimer("q1"));
    act(() => {
      result.current.toggleRunning();
    });
    expect(result.current.isRunning).toBe(false);
    act(() => {
      result.current.toggleRunning();
    });
    expect(result.current.isRunning).toBe(true);
  });

  it("resets to 0 and forces running on every question-key change (Q5a)", () => {
    const { result, rerender } = renderHook(({ key }) => useQuestionTimer(key), {
      initialProps: { key: "q1" as string | number },
    });

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    act(() => {
      result.current.pause();
    });
    expect(result.current.isRunning).toBe(false);

    rerender({ key: "q2" });

    expect(result.current.seconds).toBe(0);
    expect(result.current.isRunning).toBe(true);
    expect(result.current.readElapsed()).toBe(0);
  });

  it("restarts from 0 even when revisiting an already-timed question (Q6)", () => {
    const { result, rerender } = renderHook(({ key }) => useQuestionTimer(key), {
      initialProps: { key: "q1" as string | number },
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    rerender({ key: "q2" });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    rerender({ key: "q1" });
    expect(result.current.readElapsed()).toBe(0);
  });

  it("readElapsed reads a ref, so it reflects time passed even without a display tick (Q25a)", () => {
    const { result } = renderHook(() => useQuestionTimer("q1"));
    // Advance less than one tick interval — no interval fires, so the
    // display `seconds` value never updates. readElapsed still reports
    // real elapsed time via wall-clock timestamps.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.seconds).toBe(0);
    expect(result.current.readElapsed()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(700);
    });
    // 1100ms real elapsed -> readElapsed floors to 1, independent of
    // whether the 1s display interval has ticked exactly then.
    expect(result.current.readElapsed()).toBe(1);
  });

  it("keeps running across submit / revisit (Q6) — no reset besides a key change", () => {
    const { result } = renderHook(() => useQuestionTimer("q1"));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.isRunning).toBe(true);
    expect(result.current.readElapsed()).toBe(5);
  });
});
