import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { burstTime, useIllustrationMotion } from "./useIllustrationMotion";
import { SatSheet } from "./cards/SatCard";
import { DeadlinesSheet } from "./cards/DeadlinesCard";
import { AskSheet } from "./cards/colleges/AskSheet";

type Call = [Keyframe[], KeyframeAnimationOptions];
const calls = () => animate.mock.calls as unknown as Call[];
const targets = () => animate.mock.contexts as HTMLElement[];

const motions: {
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}[] = [];
const animate = vi.fn(() => {
  const motion = { pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
  motions.push(motion);
  return motion;
});
const original = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
function Example({
  feature = "activities",
  inView = true,
  hidden = false,
  paused = false,
  keyboard = false,
  reduced = false,
} = {}) {
  const root = useRef<HTMLDivElement>(null);
  useIllustrationMotion(root, {
    feature,
    inView,
    hidden,
    paused,
    keyboard,
    reduced,
  });
  return (
    <div ref={root}>
      {feature === "sat" && <SatSheet />}
      {feature === "deadlines" && <DeadlinesSheet />}
      {feature === "colleges" && <AskSheet />}
      <div className="lp-activity-viewport">
        <div className="lp-activity-list">
          <div data-scroll-cycle>Activities</div>
          <div aria-hidden="true">Activities copy</div>
        </div>
      </div>
      <div className="lp-stream">
        <div data-scroll-cycle>Scholarships</div>
        <div aria-hidden="true">Scholarships copy</div>
      </div>
    </div>
  );
}
beforeEach(() => {
  motions.length = 0;
  vi.stubGlobal("IntersectionObserver", class {});
  Element.prototype.animate =
    animate as unknown as typeof Element.prototype.animate;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(220);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  animate.mockClear();
  if (original) Object.defineProperty(Element.prototype, "animate", original);
  else Reflect.deleteProperty(Element.prototype, "animate");
});
it.each(["activities", "scholarships"])(
  "bursts %s through whole cycles, wrapping at the seam, forever",
  (feature) => {
    render(<Example feature={feature} />);
    const [frames, options] = calls().find(
      ([, timing]) => timing.iterations === Infinity,
    )!;
    expect(options).toEqual(
      expect.objectContaining({ delay: 550, duration: 3700 }),
    );
    expect(frames[0]).toEqual({ transform: "translateY(0)", offset: 0 });
    expect(frames[frames.length - 1]).toEqual({
      transform: "translateY(-220px)",
      offset: 1,
    });
    const offsets = frames.map((frame) => Number(frame.offset));
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    // Every wrap lands exactly on the seam: -220px, then 0 at the same moment.
    const wraps = frames.filter(
      (frame, index) =>
        frame.transform === "translateY(0)" &&
        frames[index - 1]?.transform === "translateY(-220px)",
    );
    expect(wraps.length).toBeGreaterThan(3);
    wraps.forEach((wrap) => {
      const index = frames.indexOf(wrap);
      expect(frames[index - 1].offset).toBe(wrap.offset);
    });
  },
);
it("winds a burst up slowly before it runs fast", () => {
  expect(burstTime(0)).toBe(0);
  expect(burstTime(1)).toBe(1);
  expect(burstTime(0.1)).toBeGreaterThan(0.2);
  expect(burstTime(0.9) - burstTime(0.5)).toBeLessThan(0.3);
});
it("does not animate an unmeasurable track", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(0);
  render(<Example />);
  expect(animate).not.toHaveBeenCalled();
});
it("pauses and resumes the same timeline for visibility and explicit pause", () => {
  const view = render(<Example inView={false} />);
  expect(animate).not.toHaveBeenCalled();
  view.rerender(<Example />);
  expect(motions[0].play).toHaveBeenCalledTimes(1);
  view.rerender(<Example hidden />);
  view.rerender(<Example paused />);
  view.rerender(<Example />);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(motions[0].play).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(motions[0].cancel).toHaveBeenCalledTimes(1);
});
it("cancels old feature on selection and settles on reduced motion", () => {
  const view = render(<Example />);
  view.rerender(<Example feature="scholarships" />);
  expect(motions[0].cancel).toHaveBeenCalledTimes(1);
  expect(animate).toHaveBeenLastCalledWith(
    expect.arrayContaining([{ transform: "translateY(-220px)", offset: 1 }]),
    expect.objectContaining({
      duration: 3700,
      delay: 550,
      iterations: Infinity,
    }),
  );
  view.rerender(<Example feature="scholarships" reduced />);
  expect(motions[1].cancel).toHaveBeenCalledTimes(1);
  expect(animate).toHaveBeenCalledTimes(2);
});
it("leaves keyboard selections and the existing essay sequence alone", () => {
  const view = render(<Example keyboard />);
  view.rerender(<Example feature="essay" />);
  expect(animate).not.toHaveBeenCalled();
});
it("keeps illustrations visible without WAAPI", () => {
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  const view = render(<Example />);
  expect(view.getByText("Activities")).toBeVisible();
});
it("confirms the list is saved before its schools arrive", () => {
  render(<Example feature="colleges" />);
  const delayOf = (index: number) => Number(calls()[index][1].delay);
  const saved = targets().findIndex((node) =>
    node.matches(".lp-cx-ask-saved"),
  );
  const rows = targets().flatMap((node, index) =>
    node.matches(".lp-cx-ask-row") ? [index] : [],
  );
  expect(saved).toBeGreaterThan(-1);
  expect(rows).toHaveLength(5);
  for (const index of rows) {
    expect(delayOf(saved)).toBeLessThan(delayOf(index));
  }
  expect(calls().some(([, options]) => options.iterations === Infinity)).toBe(
    false,
  );
});

