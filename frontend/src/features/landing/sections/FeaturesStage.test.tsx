import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeaturesStage } from "./FeaturesStage";
vi.mock("./featureList", () => ({
  stageTabId: ({ id }: { id: string }) => `lp-stage-tab-${id}`,
  FEATURES: ["essay", "colleges", "sat"].map((id) => ({
    id,
    title: id,
    blurb: `${id} description`,
    color: id === "essay" ? "red" : id === "colleges" ? "green" : "blue",
    size: "wide",
    Sheet: () => (
      <div>
        {id} illustration
        {id === "essay" &&
          ["g", "v", "a"].map((tone) => (
            <mark key={tone} className={`lp-hl-${tone}`}>
              <span className="lp-hl-background" />
              <span className="lp-note" />
            </mark>
          ))}
      </div>
    ),
  })),
}));
let intersect: IntersectionObserverCallback;
let preferenceChanged: (() => void) | undefined;
let reduced = false;
const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "animate",
);
function mockAnimations() {
  const cancel = vi.fn();
  const animate = vi.fn<
    (frames: Keyframe[], options: KeyframeAnimationOptions) => object
  >(() => ({
    cancel,
    play: vi.fn(),
    pause: vi.fn(),
    // A sheet that never finishes leaving stays mounted, which the tests can see.
    finished: new Promise(() => {}),
  }));
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  return { animate, cancel };
}
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  preferenceChanged = undefined;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query.includes("pointer: fine") || reduced;
      },
      addEventListener: (_: string, listener: () => void) => {
        preferenceChanged = listener;
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
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  if (originalAnimate)
    Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function enter() {
  act(() =>
    intersect(
      [
        { isIntersecting: true, intersectionRatio: 1 },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
}
it("offers explicit pause and keeps autoplay stopped until resumed", () => {
  render(<FeaturesStage />);
  enter();
  fireEvent.click(screen.getByRole("button", { name: "Pause showcase" }));
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByRole("tab", { name: /essay/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Play showcase" }));
  act(() => vi.advanceTimersByTime(5100));
  expect(screen.getByRole("tab", { name: /colleges/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
it("keyboard selection is immediate, focusable, and pauses automatic updates", () => {
  render(<FeaturesStage />);
  enter();
  const first = screen.getByRole("tab", { name: /essay/ });
  fireEvent.keyDown(first, { key: "ArrowDown" });
  const second = screen.getByRole("tab", { name: /colleges/ });
  expect(second).toHaveFocus();
  expect(second).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    second.id,
  );
  act(() => vi.advanceTimersByTime(8000));
  expect(second).toHaveAttribute("aria-selected", "true");
});
it("explicit Play resumes even while the playback control is focused", () => {
  render(<FeaturesStage />);
  enter();
  const button = screen.getByRole("button", { name: "Pause showcase" });
  act(() => button.focus());
  fireEvent.click(button);
  fireEvent.click(screen.getByRole("button", { name: "Play showcase" }));
  act(() => vi.advanceTimersByTime(5100));
  expect(screen.getByRole("tab", { name: /colleges/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
it("stops timers offscreen and clears timers on unmount", () => {
  const view = render(<FeaturesStage />);
  enter();
  act(() =>
    intersect(
      [
        { isIntersecting: false, intersectionRatio: 0 },
      ] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByRole("tab", { name: /essay/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  enter();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("keeps a usable manually selectable stage when observation is unsupported", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  render(<FeaturesStage />);
  fireEvent.click(screen.getByRole("tab", { name: /sat/ }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent("sat illustration");
  expect(vi.getTimerCount()).toBe(0);
});
it("suspends automatic updates while the document is hidden", () => {
  render(<FeaturesStage />);
  enter();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByRole("tab", { name: /essay/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  hidden.mockRestore();
});

it("starts paused for touch pointers and requires explicit Play", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  render(<FeaturesStage />);
  enter();
  expect(screen.getByRole("button", { name: "Play showcase" })).toBeVisible();
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByRole("tab", { name: /essay/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Play showcase" }));
  act(() => vi.advanceTimersByTime(5100));
  expect(screen.getByRole("tab", { name: /colleges/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

it("mouse hover suspends playback while touch entry does not", () => {
  const view = render(<FeaturesStage />);
  enter();
  const root = view.container.querySelector(".lp-stage")!;
  function pointer(type: string, pointerType: string) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    fireEvent(root, event);
  }
  pointer("pointerover", "touch");
  expect(root).toHaveClass("lp-stage-playing");
  pointer("pointerout", "touch");
  pointer("pointerover", "mouse");
  expect(root).not.toHaveClass("lp-stage-playing");
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByRole("tab", { name: /essay/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  pointer("pointerout", "mouse");
  expect(root).toHaveClass("lp-stage-playing");
});
it("focus pauses within the stage and resumes only when focus leaves", () => {
  const view = render(<FeaturesStage />);
  enter();
  const root = view.container.querySelector(".lp-stage")!;
  const first = screen.getByRole("tab", { name: /essay/ });
  const second = screen.getByRole("tab", { name: /colleges/ });
  act(() => first.focus());
  fireEvent.blur(first, { relatedTarget: second });
  expect(root).not.toHaveClass("lp-stage-playing");
  fireEvent.blur(second, { relatedTarget: document.body });
  expect(root).toHaveClass("lp-stage-playing");
});
it("Home and End move focus while unrelated keys leave selection alone", () => {
  render(<FeaturesStage />);
  enter();
  const first = screen.getByRole("tab", { name: /essay/ });
  fireEvent.keyDown(first, { key: "End" });
  expect(screen.getByRole("tab", { name: /sat/ })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("tab", { name: /sat/ }), { key: "Home" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Escape" });
  expect(first).toHaveAttribute("aria-selected", "true");
});
const RISE = [
  { opacity: 0, transform: "translateY(16px)" },
  { opacity: 1, transform: "none" },
];
const sheets = (view: { container: HTMLElement }) =>
  view.container.querySelectorAll(".lp-stage-figure");

it("holds the timer in place under a pointer and carries on from there", () => {
  const view = render(<FeaturesStage />);
  enter();
  const root = view.container.querySelector(".lp-stage")!;
  function pointer(type: string) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    fireEvent(root, event);
  }
  act(() => vi.advanceTimersByTime(3000));
  pointer("pointerover");
  act(() => vi.advanceTimersByTime(1000));
  pointer("pointerout");
  act(() => vi.advanceTimersByTime(1400));
  expect(screen.getByRole("tab", { name: /essay/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  act(() => vi.advanceTimersByTime(200));
  expect(screen.getByRole("tab", { name: /colleges/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
it("a pointer press does not leave the stage held by focus", () => {
  const view = render(<FeaturesStage />);
  enter();
  const root = view.container.querySelector(".lp-stage")!;
  const tab = screen.getByRole("tab", { name: /colleges/ });
  fireEvent.pointerDown(tab);
  act(() => tab.focus());
  fireEvent.click(tab, { detail: 1 });
  expect(root).toHaveClass("lp-stage-playing");
});
it("settles on preference changes and fades manual transitions", () => {
  const { animate, cancel } = mockAnimations();
  const view = render(<FeaturesStage />);
  enter();
  expect(animate).toHaveBeenCalled();
  const started = animate.mock.calls.length;
  act(() => {
    reduced = true;
    preferenceChanged?.();
  });
  expect(cancel).toHaveBeenCalledTimes(started - 1);
  expect(screen.queryByRole("button", { name: /showcase/ })).toBeNull();
  animate.mockClear();
  fireEvent.click(screen.getByRole("tab", { name: /colleges/ }), { detail: 1 });
  expect(sheets(view)).toHaveLength(2);
  for (const [frames, options] of animate.mock.calls) {
    expect(options.duration).toBeLessThanOrEqual(200);
    for (const frame of frames) expect(frame.transform ?? "none").toBe("none");
  }
  expect(vi.getTimerCount()).toBe(0);
});
it("replaces a sheet by letting the old one leave, and replays a feature chosen again", () => {
  const { animate } = mockAnimations();
  const view = render(<FeaturesStage />);
  enter();
  const notes = () =>
    animate.mock.contexts.filter((node) =>
      (node as Element).classList.contains("lp-note"),
    ).length;
  expect(notes()).toBe(3);
  expect(animate).not.toHaveBeenCalledWith(RISE, expect.anything());
  fireEvent.click(screen.getByRole("tab", { name: /colleges/ }), { detail: 1 });
  expect(sheets(view)).toHaveLength(2);
  expect(sheets(view)[0]).toHaveClass("lp-stage-figure-leaving");
  expect(sheets(view)[0]).toHaveTextContent("essay illustration");
  expect(animate).toHaveBeenCalledWith(
    RISE,
    expect.objectContaining({ duration: 500 }),
  );
  fireEvent.click(screen.getByRole("tab", { name: /essay/ }), { detail: 1 });
  // Only the newest outgoing sheet is kept; the one before it is gone.
  expect(sheets(view)).toHaveLength(2);
  expect(sheets(view)[0]).toHaveTextContent("colleges illustration");
  expect(notes()).toBe(6);
  fireEvent.keyDown(screen.getByRole("tab", { name: /essay/ }), {
    key: "ArrowDown",
  });
  expect(sheets(view)).toHaveLength(1);
});
