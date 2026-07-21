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
    label: "Editing an essay",
    tier: null,
    tool: "edit_essay",
    detail: null,
    ...overrides,
  };
}

describe("EssayContentMutationBody", () => {
  test("renders a numbered edit-operation timeline with structural locations only", () => {
    render(
      <ToolStepBeat
        step={step({
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "essay_content",
              action: "edit",
              outcome: "success",
              body: {
                kind: "essay_edit",
                subject: subject("Common App personal statement"),
                operations: [
                  {
                    location: { kind: "paragraph_range", start: 1, end: 1 },
                    operation: "replace",
                    before_words: 14,
                    after_words: 18,
                  },
                  {
                    location: { kind: "unavailable" },
                    operation: "delete",
                    before_words: 9,
                    after_words: 0,
                  },
                ],
                final_word_count: 612,
                word_limit: 650,
              },
              notices: [],
              omissions: OMISSIONS,
            },
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /edits/i }));

    expect(screen.getByText(/Paragraph 2/)).toBeInTheDocument();
    expect(screen.getByText(/Location unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/612 \/ 650 words — 38 remaining/)).toBeInTheDocument();
  });

  test("shows drafted/replaced state and word metrics for a full write, never an excerpt", () => {
    render(
      <ToolStepBeat
        step={step({
          tool: "write_essay",
          label: "Drafting an essay",
          detail: {
            mutation_contract: 1,
            mutation: {
              v: 1,
              family: "essay_content",
              action: "write",
              outcome: "success",
              body: {
                kind: "essay_write",
                subject: subject("Why Stanford?"),
                mode: "drafted",
                previous_word_count: null,
                final_word_count: 287,
                word_limit: 250,
              },
              notices: [],
              omissions: OMISSIONS,
            },
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /details/i }));

    expect(screen.getByText("Drafted")).toBeInTheDocument();
    expect(screen.getByText(/287 \/ 250 words — 37 over/)).toBeInTheDocument();
  });
});
