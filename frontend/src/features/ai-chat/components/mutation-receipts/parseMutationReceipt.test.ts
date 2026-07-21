import { describe, expect, test } from "vitest";

import type { WorkspaceMutationReceipt } from "@/api/chat/types";

import { parseMutationReceipt } from "./parseMutationReceipt";

function subjectJson(title: string) {
  return { title: { text: title, truncated: false, original_graphemes: null } };
}

const VALID_BATCH_RECEIPT = {
  v: 1,
  family: "task",
  action: "create",
  outcome: "success",
  body: {
    kind: "batch",
    items: [
      { input_index: 0, disposition: "changed", subject: subjectJson("Submit FAFSA") },
    ],
  },
  notices: [],
  omissions: { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 },
};

describe("parseMutationReceipt", () => {
  test("returns null for non-object input", () => {
    expect(parseMutationReceipt(undefined)).toBeNull();
    expect(parseMutationReceipt(null)).toBeNull();
    expect(parseMutationReceipt("not an object")).toBeNull();
  });

  test("returns null for an unknown version", () => {
    expect(parseMutationReceipt({ ...VALID_BATCH_RECEIPT, v: 2 })).toBeNull();
  });

  test("returns null for a missing body", () => {
    const withoutBody: Record<string, unknown> = { ...VALID_BATCH_RECEIPT };
    delete withoutBody.body;
    expect(parseMutationReceipt(withoutBody)).toBeNull();
  });

  test("returns null for an unknown body kind", () => {
    expect(
      parseMutationReceipt({ ...VALID_BATCH_RECEIPT, body: { kind: "made_up" } }),
    ).toBeNull();
  });

  test("parses a valid batch receipt", () => {
    const parsed = parseMutationReceipt(VALID_BATCH_RECEIPT);
    expect(parsed).not.toBeNull();
    expect(parsed?.family).toBe("task");
    expect(parsed?.body.kind).toBe("batch");
  });

  test("parses a valid update receipt with typed changes", () => {
    const receipt = {
      v: 1,
      family: "task",
      action: "update",
      outcome: "success",
      body: {
        kind: "update",
        subject: subjectJson("Submit FAFSA"),
        changes: [
          {
            field_key: "status",
            operation: "replace",
            before: { kind: "enum", enum: "todo" },
            after: { kind: "enum", enum: "doing" },
          },
        ],
      },
      notices: [],
      omissions: { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 },
    };
    const parsed = parseMutationReceipt(receipt);
    expect(parsed).not.toBeNull();
    if (parsed?.body.kind === "update") {
      expect(parsed.body.changes[0]?.after?.enum).toBe("doing");
    } else {
      throw new Error("expected update body");
    }
  });

  test("rejects a malformed item missing disposition", () => {
    const malformed = {
      ...VALID_BATCH_RECEIPT,
      body: { kind: "batch", items: [{ input_index: 0 }] },
    };
    expect(parseMutationReceipt(malformed)).toBeNull();
  });

  test("round-trips duplicate body's copy field", () => {
    const receipt = {
      v: 1,
      family: "essay",
      action: "duplicate",
      outcome: "success",
      body: {
        kind: "duplicate",
        source: subjectJson("Original"),
        copy: subjectJson("Copy"),
      },
      notices: [],
      omissions: { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 },
    };
    const parsed = parseMutationReceipt(receipt);
    expect(parsed).not.toBeNull();
    if (parsed?.body.kind === "duplicate") {
      expect(parsed.body.copy.title.text).toBe("Copy");
    } else {
      throw new Error("expected duplicate body");
    }
  });

  test("parses an unresolved body", () => {
    const receipt: WorkspaceMutationReceipt = {
      v: 1,
      family: "task",
      action: "update",
      outcome: "unknown",
      body: { kind: "unresolved", family: "task", verification: "task_list" },
      notices: [],
      omissions: { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 },
    };
    expect(parseMutationReceipt(receipt)).toEqual({
      ...receipt,
      body: { ...receipt.body, attempted_count: null },
    });
  });
});
