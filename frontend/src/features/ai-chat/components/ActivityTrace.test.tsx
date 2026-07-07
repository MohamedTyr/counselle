import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { StepData } from "@/api/chat/types";

import type { TimelineEntry } from "../turn-reducer";
import { ActivityTrace } from "./ActivityTrace";

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

describe("ActivityTrace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders nothing for a settled turn with an empty timeline", () => {
    const { container } = render(<ActivityTrace status="complete" timeline={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test("a live turn with no steps yet shows a real starting state and a timer", () => {
    render(<ActivityTrace status="streaming" timeline={[]} />);

    expect(screen.getAllByText("Starting agent run")).toHaveLength(2);
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
  });

  test("is collapsed by default even with a populated timeline", () => {
    const timeline: TimelineEntry[] = [{ type: "step", step: step() }];
    render(<ActivityTrace durationMs={1200} status="complete" timeline={timeline} />);

    expect(screen.queryByText("Searching the web")).not.toBeInTheDocument();
    expect(screen.getByText(/Thought for/)).toBeInTheDocument();
  });

  test("expanding reveals step and thinking rows in stream order", () => {
    const timeline: TimelineEntry[] = [
      { type: "thinking", id: "t1", text: "Considering the applicant's profile" },
      { type: "step", step: step() },
    ];
    render(<ActivityTrace durationMs={500} status="complete" timeline={timeline} />);

    fireEvent.click(screen.getByRole("button"));

    const rows = screen.getAllByText(
      /Considering the applicant's profile|Searching the web/,
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      "Considering the applicant's profile",
      "Searching the web",
    ]);
  });

  test("a search step reveals its query/result-count receipt", () => {
    const timeline: TimelineEntry[] = [
      {
        type: "step",
        step: step({
          detail: { query: "NYU acceptance rate", result_count: 3 },
        }),
      },
    ];
    render(<ActivityTrace durationMs={500} status="complete" timeline={timeline} />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText('"NYU acceptance rate" · 3 results')).toBeInTheDocument();
  });

  test("db/sql/viz steps render safe receipts without leaking hidden internals", () => {
    const timeline: TimelineEntry[] = [
      {
        type: "step",
        step: step({
          step_id: "db1",
          kind: "sql",
          label: "Reading the Common Data Set",
          detail: {
            field_keys: ["admissions.acceptance_rate"],
            query: "SELECT admission_rate FROM schools",
            row_count: 1,
            value_count: 1,
          },
        }),
      },
    ];
    render(<ActivityTrace durationMs={500} status="complete" timeline={timeline} />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Reading the Common Data Set")).toBeInTheDocument();
    expect(screen.getByText("1 value")).toBeInTheDocument();
    expect(screen.queryByText(/SELECT admission_rate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/admissions\.acceptance_rate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/row_count/)).not.toBeInTheDocument();
  });

  test("write_plan updates render one pinned checklist instead of tool rows", () => {
    const timeline: TimelineEntry[] = [
      {
        type: "step",
        step: step({
          step_id: "plan1",
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
        }),
      },
      {
        type: "step",
        step: step({
          step_id: "plan2",
          kind: "write_plan",
          label: "Updated the plan again",
          detail: {
            completed: 2,
            total: 2,
            items: [
              { content: "Resolve schools", status: "completed" },
              { content: "Compare costs", status: "completed" },
            ],
          },
        }),
      },
    ];
    render(<ActivityTrace durationMs={500} status="complete" timeline={timeline} />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("Resolve schools")).toBeInTheDocument();
    expect(screen.getByText("Compare costs")).toBeInTheDocument();
    expect(screen.queryByText("Starting agent run")).not.toBeInTheDocument();
    expect(screen.queryByText("Updated the plan")).not.toBeInTheDocument();
  });

  test("unknown step kinds still render allowlisted safe receipt fields only", () => {
    const timeline: TimelineEntry[] = [
      {
        type: "step",
        step: step({
          step_id: "future1",
          kind: "future_tool",
          label: "Using a future tool",
          detail: {
            summary: "Finished safely",
            next_actions: ["Review output"],
            tool_name: "internal_tool",
          } as StepData["detail"],
        }),
      },
    ];
    render(<ActivityTrace durationMs={500} status="complete" timeline={timeline} />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Using a future tool")).toBeInTheDocument();
    expect(
      screen.getByText("Finished safely · Next: Review output"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/internal_tool/)).not.toBeInTheDocument();
  });

  test("step source chips are deduped and capped, with a +N more expander", () => {
    const timeline: TimelineEntry[] = [
      {
        type: "step",
        step: step({
          sources: [
            { label: "US News", url: "https://usnews.com/a" },
            { label: "US News dup", url: "https://usnews.com/a" },
            { label: "Forbes", url: "https://forbes.com/b" },
            { label: "NYTimes", url: "https://nytimes.com/c" },
            { label: "WSJ", url: "https://wsj.com/d" },
            { label: "Bloomberg", url: "https://bloomberg.com/e" },
          ],
        }),
      },
    ];
    render(<ActivityTrace durationMs={500} status="complete" timeline={timeline} />);
    fireEvent.click(screen.getByRole("button"));

    // 6 raw entries, 1 duplicate by url -> 5 unique, capped to 4 visible + "+1 more".
    expect(screen.getByText("US News")).toBeInTheDocument();
    expect(screen.queryByText("US News dup")).not.toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();

    fireEvent.click(screen.getByText("+1 more"));
    expect(screen.getByText("Bloomberg")).toBeInTheDocument();
  });

  test("unsafe step source urls render as inert chips", () => {
    const timeline: TimelineEntry[] = [
      {
        type: "step",
        step: step({
          sources: [{ label: "Unsafe", url: "javascript:alert(1)" }],
        }),
      },
    ];
    render(<ActivityTrace durationMs={500} status="complete" timeline={timeline} />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Unsafe")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Unsafe" })).not.toBeInTheDocument();
  });

  test("a settled turn stops the live timer and shows a static duration", () => {
    render(<ActivityTrace durationMs={4200} status="cancelled" timeline={[{ type: "step", step: step() }]} />);

    expect(screen.getByText("Thought for 4.2s")).toBeInTheDocument();
  });

  test("live to settled keeps the visible trace open", () => {
    const timeline: TimelineEntry[] = [{ type: "step", step: step() }];
    const { rerender } = render(<ActivityTrace status="streaming" timeline={timeline} />);

    expect(screen.getAllByText("Searching the web").length).toBeGreaterThanOrEqual(2);

    rerender(<ActivityTrace durationMs={1200} status="complete" timeline={timeline} />);

    expect(screen.getAllByText("Searching the web").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Thought for 1.2s")).toBeInTheDocument();
  });

  test("settled to live reattach reopens the trace", async () => {
    const timeline: TimelineEntry[] = [{ type: "step", step: step() }];
    const { rerender } = render(
      <ActivityTrace durationMs={1200} status="complete" timeline={timeline} />,
    );

    expect(screen.queryByText("Searching the web")).not.toBeInTheDocument();

    rerender(<ActivityTrace status="streaming" timeline={timeline} />);
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getAllByText("Searching the web").length).toBeGreaterThanOrEqual(2);
  });
});
