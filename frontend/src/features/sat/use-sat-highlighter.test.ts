import { describe, expect, it } from "vitest";

import { clipRangeToElement } from "./use-sat-highlighter";

/** Regression coverage for the two clipRangeToElement bugs found by the P7
 * parity pass (Finding 1): the overlap check against a container-typed
 * boundary (`selectNodeContents`'s child-index points) does not reliably
 * compare against a text-node boundary at the same logical position, which
 * made every gesture (including a plain interior selection) register as
 * "no overlap" in some DOM shapes, and definitely broke a selection that
 * starts inside a field and extends past its end. */
describe("clipRangeToElement", () => {
  function buildFixture() {
    document.body.innerHTML =
      '<div id="prev"><p>Prev <em>text</em> here.</p></div>' +
      '<div id="stem"><p>Hello <b>world</b> this is a stem.</p></div>' +
      '<div id="next"><p>Next <i>sibling</i> text.</p></div>';
    const stem = document.getElementById("stem") as HTMLElement;
    const prev = document.getElementById("prev") as HTMLElement;
    const next = document.getElementById("next") as HTMLElement;
    return { stem, prev, next };
  }

  it("clips an interior selection to itself, unchanged", () => {
    const { stem } = buildFixture();
    const worldText = stem.querySelector("b")!.firstChild!;
    const range = document.createRange();
    range.setStart(worldText, 1);
    range.setEnd(worldText, 3);

    const clipped = clipRangeToElement(range, stem);
    expect(clipped).not.toBeNull();
    expect(clipped!.toString()).toBe("or");
  });

  it("clips a selection that starts inside the field and extends past its end into a sibling (triple-click overextend)", () => {
    const { stem, next } = buildFixture();
    const stemFirstText = stem.querySelector("p")!.firstChild!;
    const nextText = next.querySelector("i")!.firstChild!;
    const range = document.createRange();
    range.setStart(stemFirstText, 0);
    range.setEnd(nextText, 3);

    const clipped = clipRangeToElement(range, stem);
    expect(clipped).not.toBeNull();
    expect(clipped!.toString()).toBe("Hello world this is a stem.");
  });

  it("clips a selection that starts before the field and ends inside it", () => {
    const { stem, prev } = buildFixture();
    const prevText = prev.querySelector("em")!.firstChild!;
    const stemLastText = stem.querySelector("p")!.lastChild!;
    const range = document.createRange();
    range.setStart(prevText, 1);
    range.setEnd(stemLastText, 5);

    const clipped = clipRangeToElement(range, stem);
    expect(clipped).not.toBeNull();
    expect(clipped!.toString()).toBe("Hello world this");
  });

  it("returns null for a selection entirely outside the field", () => {
    const { stem, prev, next } = buildFixture();
    const prevText = prev.querySelector("em")!.firstChild!;
    const before = document.createRange();
    before.setStart(prevText, 0);
    before.setEnd(prevText, 3);
    expect(clipRangeToElement(before, stem)).toBeNull();

    const nextText = next.querySelector("i")!.firstChild!;
    const after = document.createRange();
    after.setStart(nextText, 0);
    after.setEnd(nextText, 3);
    expect(clipRangeToElement(after, stem)).toBeNull();
  });
});
