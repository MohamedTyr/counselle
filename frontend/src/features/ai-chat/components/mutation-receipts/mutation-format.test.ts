import { describe, expect, test } from "vitest";

import type { WorkspaceMutationReceipt } from "@/api/chat/types";

import { mutationGlanceText } from "./mutation-format";

function subject(title: string) {
  return { title: { text: title, truncated: false, original_graphemes: null } };
}

const OMISSIONS = { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 };

describe("mutationGlanceText", () => {
  test("batch create success names the exact count", () => {
    const receipt: WorkspaceMutationReceipt = {
      v: 1,
      family: "task",
      action: "create",
      outcome: "success",
      body: {
        kind: "batch",
        items: [
          { input_index: 0, disposition: "changed", subject: subject("A") },
          { input_index: 1, disposition: "changed", subject: subject("B") },
        ],
      },
      notices: [],
      omissions: OMISSIONS,
    };
    expect(mutationGlanceText(receipt)).toBe("Added 2 tasks");
  });

  test("batch create partial names confirmed vs requested", () => {
    const receipt: WorkspaceMutationReceipt = {
      v: 1,
      family: "school",
      action: "create",
      outcome: "partial",
      body: {
        kind: "batch",
        items: [
          { input_index: 0, disposition: "changed", subject: subject("Stanford") },
          { input_index: 1, disposition: "skipped", subject: subject("Yale") },
        ],
      },
      notices: [],
      omissions: OMISSIONS,
    };
    expect(mutationGlanceText(receipt)).toBe("Added 1 of 2 schools");
  });

  test("update success names the confirmed subject", () => {
    const receipt: WorkspaceMutationReceipt = {
      v: 1,
      family: "task",
      action: "update",
      outcome: "success",
      body: {
        kind: "update",
        subject: subject("Submit FAFSA"),
        changes: [{ field_key: "status", operation: "state_only" }],
      },
      notices: [],
      omissions: OMISSIONS,
    };
    expect(mutationGlanceText(receipt)).toBe("Updated “Submit FAFSA”");
  });

  test("update failed never sounds like success", () => {
    const receipt: WorkspaceMutationReceipt = {
      v: 1,
      family: "essay",
      action: "update",
      outcome: "failed",
      body: {
        kind: "update",
        subject: subject("Why Stanford?"),
        changes: [{ field_key: "title", operation: "state_only" }],
      },
      notices: [],
      omissions: OMISSIONS,
    };
    expect(mutationGlanceText(receipt)).toBe("Couldn’t update “Why Stanford?”");
  });

  test("memory forget never repeats forgotten content", () => {
    const receipt: WorkspaceMutationReceipt = {
      v: 1,
      family: "memory",
      action: "forget",
      outcome: "success",
      body: { kind: "memory", operation: "forget", note_count: 1, active_notes: [] },
      notices: [],
      omissions: OMISSIONS,
    };
    expect(mutationGlanceText(receipt)).toBe("A note is no longer remembered");
  });

  test("unresolved unknown never claims success or failure", () => {
    const receipt: WorkspaceMutationReceipt = {
      v: 1,
      family: "task",
      action: "update",
      outcome: "unknown",
      body: { kind: "unresolved", family: "task", verification: "task_list" },
      notices: [],
      omissions: OMISSIONS,
    };
    expect(mutationGlanceText(receipt)).toBe(
      "Action interrupted — final task state is unknown",
    );
  });
});
