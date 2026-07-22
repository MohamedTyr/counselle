import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { useClarifyDraft, type ClarifyDraftKey } from "./useClarifyDraft";

const draftKey: ClarifyDraftKey = {
  sessionId: "session-1",
  clarifyMessageId: "assistant-1",
  specVersion: 2,
  specIdentity: "spec-1",
};

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("useClarifyDraft", () => {
  test("hydrates selected options, custom text, and current question after remount", () => {
    const first = renderHook(() => useClarifyDraft(draftKey));

    act(() => {
      first.result.current.setCurrentQuestionIndex(1);
      first.result.current.setQuestionAnswer("q1", (previous) => ({
        ...previous,
        selectedOptionIds: ["q1_o1"],
        customText: "Keep the debt cap visible.",
      }));
    });
    first.unmount();

    const second = renderHook(() => useClarifyDraft(draftKey));

    expect(second.result.current.draft.currentQuestionIndex).toBe(1);
    expect(second.result.current.answerForQuestion("q1")).toEqual({
      selectedOptionIds: ["q1_o1"],
      customText: "Keep the debt cap visible.",
      validationError: null,
    });
  });

  test("clears persisted draft once the clarification is answered", () => {
    const first = renderHook(() => useClarifyDraft(draftKey));

    act(() => {
      first.result.current.setQuestionAnswer("q1", (previous) => ({
        ...previous,
        selectedOptionIds: ["q1_o1"],
      }));
      first.result.current.markAnswered();
    });
    first.unmount();

    const second = renderHook(() => useClarifyDraft(draftKey));

    expect(second.result.current.answerForQuestion("q1")).toEqual({
      selectedOptionIds: [],
      customText: "",
      validationError: null,
    });
  });

  test("clears persisted draft when the active clarification disappears", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: ClarifyDraftKey }) => useClarifyDraft(key),
      { initialProps: { key: draftKey } },
    );

    act(() => {
      result.current.setQuestionAnswer("q1", (previous) => ({
        ...previous,
        selectedOptionIds: ["q1_o1"],
      }));
    });
    rerender({ key: null });

    const remount = renderHook(() => useClarifyDraft(draftKey));
    expect(remount.result.current.answerForQuestion("q1")).toEqual({
      selectedOptionIds: [],
      customText: "",
      validationError: null,
    });
  });
});
