import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, test, vi } from "vitest";

import { Slider } from "./slider";

expect.extend(toHaveNoViolations);

describe("Slider", () => {
  test("keeps native keyboard and form semantics while exposing an accessible value", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { container } = render(
      <form>
        <Slider
          aria-label="Scenario GPA"
          aria-valuetext="3.50 GPA"
          max={4}
          min={0}
          name="scenario_gpa"
          onValueChange={onValueChange}
          step={0.01}
          value={3.5}
        />
      </form>,
    );

    const slider = screen.getByLabelText("Scenario GPA");
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "4");
    expect(slider).toHaveAttribute("aria-valuenow", "3.5");
    expect(slider).toHaveAttribute("aria-valuetext", "3.50 GPA");

    slider.focus();
    await user.keyboard("{ArrowRight}");
    expect(onValueChange).toHaveBeenLastCalledWith(
      3.51,
      expect.objectContaining({ reason: "keyboard" }),
    );
    expect(
      new FormData(container.querySelector("form")!).get("scenario_gpa"),
    ).toBe("3.5");
    expect(await axe(container)).toHaveNoViolations();
  });

  test("preserves disabled semantics and the visible focus-capable thumb contract", () => {
    render(
      <Slider
        aria-label="Disabled scenario GPA"
        disabled
        max={4}
        min={0}
        value={3.5}
      />,
    );

    expect(screen.getByLabelText("Disabled scenario GPA")).toBeDisabled();
    expect(screen.getByTestId("slider-thumb")).toHaveAttribute(
      "data-slot",
      "slider-thumb",
    );
  });

  test("commits pointer and touch changes and serializes the committed value", () => {
    const onValueCommitted = vi.fn();
    const { container } = render(
      <form>
        <Slider
          aria-label="Scenario ACT"
          defaultValue={18}
          max={36}
          min={1}
          name="scenario_act"
          onValueCommitted={onValueCommitted}
          step={1}
        />
      </form>,
    );
    const control = container.querySelector("[data-slot=slider-control]")!;
    Object.defineProperties(control, {
      hasPointerCapture: { value: vi.fn(() => false) },
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
    });
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue({
      bottom: 44,
      height: 44,
      left: 0,
      right: 350,
      toJSON: () => ({}),
      top: 0,
      width: 350,
      x: 0,
      y: 0,
    });

    act(() => {
      fireEvent.pointerDown(control, { button: 0, clientX: 350, pointerId: 1 });
      fireEvent.pointerUp(document, { clientX: 350, pointerId: 1 });
    });

    expect(onValueCommitted).toHaveBeenLastCalledWith(
      36,
      expect.objectContaining({ reason: "track-press" }),
    );
    expect(
      new FormData(container.querySelector("form")!).get("scenario_act"),
    ).toBe("36");

    act(() => {
      fireEvent.pointerDown(control, {
        button: 0,
        clientX: 175,
        pointerId: 2,
        pointerType: "touch",
      });
      fireEvent.pointerUp(document, {
        clientX: 175,
        pointerId: 2,
        pointerType: "touch",
      });
    });
    expect(onValueCommitted).toHaveBeenLastCalledWith(
      19,
      expect.objectContaining({ reason: "track-press" }),
    );
  });
});
