import { act, renderHook } from "@testing-library/react";
import { useComposerDraft } from "./useComposerDraft";

beforeEach(() => sessionStorage.clear());
it("restores unsent text after a session-expiry unmount for the same owner and conversation", () => {
  const first = renderHook(() => useComposerDraft("owner-a", "conversation"));
  act(() => first.result.current[1]("Keep my question"));
  first.unmount();
  const returning = renderHook(() =>
    useComposerDraft("owner-a", "conversation"),
  );
  expect(returning.result.current[0]).toBe("Keep my question");
});
it("never restores another owner's or conversation's draft", () => {
  const first = renderHook(() => useComposerDraft("owner-a", "one"));
  act(() => first.result.current[1]("Private question"));
  expect(
    renderHook(() => useComposerDraft("owner-b", "one")).result.current[0],
  ).toBe("");
  expect(
    renderHook(() => useComposerDraft("owner-a", "two")).result.current[0],
  ).toBe("");
});
it("clears a submitted draft and persists a failed submission after unmount", () => {
  const first = renderHook(() => useComposerDraft("owner-a", "one"));
  const setValue = first.result.current[1];
  act(() => setValue("Question"));
  act(() => setValue(""));
  expect(
    renderHook(() => useComposerDraft("owner-a", "one")).result.current[0],
  ).toBe("");
  first.unmount();
  act(() => setValue("Question"));
  expect(
    renderHook(() => useComposerDraft("owner-a", "one")).result.current[0],
  ).toBe("Question");
});
it("keeps working when browser storage is unavailable", () => {
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const draft = renderHook(() => useComposerDraft("owner", "one"));
  act(() => draft.result.current[1]("Still editable"));
  expect(draft.result.current[0]).toBe("Still editable");
  spy.mockRestore();
});
it("retains an untouched onboarding prefill after its router state is consumed", () => {
  const initial = renderHook(() =>
    useComposerDraft("owner", "new", "Help plan my timeline"),
  );
  initial.unmount();
  expect(
    renderHook(() => useComposerDraft("owner", "new")).result.current[0],
  ).toBe("Help plan my timeline");
});
