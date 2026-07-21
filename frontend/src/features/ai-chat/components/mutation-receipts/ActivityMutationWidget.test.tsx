import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { StepData } from "@/api/chat/types";

import { ToolStepBeat } from "../ToolWidgets";

const OMISSIONS = { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 };

function subject(title: string) {
  return { title: { text: title, truncated: false, original_graphemes: null } };
}

function step(overrides: Partial<StepData> = {}): StepData {
  return {
    step_id: "s1",
    status: "end",
    kind: "workspace",
    label: "Updating an activity",
    tier: null,
    tool: "update_activity",
    detail: null,
    ...overrides,
  };
}

function expand() {
  fireEvent.click(screen.getByRole("button", { expanded: false }));
}

describe("ActivityMutationBody", () => {
  test("renders typed field changes for an update", () => {
    render(
      <ToolStepBeat
        step={step({
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "activity",
              action: "update",
              outcome: "success",
              body: {
                kind: "update",
                subject: subject("Debate Captain"),
                changes: [
                  {
                    field_key: "hours_per_week",
                    operation: "replace",
                    before: { kind: "integer", integer: 5 },
                    after: { kind: "integer", integer: 8 },
                  },
                  { field_key: "description", operation: "state_only" },
                ],
              },
              notices: [],
              omissions: OMISSIONS,
            },
          },
        })}
      />,
    );

    expand();

    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
  });

  test("shows a numbered order without inferring movement when ranks are unavailable", () => {
    render(
      <ToolStepBeat
        step={step({
          tool: "reorder_activities",
          label: "Reordering activities",
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "activity",
              action: "reorder",
              outcome: "success",
              body: {
                kind: "reorder",
                new_order: [subject("Research Assistant"), subject("Debate Captain")],
                old_ranks: null,
                moved_index: null,
                moved_from_rank: null,
              },
              notices: [],
              omissions: OMISSIONS,
            },
          },
        })}
      />,
    );

    expand();

    expect(screen.getByText("Research Assistant")).toBeInTheDocument();
    expect(screen.queryByText(/moved #/)).not.toBeInTheDocument();
  });
});
