import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { ClarifySpec } from "@/api/chat/types";

import { ClarifyWidget } from "./ClarifyWidget";

function spec(overrides: Partial<ClarifySpec> = {}): ClarifySpec {
  return {
    v: 1,
    question: "Which programs?",
    header: "Narrow it down",
    multi_select: false,
    options: [
      { label: "Computer Science", hint: "CS" },
      { label: "Biology", hint: "Bio" },
    ],
    ...overrides,
  };
}

describe("ClarifyWidget — live interaction", () => {
  test("single-select: tapping an option submits immediately", () => {
    const onAnswer = vi.fn();
    render(<ClarifyWidget answer={null} frozen={false} onAnswer={onAnswer} spec={spec()} />);

    fireEvent.click(screen.getByText("Biology"));

    expect(onAnswer).toHaveBeenCalledWith("Biology");
  });

  test("multi-select: chips toggle, then Send joins selected labels", () => {
    const onAnswer = vi.fn();
    render(
      <ClarifyWidget
        answer={null}
        frozen={false}
        onAnswer={onAnswer}
        spec={spec({ multi_select: true })}
      />,
    );

    fireEvent.click(screen.getByText("Computer Science"));
    fireEvent.click(screen.getByText("Biology"));
    // Send is disabled until something is selected.
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    expect(onAnswer).toHaveBeenCalledWith("Computer Science, Biology");
  });

  test('"Other" opens free text; Enter submits it', () => {
    const onAnswer = vi.fn();
    render(<ClarifyWidget answer={null} frozen={false} onAnswer={onAnswer} spec={spec()} />);

    fireEvent.click(screen.getByText("Other"));
    const input = screen.getByLabelText("Your answer");
    fireEvent.change(input, { target: { value: "Astrophysics" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAnswer).toHaveBeenCalledWith("Astrophysics");
  });

  test('"Other" free text also submits via the Send button', () => {
    const onAnswer = vi.fn();
    render(<ClarifyWidget answer={null} frozen={false} onAnswer={onAnswer} spec={spec()} />);

    fireEvent.click(screen.getByText("Other"));
    const input = screen.getByLabelText("Your answer");
    fireEvent.change(input, { target: { value: "Astrophysics" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Send" })[0]);

    expect(onAnswer).toHaveBeenCalledWith("Astrophysics");
  });
});

describe("ClarifyWidget — frozen (persisted) rendering", () => {
  test("single-select: the chosen option chip is pressed and inert", () => {
    const onAnswer = vi.fn();
    render(<ClarifyWidget answer="Biology" frozen onAnswer={onAnswer} spec={spec()} />);

    expect(screen.getByText("Biology").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Computer Science").closest("button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByText("Biology"));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  test("multi-select: every chosen option chip is pressed", () => {
    render(
      <ClarifyWidget
        answer="Computer Science, Biology"
        frozen
        onAnswer={vi.fn()}
        spec={spec({ multi_select: true })}
      />,
    );

    expect(screen.getByText("Computer Science").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Biology").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a free-text answer with no matching option renders as the Other response", () => {
    render(<ClarifyWidget answer="Astrophysics" frozen onAnswer={vi.fn()} spec={spec()} />);

    expect(screen.getByText("Astrophysics")).toBeInTheDocument();
  });

  test("answer=null (unanswered, parked-frozen) seeds nothing selected", () => {
    render(<ClarifyWidget answer={null} frozen onAnswer={vi.fn()} spec={spec()} />);

    expect(screen.getByText("Biology").closest("button")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
