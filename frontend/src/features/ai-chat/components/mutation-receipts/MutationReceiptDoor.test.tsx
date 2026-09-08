import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type {
  MutationBody,
  MutationSubject,
  StepData,
  WorkspaceMutationReceipt,
} from "@/api/chat/types";

import { ToolStepBeat } from "../ToolWidgets";
import { essayResourceRefOf } from "./essay-door";

const OMISSIONS = {
  subjects: 0,
  changes: 0,
  item_details: 0,
  notices: 0,
  edit_operations: 0,
};

function subject(title: string, resourceRef: string | null): MutationSubject {
  return {
    title: { text: title, truncated: false, original_graphemes: null },
    resource_ref: resourceRef,
  };
}

const essayEditBody: MutationBody = {
  kind: "essay_edit",
  subject: subject("Why Stanford?", "essay-1"),
  operations: [],
  final_word_count: 240,
};

function receipt(
  overrides: Partial<WorkspaceMutationReceipt> = {},
): WorkspaceMutationReceipt {
  return {
    v: 1,
    family: "essay_content",
    action: "edit",
    outcome: "success",
    body: essayEditBody,
    notices: [],
    omissions: OMISSIONS,
    ...overrides,
  };
}

function stepFor(
  value: WorkspaceMutationReceipt,
  overrides: Partial<StepData> = {},
): StepData {
  return {
    step_id: "s1",
    status: "end",
    kind: "workspace",
    label: "Editing an essay",
    tier: null,
    tool: "edit_essay",
    detail: { mutation_contract: 1, mutation: value },
    ...overrides,
  };
}

describe("essayResourceRefOf", () => {
  test("a duplicate names the copy, never the essay it was copied from", () => {
    expect(
      essayResourceRefOf(
        receipt({
          family: "essay",
          action: "duplicate",
          body: {
            kind: "duplicate",
            source: subject("Personal statement", "essay-source"),
            copy: subject("Personal statement — v2", "essay-copy"),
          },
        }),
      ),
    ).toBe("essay-copy");
  });

  test("a batch names several essays, so it names none to open", () => {
    expect(
      essayResourceRefOf(
        receipt({
          family: "essay",
          action: "archive",
          body: { kind: "batch", items: [] },
        }),
      ),
    ).toBeNull();
  });

  test("a reorder names no single document either", () => {
    expect(
      essayResourceRefOf(
        receipt({
          family: "essay",
          action: "reorder",
          body: { kind: "reorder", new_order: [] },
        }),
      ),
    ).toBeNull();
  });

  test("a non-essay family is never a door", () => {
    expect(
      essayResourceRefOf(
        receipt({
          family: "school",
          action: "update",
          body: {
            kind: "update",
            subject: subject("Stanford", "school-1"),
            changes: [],
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("the receipt as a door", () => {
  test("a settled essay edit opens the essay it names", async () => {
    const onOpenEssay = vi.fn();
    render(<ToolStepBeat onOpenEssay={onOpenEssay} step={stepFor(receipt())} />);

    await userEvent.click(
      screen.getByRole("button", { name: /^Open Why Stanford\?/ }),
    );

    expect(onOpenEssay).toHaveBeenCalledWith("essay-1");
  });

  test("a running edit is not a door — the essay is mid-write", () => {
    render(
      <ToolStepBeat
        isLiveSegment
        onOpenEssay={vi.fn()}
        step={stepFor(receipt(), { status: "start" })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^Open Why Stanford\?/ }),
    ).not.toBeInTheDocument();
  });

  test("a failed edit is not a door — there is no edit to look at", () => {
    render(
      <ToolStepBeat
        onOpenEssay={vi.fn()}
        step={stepFor(receipt({ outcome: "failed" }))}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^Open Why Stanford\?/ }),
    ).not.toBeInTheDocument();
  });
});
