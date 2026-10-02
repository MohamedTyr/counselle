import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PROMPTS, useComposerTypewriter } from "./useComposerTypewriter";

let reduced = false;
function Composer() {
  const text = useRef<HTMLSpanElement>(null);
  useComposerTypewriter(text);
  return (
    <div className="lp-composer">
      <span ref={text} data-testid="text">
        {PROMPTS[0]}
      </span>
    </div>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return reduced;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("holds the first prompt, replaces it, then types the next", () => {
  const view = render(<Composer />);
  const text = view.getByTestId("text");
  act(() => vi.advanceTimersByTime(2000));
  expect(text).toHaveTextContent(PROMPTS[0]);
  act(() => vi.advanceTimersByTime(1000));
  expect(text.textContent).toBe("");
  act(() => vi.advanceTimersByTime(600));
  expect(PROMPTS[1].startsWith(text.textContent ?? "-")).toBe(true);
  expect(text.textContent?.length).toBeGreaterThan(0);
  act(() => vi.advanceTimersByTime(3400));
  expect(text).toHaveTextContent(PROMPTS[1]);
  view.unmount();
  expect(text).toHaveTextContent(PROMPTS[0]);
  expect(vi.getTimerCount()).toBe(0);
});
it("leaves the first prompt in place under reduced motion", () => {
  reduced = true;
  const view = render(<Composer />);
  act(() => vi.advanceTimersByTime(10000));
  expect(view.getByTestId("text")).toHaveTextContent(PROMPTS[0]);
  expect(vi.getTimerCount()).toBe(0);
});