it("holds new selections still while paused and starts their loop on Play", () => {
  const view = render(<Example />);
  view.rerender(<Example paused />);
  view.rerender(<Example feature="scholarships" paused />);
  expect(motions[0].cancel).toHaveBeenCalledTimes(1);
  expect(animate).toHaveBeenCalledTimes(1);
  view.rerender(<Example feature="scholarships" />);
  expect(animate).toHaveBeenCalledTimes(2);
});
it("leaves the complete illustration visible without an observer", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const view = render(<Example inView={false} />);
  expect(animate).not.toHaveBeenCalled();
  expect(view.getByText("Activities")).toBeVisible();
});

it("never restarts a completed sequence on visibility reentry", () => {
  const view = render(<Example />);
  Object.assign(motions[0], { playState: "finished" });
  view.rerender(<Example inView={false} />);
  view.rerender(<Example />);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(motions[0].pause).not.toHaveBeenCalled();
  expect(motions[0].play).toHaveBeenCalledTimes(1);
});

it("stages the SAT feedback in teaching order and streams the reply by word", () => {
  const view = render(<Example feature="sat" />);
  const first = (selector: string) =>
    targets().findIndex((node) => node.matches(selector));
  const delay = (index: number) => Number(calls()[index][1].delay);
  const order = [
    ".lp-choice-wrong",
    ".lp-choice-wrong .lp-choice-verdict",
    ".lp-choice-correct .lp-choice-verdict",
    ".lp-ask-user-row",
    ".lp-ask-typing",
    ".lp-ask-answer .lp-word",
  ].map(first);
  expect(order.every((index) => index > -1)).toBe(true);
  expect(order.map(delay)).toEqual([...order.map(delay)].sort((a, b) => a - b));
  const words = view.container.querySelectorAll(".lp-ask-answer .lp-word");
  expect(words.length).toBeGreaterThan(20);
  expect(view.container.querySelector(".lp-ask-answer")).toHaveTextContent(
    "subtract 5 to get 31.",
  );
  expect(targets().some((node) => node.matches(".lp-question-text"))).toBe(
    false,
  );
  expect(
    calls().every(
      ([, options]) => Number(options.delay) + Number(options.duration) < 7000,
    ),
  ).toBe(true);
});
it("introduces deadlines, then fills the box, draws the tick and strikes the task", () => {
  render(<Example feature="deadlines" />);
  const boxIndex = targets().findIndex((node) =>
    node.matches(".lp-checkbox-done rect"),
  );
  const tickIndex = targets().findIndex((node) =>
    node.matches(".lp-checkbox-tick"),
  );
  const strikeIndex = targets().findIndex((node) =>
    node.matches(".lp-task-done s"),
  );
  const deadlines = targets().flatMap((node, index) =>
    node.matches(".lp-deadline") ? [index] : [],
  );
  expect(deadlines.length).toBeGreaterThan(0);
  expect([boxIndex, tickIndex, strikeIndex].every((i) => i > -1)).toBe(true);
  const delay = (index: number) => Number(calls()[index][1].delay);
  for (const index of deadlines)
    expect(delay(index)).toBeLessThan(delay(boxIndex));
  expect(delay(boxIndex)).toBeLessThan(delay(tickIndex));
  expect(delay(tickIndex)).toBeLessThan(delay(strikeIndex));
  expect(calls()[strikeIndex][1].pseudoElement).toBe("::after");
});
