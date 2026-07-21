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
    label: "Updating an essay",
    tier: null,
    tool: "update_essay",
    detail: null,
    ...overrides,
  };
}

describe("EssayMutationBody", () => {
  test("shows a document heading above the typed field changes", () => {
    render(
      <ToolStepBeat
        step={step({
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "essay",
              action: "update",
              outcome: "success",
              body: {
                kind: "update",
                subject: subject("Why Stanford?"),
                changes: [{ field_key: "prompt", operation: "state_only" }],
              },
              notices: [],
              omissions: OMISSIONS,
            },
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /changes/i }));

    expect(screen.getByText("Why Stanford?")).toBeInTheDocument();
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.queryByText(/what is your reason/i)).not.toBeInTheDocument();
  });

  test("renders explicit source and copy roles for a duplicate, no fabricated data", () => {
    render(
      <ToolStepBeat
        step={step({
          tool: "duplicate_essay",
          label: "Copying an essay",
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "essay",
              action: "duplicate",
              outcome: "success",
              body: {
                kind: "duplicate",
                source: subject("Common App personal statement"),
                copy: subject("Common App personal statement — v2"),
              },
              notices: [],
              omissions: OMISSIONS,
            },
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(screen.getByText("Original")).toBeInTheDocument();
    expect(screen.getByText("Common App personal statement")).toBeInTheDocument();
    expect(
      screen.getByText("Common App personal statement — v2"),
    ).toBeInTheDocument();
  });
});
