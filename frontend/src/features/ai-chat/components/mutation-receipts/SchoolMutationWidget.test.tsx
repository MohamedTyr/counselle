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
    label: "Adding a school",
    tier: null,
    tool: "add_schools",
    detail: null,
    ...overrides,
  };
}

describe("SchoolMutationBody", () => {
  test("groups a partial batch into Added and Skipped sections", () => {
    render(
      <ToolStepBeat
        step={step({
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "school",
              action: "create",
              outcome: "partial",
              body: {
                kind: "batch",
                items: [
                  {
                    input_index: 0,
                    disposition: "changed",
                    subject: subject("Stanford University"),
                  },
                  {
                    input_index: 1,
                    disposition: "skipped",
                    subject: subject("Yale University"),
                    reason: {
                      text: "already on your list",
                      truncated: false,
                      original_graphemes: null,
                    },
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

    fireEvent.click(screen.getByRole("button", { name: /skipped/i }));

    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("Stanford University")).toBeInTheDocument();
    // The shell also surfaces the first issue outside the collapsed region
    // (plan §4.3) — the reason legitimately appears twice.
    expect(screen.getAllByText("already on your list").length).toBeGreaterThan(0);
  });

  test("shows the cascade notice on archive without implying permanent deletion", () => {
    render(
      <ToolStepBeat
        step={step({
          tool: "archive_schools",
          label: "Removing a school",
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "school",
              action: "archive",
              outcome: "success",
              body: {
                kind: "batch",
                items: [
                  {
                    input_index: 0,
                    disposition: "changed",
                    subject: subject("Brown University"),
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

    expect(screen.getByText(/Archived/)).toBeInTheDocument();
    expect(screen.queryByText(/deleted/i)).not.toBeInTheDocument();
  });
});
