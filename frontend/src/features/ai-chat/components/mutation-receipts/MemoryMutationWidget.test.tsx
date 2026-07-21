import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { StepData } from "@/api/chat/types";

import { ToolStepBeat } from "../ToolWidgets";

const OMISSIONS = { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 };

function step(overrides: Partial<StepData> = {}): StepData {
  return {
    step_id: "s1",
    status: "end",
    kind: "memory",
    label: "Remembering a preference",
    tier: null,
    tool: "remember",
    detail: null,
    ...overrides,
  };
}

describe("MemoryMutationBody", () => {
  test("shows active note content only after expansion", () => {
    render(
      <ToolStepBeat
        step={step({
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "memory",
              action: "remember",
              outcome: "success",
              body: {
                kind: "memory",
                operation: "remember",
                note_count: 1,
                active_notes: [
                  {
                    text: "Prefers urban campuses near public transit.",
                    truncated: false,
                    original_graphemes: null,
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

    expect(
      screen.queryByText("Prefers urban campuses near public transit."),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(
      screen.getByText("Prefers urban campuses near public transit."),
    ).toBeInTheDocument();
  });

  test("forget never repeats forgotten content, only fixed reassurance copy", () => {
    render(
      <ToolStepBeat
        step={step({
          tool: "forget",
          label: "Forgetting a memory",
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "memory",
              action: "forget",
              outcome: "success",
              body: {
                kind: "memory",
                operation: "forget",
                note_count: 1,
                active_notes: [],
              },
              notices: [],
              omissions: OMISSIONS,
            },
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(
      screen.getByText("You can ask Counselle to remember this information again."),
    ).toBeInTheDocument();
  });
});
