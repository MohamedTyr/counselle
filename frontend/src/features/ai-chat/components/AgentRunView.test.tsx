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
  test("renders a live school-data start as a compact animated row", () => {
    const { container } = render(
      <ToolStepBeat
        isLiveSegment
        step={step({
          status: "start",
          kind: "db_tool",
          tool: "resolve_school",
          label: "Finding “Yale”…",
        })}
      />,
    );
    const row = container.querySelector('[data-school-data-tool="resolve_school"]');

    expect(row).toHaveAttribute("aria-live", "polite");
    expect(row).toHaveAttribute("aria-atomic", "true");
    expect(row).toHaveClass("grid-cols-[14px_minmax(0,1fr)]");
    expect(row?.querySelector(".flex-wrap")).toBeInTheDocument();
    expect(row?.querySelector(".lucide-loader-circle")).toHaveClass(
      "absolute",
      "opacity-100",
      "duration-[175ms]",
      "motion-reduce:transition-none",
      "motion-safe:animate-spin",
    );
    expect(row?.querySelector(".lucide-check")).toHaveClass("absolute", "opacity-0");
  });

  test("does not animate a persisted school-data start row", () => {
    const { container } = render(
      <ToolStepBeat
        step={step({
          status: "start",
          kind: "db_tool",
          tool: "get_domain",
          label: "Reading Yale’s admissions data…",
        })}
      />,
    );

    expect(container.querySelector(".lucide-loader-circle")).not.toHaveClass(
      "motion-safe:animate-spin",
    );
  });

  test("renders completed school data without details, chips, or jargon", () => {
    const { container } = render(
      <ToolStepBeat
        step={step({
          kind: "db_tool",
          tool: "get_domain",
          label: "Read Yale University’s admissions data",
          detail: {
            tool: "get_domain",
            value_count: 72,
            domain_id: "admissions",
            schools: ["Yale University"],
          },
          sources: [{ label: "Yale University", url: "https://yale.edu" }],
        })}
      />,
    );

    expect(screen.getByText("72 values")).toHaveClass("tabular-nums", "basis-full");
    expect(container.querySelector(".lucide-check")).toHaveClass("opacity-100");
    expect(container.querySelector(".lucide-loader-circle")).toHaveClass("opacity-0");
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(screen.queryByText("Yale University", { selector: "a" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Domain:/)).not.toBeInTheDocument();
  });

  test.each([
    [0, ".lucide-circle-minus"],
    [1, ".lucide-check"],
  ])("renders the profile count %i state", (valueCount, iconSelector) => {
    const { container } = render(
      <ToolStepBeat
        step={step({
          kind: "db_tool",
          tool: "get_school_profile",
          label: valueCount === 0 ? "Profile data unavailable" : "Read Yale’s profile",
          detail: { tool: "get_school_profile", value_count: valueCount },
        })}
      />,
    );
    expect(container.querySelector(iconSelector)).toBeInTheDocument();
  });

  test("renders errors without raw receipt text", () => {
    const { container } = render(
      <ToolStepBeat
        step={step({
          status: "error",
          kind: "db_tool",
          tool: "get_school_profile",
          label: "Couldn’t read Yale’s profile",
          detail: { tool: "get_school_profile", error: "postgres password leaked" },
        })}
      />,
    );

    expect(container.querySelector(".lucide-circle-alert")).toBeInTheDocument();
    expect(screen.queryByText(/postgres password/)).not.toBeInTheDocument();
  });

  test("hides historical overflow plumbing", () => {
    const { container } = render(
      <ToolStepBeat
        step={step({ kind: "db_tool", detail: { tool: "read_tool_result" } })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("keeps deferred database tools on the generic renderer", () => {
    render(
      <ToolStepBeat
        step={step({
          kind: "sql",
          tool: "query_database",
          label: "Running a custom database query",
          detail: { tool: "query_database", row_count: 2 },
        })}
      />,
    );
    expect(screen.getByText("Running a custom database query")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
  });

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

  test("falls back to the default widget for unknown step kinds", () => {
    render(<ToolStepBeat step={step({ kind: "future_tool", label: "Using a future tool" })} />);

    expect(screen.getByText("Using a future tool")).toBeInTheDocument();
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

  test("db/sql steps render public details without leaking hidden internals", () => {
    render(
      <ToolStepBeat
        step={step({
          step_id: "db1",
          kind: "sql",
          label: "Reading the Common Data Set",
          detail: {
            domain_id: "admissions",
            query: "SELECT admission_rate FROM cds_library.active_cds_domain_packets",
            row_count: 1,
            value_count: 1,
          },
        })}
      />,
    );

    expect(screen.getByText("Reading the Common Data Set")).toBeInTheDocument();
    expect(screen.getByText("1 value · Domain: admissions")).toBeInTheDocument();
    expect(screen.queryByText(/SELECT admission_rate/)).not.toBeInTheDocument();
    expect(screen.queryByText("Query")).not.toBeInTheDocument();
    expect(screen.queryByText(/admissions\.acceptance_rate/)).not.toBeInTheDocument();
    expect(screen.queryByText("Row count")).not.toBeInTheDocument();
  });

  test("generic details render all approved StepDetail fields", () => {
    render(
      <ToolStepBeat
        step={step({
          detail: {
            query: "NYU scholarships",
            summary: "Found official aid pages.",
            domains: ["nyu.edu", "studentaid.gov"],
            result_count: 2,
            value_count: 3,
            duration_ms: 42,
            tool: "search_web",
            viz_type: "comparison_table",
            schools: ["NYU", "Duke"],
            items: [{ content: "Check aid deadlines", status: "completed" }],
            completed: 1,
            total: 2,
            next_actions: ["Compare net price"],
            error: "One source timed out",
          },
        })}
      />,
    );

    expect(screen.getByText("Query")).toBeInTheDocument();
    expect(screen.getByText("NYU scholarships")).toBeInTheDocument();
    expect(screen.getByText("Found official aid pages.")).toBeInTheDocument();
    expect(screen.getByText("nyu.edu, studentaid.gov")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("3", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("42", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("search_web")).toBeInTheDocument();
    expect(screen.getByText("comparison table")).toBeInTheDocument();
    expect(screen.getByText("NYU, Duke")).toBeInTheDocument();
    expect(screen.getByText("Check aid deadlines")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("Compare net price")).toBeInTheDocument();
    expect(screen.getByText("One source timed out")).toBeInTheDocument();
  });

  test("generic details ignore hidden fields and arbitrary raw data", () => {
    render(
      <ToolStepBeat
        step={step({
          detail: {
            query: "public query",
            field_keys: ["admissions.acceptance_rate"],
            row_count: 99,
            raw_payload: "must stay hidden",
          } as StepData["detail"] & { raw_payload: string },
          ui: {
            widget: "future_widget",
            data: { internalNote: "must not render" },
          },
        })}
      />,
    );

    expect(screen.getByText("public query")).toBeInTheDocument();
    expect(screen.queryByText(/admissions\.acceptance_rate/)).not.toBeInTheDocument();
    expect(screen.queryByText("99")).not.toBeInTheDocument();
    expect(screen.queryByText("must stay hidden")).not.toBeInTheDocument();
    expect(screen.queryByText("must not render")).not.toBeInTheDocument();
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

  test("spins the in-progress icon while the turn is live", () => {
    const { container } = render(
      <PlanChecklist
        isLive
        step={step({
          kind: "write_plan",
          label: "Updated the plan",
          detail: {
            completed: 0,
            total: 1,
            items: [{ content: "Compare costs", status: "in_progress" }],
          },
        })}
      />,
    );

    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  test("does not spin the in-progress icon when the turn is not live", () => {
    const { container } = render(
      <PlanChecklist
        step={step({
          kind: "write_plan",
          label: "Updated the plan",
          detail: {
            completed: 0,
            total: 1,
            items: [{ content: "Compare costs", status: "in_progress" }],
          },
        })}
      />,
    );

    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});

describe("NarrationBeat", () => {
  test("renders response text through markdown, not plain muted prose", () => {
    render(<NarrationBeat text="Let me check **Harvard**." />);

    expect(screen.getByText("Harvard")).toHaveClass("font-semibold");
    expect(screen.queryByText(/\*\*Harvard\*\*/)).not.toBeInTheDocument();
  });
});

describe("ThinkingBeat", () => {
  test("collapsed by default; expands to reveal the raw text", () => {
    render(<ThinkingBeat id="t1" text="Weighing which source to check first." />);

    expect(screen.getByRole("button", { name: "Thought" })).toBeInTheDocument();
    expect(
      screen.queryByText("Weighing which source to check first."),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button", { name: "Thought" })).toBeInTheDocument();
    expect(screen.getByText("Weighing which source to check first.")).toBeInTheDocument();
  });

  test("live state is rendered from data, not expanded state", () => {
    render(<ThinkingBeat id="t1" isLive text="Still deciding." />);

    const trigger = screen.getByRole("button", { name: "Thinking" });
    expect(trigger).toBeInTheDocument();
    expect(screen.getByText("Thinking")).toHaveClass("animate-pulse");

    fireEvent.click(trigger);

    expect(screen.getByRole("button", { name: "Thinking" })).toBeInTheDocument();
    expect(screen.getByText("Still deciding.")).toBeInTheDocument();
  });
});
