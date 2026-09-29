import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLandingMotion } from "./useLandingMotion";

let intersect: IntersectionObserverCallback;
const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "animate",
);
const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel, onfinish: null }));
const unobserve = vi.fn();
const disconnect = vi.fn();
let preference: EventListener;
let reduced = false;
function Page() {
  const ref = useLandingMotion();
  return (
    <div ref={ref}>
      <span className="lp-headline-line">Hello</span>
      <div className="lp-features-header">Feature</div>
    </div>
  );
}
beforeEach(() => {
  reduced = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_: string, listener: EventListener) => {
        preference = listener;
      },
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe = vi.fn();
      unobserve = unobserve;
      disconnect = disconnect;
    },
  );
  Element.prototype.animate =
    animate as unknown as typeof Element.prototype.animate;
});
afterEach(() => {
  if (originalAnimate)
    Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("animates only a visible feature once and cleans up on unmount", () => {
  const view = render(<Page />);
  const hero = animate.mock.calls.length;
  expect(hero).toBe(0);
  const target = view.getByText("Feature");
  act(() =>
    intersect(
      [
        { target, isIntersecting: true, intersectionRatio: 0.1 },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(animate).toHaveBeenCalledTimes(hero);
  act(() =>
    intersect(
      [
        { target, isIntersecting: true, intersectionRatio: 0.2 },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(animate).toHaveBeenCalledTimes(hero + 1);
  expect(unobserve).toHaveBeenCalledWith(target);
  act(() =>
    intersect(
      [
        { target, isIntersecting: true, intersectionRatio: 0.8 },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(animate).toHaveBeenCalledTimes(hero + 1);
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(cancel).toHaveBeenCalled();
});
it("uses fade-only motion and settles animations on preference changes", () => {
  reduced = true;
  const view = render(<Page />);
  act(() =>
    intersect(
      [
        {
          target: view.getByText("Feature"),
          isIntersecting: true,
          intersectionRatio: 1,
        },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(animate).toHaveBeenCalled();
  for (const call of animate.mock.calls)
    expect(call).toEqual([
      [{ opacity: 0 }, { opacity: 1 }],
      expect.objectContaining({ duration: 150 }),
    ]);
  reduced = false;
  act(() => preference(new Event("change")));
  expect(cancel).toHaveBeenCalled();
});
it("keeps static content visible without observer support", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const view = render(<Page />);
  expect(view.getByText("Feature")).toBeVisible();
});

it("leaves everything static when WAAPI is unavailable", () => {
  Object.defineProperty(Element.prototype, "animate", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  const view = render(<Page />);
  expect(view.getByText("Hello")).toBeVisible();
  expect(animate).not.toHaveBeenCalled();
});
