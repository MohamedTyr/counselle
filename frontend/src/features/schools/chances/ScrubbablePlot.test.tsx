import * as React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, test, vi } from "vitest";

import { ScrubbablePlot, useIsScrubbing } from "./ScrubbablePlot";

expect.extend(toHaveNoViolations);

const WINDOW = { lo: 3, hi: 4 };
const LANE = { key: "gpa" as const, min: 0, max: 4, step: 0.01 };

function harness(overrides: Partial<React.ComponentProps<typeof ScrubbablePlot>> = {}) {
  const onScenarioChange = vi.fn();
  const { container, ...rest } = render(
    <div style={{ position: "relative", height: 132, width: 300 }}>
      <ScrubbablePlot
        ariaLabel="GPA"
        ariaValueText={(value) => `Scenario set to ${value.toFixed(2)} GPA.`}
        formatDisplay={(value) => value.toFixed(2)}
        height={132}
        lane={LANE}
        onScenarioChange={onScenarioChange}
        savedValue={null}
        value={null}
        window={WINDOW}
        {...overrides}
      />
    </div>,
  );
  const control = container.querySelector(
    '[data-slot="scrubbable-plot-control"]',
  )!;
  mockControlGeometry(control);
  return { container, control, onScenarioChange, ...rest };
}

/** jsdom has neither real layout nor pointer capture — mock both the way
 * `components/ui/slider.test.tsx` does for the same reason. */
function mockControlGeometry(control: Element) {
  Object.defineProperties(control, {
    hasPointerCapture: { value: vi.fn(() => false) },
    releasePointerCapture: { value: vi.fn() },
    setPointerCapture: { value: vi.fn() },
  });
  vi.spyOn(control, "getBoundingClientRect").mockReturnValue({
    bottom: 132,
    height: 132,
    left: 0,
    right: 300,
    toJSON: () => ({}),
    top: 0,
    width: 300,
    x: 0,
    y: 0,
  });
}

