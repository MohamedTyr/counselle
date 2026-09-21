import { fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SatContent } from "./SatContent";

/**
 * Regression for F1 (parity finding, HIGH): a timer-driven re-render
 * elsewhere in the tree was resetting `.sat-content`'s `innerHTML` every
 * tick, detaching the highlighter's `Range`s even though the sanitised
 * HTML string never changed. React's DOM-prop differ compares
 * `dangerouslySetInnerHTML` by the wrapper *object's reference*, not by its
 * `__html` string — a fresh `{ __html: sanitized }` object literal on every
 * render fails that reference check and forces a real `innerHTML` write.
 * `SatContent` now memoises that wrapper object so its reference is stable
 * whenever the sanitised string is unchanged.
 *
 * This is a real React `react-dom` diffing behavior (not a browser-only
 * quirk), so — unlike the `clipRangeToElement` fix in the same finding —
 * it reproduces deterministically under jsdom.
 */
describe("SatContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not rewrite innerHTML on an unrelated parent re-render", () => {
    const setInnerHTMLSpy = vi.spyOn(
      Object.getPrototypeOf(document.createElement("div")),
      "innerHTML",
      "set",
    );

    function Harness() {
      // Mirrors SatPractice: a sibling timer tick re-renders this
      // component's whole subtree, including SatContent, on an interval —
      // SatContent's own props (contentSha/field/html) never change.
      const [tick, setTick] = useState(0);
      return (
        <div>
          <button onClick={() => setTick((t) => t + 1)} type="button">
            tick {tick}
          </button>
          <SatContent contentSha="sha-abc" field="stem" html="<p>Hello world</p>" />
        </div>
      );
    }

    const { getByRole } = render(<Harness />);
    const writesAfterMount = setInnerHTMLSpy.mock.calls.length;
    expect(writesAfterMount).toBeGreaterThan(0);

    setInnerHTMLSpy.mockClear();

    // Three re-renders from state completely unrelated to SatContent's own
    // props — exactly what the question timer does once a second.
    fireEvent.click(getByRole("button"));
    fireEvent.click(getByRole("button"));
    fireEvent.click(getByRole("button"));

    expect(setInnerHTMLSpy).not.toHaveBeenCalled();
  });
});
