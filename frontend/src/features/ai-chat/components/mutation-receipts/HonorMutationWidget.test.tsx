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
    label: "Updating an honor",
    tier: null,
    tool: "update_honor",
    detail: null,
    ...overrides,
  };
}

function expand() {
  fireEvent.click(screen.getByRole("button", { expanded: false }));
}

describe("HonorMutationBody", () => {
  test("renders the recognition-level change as a badge, not a raw field row", () => {
    render(
      <ToolStepBeat
        step={step({
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "honor",
              action: "update",
              outcome: "success",
              body: {
                kind: "update",
                subject: subject("National Physics Olympiad Finalist"),
                changes: [
                  {
                    field_key: "recognition_level",
                    operation: "replace",
                    before: { kind: "enum", enum: "State" },
                    after: { kind: "enum", enum: "National" },
                  },
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

    expect(screen.getByText("Recognition")).toBeInTheDocument();
    expect(screen.getByText("National")).toBeInTheDocument();
  });

  test("shows a numbered order for a reorder without a fabricated move claim", () => {
    render(
      <ToolStepBeat
        step={step({
          tool: "reorder_honors",
          label: "Reordering honors",
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "honor",
              action: "reorder",
              outcome: "success",
              body: {
                kind: "reorder",
                new_order: [
                  subject("National Physics Olympiad Finalist"),
                  subject("Regional Debate Champion"),
                ],
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

    expect(screen.getByText("National Physics Olympiad Finalist")).toBeInTheDocument();
    expect(screen.queryByText(/moved #/)).not.toBeInTheDocument();
  });
});
