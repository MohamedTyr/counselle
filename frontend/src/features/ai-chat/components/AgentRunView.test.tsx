import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { StepData } from "@/api/chat/types";

import { NarrationBeat, PlanChecklist, ThinkingBeat, ToolStepBeat } from "./AgentRunView";

function step(overrides: Partial<StepData> = {}): StepData {
  return {
    step_id: "s1",
    status: "end",
    kind: "web_search",
    label: "Searching the web",
    tier: null,
    detail: null,
    ...overrides,
  };
}

describe("ToolStepBeat", () => {
  test("renders the step label inline, with no drawer to expand", () => {
    render(<ToolStepBeat step={step()} />);
    expect(screen.getByText("Searching the web")).toBeInTheDocument();
  });

  test("falls back to the default widget for unknown ui widget keys", () => {
    render(
      <ToolStepBeat
        step={step({
          ui: { widget: "future_widget", data: { title: "Should not matter" } },
        })}
      />,
    );

    expect(screen.getByText("Searching the web")).toBeInTheDocument();
    expect(screen.queryByText("Should not matter")).not.toBeInTheDocument();
  });

  test("default start rows use the legacy hollow dot instead of a spinner", () => {
    const { container } = render(<ToolStepBeat step={step({ status: "start" })} />);

    expect(screen.getByText("Searching the web")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument();
    const dot = container.querySelector(".size-2\\.5");
    expect(dot).toHaveClass("border-foreground");
    expect(dot).not.toHaveClass("bg-muted-foreground");
  });

  test("renders the task_added widget from the ui payload", () => {
    render(
      <ToolStepBeat
        step={step({
          kind: "skill",
          label: "Adding a task",
          ui: {
            widget: "task_added",
            data: {
              title: "Submit Duke financial aid forms",
              school: "Duke University",
              due_date: "2026-11-15",
              status: "todo",
            },
          },
        })}
      />,
    );

    expect(screen.getByText("Task added")).toBeInTheDocument();
    expect(screen.getByText("Submit Duke financial aid forms")).toBeInTheDocument();
    expect(screen.getByText("Duke University")).toBeInTheDocument();
    expect(screen.getByText("2026-11-15")).toBeInTheDocument();
    expect(screen.getByText("todo")).toBeInTheDocument();
  });

  test("task_added start rows may still render the richer spinner", () => {
    render(
      <ToolStepBeat
        step={step({
          status: "start",
          kind: "skill",
          label: "Adding a task",
          ui: {
            widget: "task_added",
            data: { title: "Submit Duke financial aid forms" },
          },
        })}
      />,
    );

    expect(screen.getByText("Task added")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  test("a search step reveals its query/result-count receipt", () => {
    render(
      <ToolStepBeat
        step={step({ detail: { query: "NYU acceptance rate", result_count: 3 } })}
      />,
    );
    expect(screen.getByText('"NYU acceptance rate" · 3 results')).toBeInTheDocument();
  });

  test("db/sql steps render safe receipts without leaking hidden internals", () => {
    render(
      <ToolStepBeat
        step={step({
          step_id: "db1",
          kind: "sql",
          label: "Reading the Common Data Set",
          detail: {
            field_keys: ["admissions.acceptance_rate"],
            query: "SELECT admission_rate FROM schools",
            row_count: 1,
            value_count: 1,
          },
        })}
      />,
    );

    expect(screen.getByText("Reading the Common Data Set")).toBeInTheDocument();
    expect(screen.getByText("1 value")).toBeInTheDocument();
    expect(screen.queryByText(/SELECT admission_rate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/admissions\.acceptance_rate/)).not.toBeInTheDocument();
  });

  test("source chips are deduped and capped, with a +N more expander", () => {
    render(
      <ToolStepBeat
        step={step({
          sources: [
            { label: "US News", url: "https://usnews.com/a" },
            { label: "US News dup", url: "https://usnews.com/a" },
            { label: "Forbes", url: "https://forbes.com/b" },
            { label: "NYTimes", url: "https://nytimes.com/c" },
            { label: "WSJ", url: "https://wsj.com/d" },
            { label: "Bloomberg", url: "https://bloomberg.com/e" },
          ],
        })}
      />,
    );

    expect(screen.getByText("US News")).toBeInTheDocument();
    expect(screen.queryByText("US News dup")).not.toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();

    fireEvent.click(screen.getByText("+1 more"));
    expect(screen.getByText("Bloomberg")).toBeInTheDocument();
  });

  test("unsafe step source urls render as inert chips", () => {
    render(
      <ToolStepBeat step={step({ sources: [{ label: "Unsafe", url: "javascript:alert(1)" }] })} />,
    );
    expect(screen.getByText("Unsafe")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Unsafe" })).not.toBeInTheDocument();
  });
});

describe("PlanChecklist", () => {
  test("renders completed/total and every item", () => {
    render(
      <PlanChecklist
        step={step({
          kind: "write_plan",
          label: "Updated the plan",
          detail: {
            completed: 1,
            total: 2,
            items: [
              { content: "Resolve schools", status: "completed" },
              { content: "Compare costs", status: "in_progress" },
            ],
          },
        })}
      />,
    );

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("Resolve schools")).toBeInTheDocument();
    expect(screen.getByText("Compare costs")).toBeInTheDocument();
  });

  test("renders nothing when the plan has no items", () => {
    const { container } = render(
      <PlanChecklist step={step({ kind: "write_plan", detail: {} })} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("NarrationBeat", () => {
  test("renders visible prose, not italic/muted styling", () => {
    render(<NarrationBeat text="Let me check Harvard's aid page." />);
    const node = screen.getByText("Let me check Harvard's aid page.");
    expect(node).toBeInTheDocument();
    expect(node.className).not.toContain("italic");
  });
});

describe("ThinkingBeat", () => {
  test("collapsed by default; expands to reveal the raw text", () => {
    render(<ThinkingBeat id="t1" text="Weighing which source to check first." />);

    expect(
      screen.queryByText("Weighing which source to check first."),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Weighing which source to check first.")).toBeInTheDocument();
  });
});