describe("ScrubbablePlot", () => {
  test("renders no mark until a value exists, but stays focusable and accessible", async () => {
    const { container } = harness();

    const slider = screen.getByRole("slider", { name: "GPA" });
    expect(slider).toHaveAttribute("tabindex", "0");
    expect(container.querySelector('[data-slot="you-mark"]')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  test("FIX 1: never asserts an invented aria-valuenow, and states absence honestly on aria-valuetext instead", () => {
    const { control } = harness();

    // The window midpoint (`shown`'s own fallback for layout purposes only)
    // must never be announced as if it were a real value the student set —
    // that is the exact honesty violation the visible mark already guards
    // against (no pill/rule rendered while `value === null`).
    expect(control).not.toHaveAttribute("aria-valuenow");
    expect(control).toHaveAttribute("aria-valuetext", "No GPA set");
  });

  test("FIX 1: a real saved value restores the native aria-valuenow announcement, with no absence text", () => {
    const { control } = harness({ savedValue: 3.5, value: 3.5 });

    expect(control).toHaveAttribute("aria-valuenow", "3.5");
    expect(control).not.toHaveAttribute("aria-valuetext");
  });

  test("FIX 1: the absence text names the lane, matching every no-value fixture (SAT Math, ACT composite, ...)", () => {
    const { control } = harness({ ariaLabel: "SAT Math" });
    expect(control).toHaveAttribute("aria-valuetext", "No SAT Math score set");
  });

  test("drag follows the pointer 1:1, snapped to the lane's step grid, and issues no scenario change until pointer down", () => {
    const { control, onScenarioChange } = harness({ savedValue: 3.5, value: 3.5 });

    fireEvent.pointerDown(control, { button: 0, clientX: 210, pointerId: 1 });
    // 210/300 = 0.7 of the window → 3 + 0.7 = 3.70, already on the 0.01 grid.
    expect(onScenarioChange).toHaveBeenLastCalledWith(3.7);

    fireEvent.pointerMove(control, { clientX: 240, pointerId: 1 });
    // 240/300 = 0.8 → 3.80, live during the drag with no separate commit step.
    expect(onScenarioChange).toHaveBeenLastCalledWith(3.8);

    fireEvent.pointerUp(control, { clientX: 240, pointerId: 1 });
    expect(onScenarioChange).toHaveBeenCalledTimes(2);
  });

  test("keyboard steps by the lane's step, PageUp/PageDown by ten steps, and Home/End to the window ends", () => {
    const { control, onScenarioChange } = harness({ savedValue: 3.5, value: 3.5 });

    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(onScenarioChange).toHaveBeenLastCalledWith(3.51);
    fireEvent.keyDown(control, { key: "ArrowLeft" });
    expect(onScenarioChange).toHaveBeenLastCalledWith(3.49);
    fireEvent.keyDown(control, { key: "PageUp" });
    expect(onScenarioChange).toHaveBeenLastCalledWith(3.6);
    fireEvent.keyDown(control, { key: "PageDown" });
    expect(onScenarioChange).toHaveBeenLastCalledWith(3.4);
    fireEvent.keyDown(control, { key: "Home" });
    expect(onScenarioChange).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(control, { key: "End" });
    expect(onScenarioChange).toHaveBeenLastCalledWith(4);
  });

  test("reuses scenarioSetCopy() verbatim as aria-valuetext only while a scenario is live, never for the plain saved value", () => {
    // A controlled wrapper, standing in for `GpaComparison.tsx`'s own
    // state round-trip: `onScenarioChange` feeds back into `value` the way
    // the panel's real scenario state does.
    function Controlled() {
      const [value, setValue] = React.useState<number | null>(3.5);
      return (
        <div style={{ position: "relative", height: 132, width: 300 }}>
          <ScrubbablePlot
            ariaLabel="GPA"
            ariaValueText={(next) => `Scenario set to ${next.toFixed(2)} GPA.`}
            formatDisplay={(next) => next.toFixed(2)}
            height={132}
            lane={LANE}
            onScenarioChange={(next) => setValue(next ?? 3.5)}
            savedValue={3.5}
            value={value}
            window={WINDOW}
          />
        </div>
      );
    }
    const { container } = render(<Controlled />);
    const control = container.querySelector('[data-slot="scrubbable-plot-control"]')!;
    mockControlGeometry(control);

    // No scenario active: the mark is just the saved value, so the native
    // aria-valuenow announcement is truthful on its own — "Scenario set to
    // 3.50 GPA" would misstate an unedited profile value as a hypothetical.
    expect(control).not.toHaveAttribute("aria-valuetext");

    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(control).toHaveAttribute("aria-valuetext", "Scenario set to 3.51 GPA.");
  });

  test("Enter opens exact entry at the pill; a valid commit updates the value and an off-grid entry shows errorCopy() without committing", async () => {
    const { onScenarioChange } = harness({ savedValue: 3.5, value: 3.5 });
    const control = screen.getByRole("slider", { name: "GPA" });

    fireEvent.keyDown(control, { key: "Enter" });
    const input = await screen.findByLabelText("Enter an exact value");
    expect(input).toHaveFocus();

    fireEvent.input(input, { target: { value: "3.555" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Use increments of 0.01")).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onScenarioChange).not.toHaveBeenCalled();

    fireEvent.input(input, { target: { value: "3.6" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onScenarioChange).toHaveBeenLastCalledWith(3.6);
    expect(control).toHaveFocus();
  });

  test("Escape cancels exact entry without committing", async () => {
    const { onScenarioChange } = harness({ savedValue: 3.5, value: 3.5 });
    const control = screen.getByRole("slider", { name: "GPA" });

    fireEvent.keyDown(control, { key: "Enter" });
    const input = await screen.findByLabelText("Enter an exact value");
    fireEvent.input(input, { target: { value: "3.6" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByLabelText("Enter an exact value")).toBeNull();
    expect(onScenarioChange).not.toHaveBeenCalled();
    expect(control).toHaveFocus();
  });

  test("Reset shows only while the scenario differs from the saved value, and clears it on click", () => {
    const { onScenarioChange, rerender } = harness({ savedValue: 3.5, value: 3.5 });
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

    rerender(
      <div style={{ position: "relative", height: 132, width: 300 }}>
        <ScrubbablePlot
          ariaLabel="GPA"
          ariaValueText={(value) => `Scenario set to ${value.toFixed(2)} GPA.`}
          formatDisplay={(value) => value.toFixed(2)}
          height={132}
          lane={LANE}
          onScenarioChange={onScenarioChange}
          savedValue={3.5}
          value={3.9}
          window={WINDOW}
        />
      </div>,
    );
    const reset = screen.getByRole("button", { name: "Reset" });
    fireEvent.click(reset);
    expect(onScenarioChange).toHaveBeenLastCalledWith(null);
  });
});

/**
 * FIX 1/7: the `aria-busy` scrubbing machinery (`beginScrubbing`/
 * `endScrubbing` in ScrubbablePlot.tsx) had zero test coverage before this
 * round — the exact gap that let a permanently-stuck `aria-busy` ship.
 * `BusyIndicator` stands in for the real consumer
 * (`SchoolChancesPanel.tsx`'s verdict paragraph), reading the same
 * `useIsScrubbing()` hook this plot's drag drives.
 */
function BusyIndicator(): React.ReactElement {
  const busy = useIsScrubbing();
  return <div aria-busy={busy} data-testid="busy" />;
}

function renderWithBusyIndicator(mounted: boolean) {
  return render(
    <>
      <BusyIndicator />
      {mounted ? (
        <div style={{ position: "relative", height: 132, width: 300 }}>
          <ScrubbablePlot
            ariaLabel="GPA"
            ariaValueText={(value) => `Scenario set to ${value.toFixed(2)} GPA.`}
            formatDisplay={(value) => value.toFixed(2)}
            height={132}
            lane={LANE}
            onScenarioChange={vi.fn()}
            savedValue={3.5}
            value={3.5}
            window={WINDOW}
          />
        </div>
      ) : null}
    </>,
  );
}

describe("ScrubbablePlot aria-busy machinery", () => {
  test("aria-busy is false at rest and true only once a drag begins", () => {
    const { container } = renderWithBusyIndicator(true);
    const control = container.querySelector(
      '[data-slot="scrubbable-plot-control"]',
    )!;
    mockControlGeometry(control);

    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "false");

    fireEvent.pointerDown(control, { button: 0, clientX: 210, pointerId: 1 });
    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "true");

    fireEvent.pointerUp(control, { clientX: 210, pointerId: 1 });
    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "false");
  });

  test("aria-busy clears after pointercancel, the same as a normal release", () => {
    const { container } = renderWithBusyIndicator(true);
    const control = container.querySelector(
      '[data-slot="scrubbable-plot-control"]',
    )!;
    mockControlGeometry(control);

    fireEvent.pointerDown(control, { button: 0, clientX: 210, pointerId: 1 });
    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "true");

    fireEvent.pointerCancel(control, { pointerId: 1 });
    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "false");
  });

  test("CRITICAL: unmounting mid-drag still clears aria-busy — the defect that shipped stuck", () => {
    function Wrapper({ mounted }: { mounted: boolean }): React.ReactElement {
      return (
        <>
          <BusyIndicator />
          {mounted ? (
            <div style={{ position: "relative", height: 132, width: 300 }}>
              <ScrubbablePlot
                ariaLabel="GPA"
                ariaValueText={(value) => `Scenario set to ${value.toFixed(2)} GPA.`}
                formatDisplay={(value) => value.toFixed(2)}
                height={132}
                lane={LANE}
                onScenarioChange={vi.fn()}
                savedValue={3.5}
                value={3.5}
                window={WINDOW}
              />
            </div>
          ) : null}
        </>
      );
    }

    const { container, rerender } = render(<Wrapper mounted />);
    const control = container.querySelector(
      '[data-slot="scrubbable-plot-control"]',
    )!;
    mockControlGeometry(control);

    fireEvent.pointerDown(control, { button: 0, clientX: 210, pointerId: 1 });
    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "true");

    // The repro from the fix brief: the plot unmounts mid-drag (the student
    // clicks a different metric tab) with neither `onPointerUp` nor
    // `onPointerCancel` ever firing on this element.
    rerender(<Wrapper mounted={false} />);

    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "false");
  });

  test("keyboard value changes never set aria-busy — only a live pointer drag does", () => {
    const { container } = renderWithBusyIndicator(true);
    const control = container.querySelector(
      '[data-slot="scrubbable-plot-control"]',
    )!;
    mockControlGeometry(control);

    fireEvent.keyDown(control, { key: "ArrowRight" });
    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "false");
    fireEvent.keyDown(control, { key: "PageUp" });
    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "false");
    fireEvent.keyDown(control, { key: "Home" });
    expect(screen.getByTestId("busy")).toHaveAttribute("aria-busy", "false");
  });
});
