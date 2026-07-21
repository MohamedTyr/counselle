import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { StepData } from "@/api/chat/types";

import { ToolStepBeat } from "../ToolWidgets";

const OMISSIONS = { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 };

function step(overrides: Partial<StepData> = {}): StepData {
  return {
    step_id: "s1",
    status: "end",
    kind: "workspace",
    label: "Updating your profile",
    tier: null,
    tool: "update_profile",
    detail: null,
    ...overrides,
  };
}

describe("ProfileMutationBody", () => {
  test("groups changes under section labels, not a flat field list", () => {
    render(
      <ToolStepBeat
        step={step({
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "profile",
              action: "update",
              outcome: "success",
              body: {
                kind: "profile",
                sections: [
                  {
                    section_key: "testing",
                    section_label: "Testing",
                    changes: [
                      {
                        field_key: "testing.planned_tests[].test",
                        operation: "set",
                        after: { kind: "enum", enum: "SAT" },
                      },
                    ],
                  },
                  {
                    section_key: "circumstances",
                    section_label: "Personal context",
                    changes: [
                      { field_key: "circumstances.notes", operation: "state_only" },
                    ],
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

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByText("Testing")).toBeInTheDocument();
    expect(screen.getByText("Personal context")).toBeInTheDocument();
    expect(screen.getByText("SAT")).toBeInTheDocument();
  });
});
