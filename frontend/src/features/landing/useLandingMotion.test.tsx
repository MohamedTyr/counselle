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
function Page({ examples = false }: { examples?: boolean }) {
  const ref = useLandingMotion();
  return (
    <div ref={ref}>
      <span className="lp-headline-line">Hello</span>
      <div className="lp-features-cards">
        <div className="lp-cards">
          <article className="lp-card-wide">Feature</article>
          {examples && (
            <>
              <article
                className="lp-card-wide lp-card-essay"
                data-testid="essay"
              >
                {["g", "v", "a"].map((tone) => (
                  <mark className={`lp-hl-${tone}`} key={tone}>
                    Stationary text
                    <span className="lp-hl-background" />
                    <span className="lp-note" />
                  </mark>
                ))}
              </article>
              <div className="lp-card-row" data-testid="row">
                <article />
                <article />
                <article />
              </div>
            </>
          )}
        </div>
      </div>
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
it("sweeps essay highlights before their notes, and reveals a card row as one block", () => {
  const view = render(<Page examples />);
  animate.mockClear();
  act(() =>
    intersect(
      [
        {
          target: view.getByTestId("essay"),
          isIntersecting: true,
          intersectionRatio: 1,
        },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(animate).toHaveBeenCalledTimes(6);
  expect(animate).toHaveBeenNthCalledWith(
    1,
    [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
    expect.objectContaining({ delay: 0 }),
  );
  const [, noteTiming] = animate.mock.calls[1] as unknown as [
    Keyframe[],
    KeyframeAnimationOptions,
  ];
  expect(Number(noteTiming.delay)).toBeGreaterThan(0);
  const delays = animate.mock.calls.map((call) =>
    Number(
      (call as unknown as [Keyframe[], KeyframeAnimationOptions])[1].delay,
    ),
  );
  expect(delays).toEqual([...delays].sort((a, b) => a - b));
  animate.mockClear();
  act(() =>
    intersect(
      [
        {
          target: view.getByTestId("row"),
          isIntersecting: true,
          intersectionRatio: 1,
        },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(animate).toHaveBeenCalledTimes(1);
});
