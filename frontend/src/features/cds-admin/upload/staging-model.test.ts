import type { UploadRow } from "@/api/cds-admin/types";
import {
  buildReadinessSentence,
  needsInputReason,
  partitionFiles,
  readyToProcessCount,
  reconcileWithServer,
  rejectedFilesMessage,
  stagingChipStatus,
  stagingEntryFromServerRow,
  stagingReason,
  type StagingEntry,
} from "@/features/cds-admin/upload/staging-model";

function makeRow(overrides: Partial<UploadRow> = {}): UploadRow {
  return {
    academic_year: 2025,
    batch_id: "batch-1",
    committed_document_id: null,
    committed_extraction_id: null,
    created_at: "2026-08-01T00:00:00Z",
    detection: {
      candidates: [],
      confident: true,
      duplicate_of: null,
      error: null,
      name: "Harvard University",
      year: 2025,
    },
    error_message: null,
    filename: "harvard_2024-2025.pdf",
    id: "row-1",
    page_count: 38,
    school_id: 1,
    school_name: "Harvard University",
    sha256: "abc",
    size_bytes: 4_404_020,
    status: "matched",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<StagingEntry> = {}): StagingEntry {
  return {
    clientId: "client-1",
    file: new File([], "harvard_2024-2025.pdf", { type: "application/pdf" }),
    phase: "resolved",
    requestError: null,
    row: makeRow(),
    ...overrides,
  };
}

describe("partitionFiles", () => {
  it("accepts PDFs under the size cap", () => {
    const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
    const { accepted, rejected } = partitionFiles([pdf]);
    expect(accepted).toEqual([pdf]);
    expect(rejected).toEqual([]);
  });

  it("rejects non-PDFs and oversized files", () => {
    const notPdf = new File(["x"], "a.png", { type: "image/png" });
    const tooBig = new File([new Uint8Array(51 * 1024 * 1024)], "big.pdf", {
      type: "application/pdf",
    });
    const { accepted, rejected } = partitionFiles([notPdf, tooBig]);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([notPdf, tooBig]);
  });

  it("falls back to the .pdf extension when the browser gives no mime type", () => {
    const pdf = new File(["x"], "scan.pdf", { type: "" });
    const { accepted } = partitionFiles([pdf]);
    expect(accepted).toEqual([pdf]);
  });
});

describe("rejectedFilesMessage", () => {
  it("pluralizes correctly", () => {
    expect(rejectedFilesMessage(1)).toBe("1 file skipped — PDF only, 50 MB max");
    expect(rejectedFilesMessage(3)).toBe("3 files skipped — PDF only, 50 MB max");
  });
});

describe("stagingChipStatus", () => {
  it("reflects the client-only request phase before a row exists", () => {
    expect(stagingChipStatus(makeEntry({ phase: "uploading", row: null }))).toBe(
      "uploading",
    );
    expect(stagingChipStatus(makeEntry({ phase: "detecting", row: null }))).toBe(
      "detecting",
    );
  });

  it("maps the server's error status to the UI's failed status", () => {
    expect(
      stagingChipStatus(makeEntry({ row: makeRow({ status: "error" }) })),
    ).toBe("failed");
  });

  it("treats a request-level failure as failed even with no row yet", () => {
    expect(
      stagingChipStatus(makeEntry({ phase: "request-failed", row: null })),
    ).toBe("failed");
  });

  it("passes through the remaining server statuses unchanged", () => {
    for (const status of ["matched", "needs_input", "replaces_existing", "duplicate"] as const) {
      expect(stagingChipStatus(makeEntry({ row: makeRow({ status }) }))).toBe(status);
    }
  });
});

describe("needsInputReason", () => {
  it("names exactly what's missing", () => {
    expect(needsInputReason(makeRow({ school_id: null, academic_year: 2025 }))).toBe(
      "Pick a school",
    );
    expect(needsInputReason(makeRow({ school_id: 1, academic_year: null }))).toBe(
      "Pick a year",
    );
    expect(needsInputReason(makeRow({ school_id: null, academic_year: null }))).toBe(
      "Pick a school and year",
    );
  });
});

describe("stagingReason", () => {
  it("never fabricates a link target replaces_existing can't back with real data", () => {
    const { linkedDocumentId } = stagingReason(
      makeEntry({ row: makeRow({ status: "replaces_existing" }) }),
    );
    expect(linkedDocumentId).toBeNull();
  });

  it("links a duplicate to the existing document when the wire gives one", () => {
    const { linkedDocumentId, text } = stagingReason(
      makeEntry({
        row: makeRow({
          detection: {
            candidates: [],
            confident: true,
            duplicate_of: 42,
            error: null,
            name: null,
            year: null,
          },
          status: "duplicate",
        }),
      }),
    );
    expect(linkedDocumentId).toBe(42);
    expect(text).toBe("Matches an existing document");
  });

  it("surfaces the request-level error verbatim when the POST itself failed", () => {
    const { text } = stagingReason(
      makeEntry({ phase: "request-failed", requestError: "Could not reach the server.", row: null }),
    );
    expect(text).toBe("Could not reach the server.");
  });
});

describe("buildReadinessSentence", () => {
  it("reports the empty batch honestly", () => {
    expect(buildReadinessSentence([])).toBe("This batch is empty.");
  });

  it("counts each terminal category and joins with a middle dot", () => {
    const entries = [
      makeEntry({ clientId: "1", row: makeRow({ id: "1", status: "matched" }) }),
      makeEntry({ clientId: "2", row: makeRow({ id: "2", status: "matched" }) }),
      makeEntry({
        clientId: "3",
        row: makeRow({ id: "3", school_id: null, status: "needs_input" }),
      }),
      makeEntry({ clientId: "4", row: makeRow({ id: "4", status: "duplicate" }) }),
    ];
    expect(buildReadinessSentence(entries)).toBe(
      "2 ready · 1 needs input · 1 duplicate skipped",
    );
  });

  it("never counts a committed row toward staging readiness", () => {
    const entries = [makeEntry({ row: makeRow({ status: "committed" }) })];
    expect(buildReadinessSentence(entries)).toBe("This batch is empty.");
  });
});

describe("readyToProcessCount", () => {
  it("counts matched and replaces_existing, nothing else", () => {
    const entries = [
      makeEntry({ clientId: "1", row: makeRow({ id: "1", status: "matched" }) }),
      makeEntry({
        clientId: "2",
        row: makeRow({ id: "2", status: "replaces_existing" }),
      }),
      makeEntry({ clientId: "3", row: makeRow({ id: "3", status: "duplicate" }) }),
    ];
    expect(readyToProcessCount(entries)).toBe(2);
  });
});

describe("reconcileWithServer", () => {
  it("appends server-only rows on first load without dropping local order", () => {
    const serverRows = [makeRow({ id: "a" }), makeRow({ id: "b" })];
    const result = reconcileWithServer([], serverRows);
    expect(result.map((entry) => entry.row?.id)).toEqual(["a", "b"]);
  });

  it("refreshes an existing entry's row in place when the server version changed", () => {
    const stale = stagingEntryFromServerRow(makeRow({ id: "a", updated_at: "t0" }));
    const fresh = makeRow({ id: "a", status: "needs_input", updated_at: "t1" });
    const result = reconcileWithServer([stale], [fresh]);
    expect(result).toHaveLength(1);
    expect(result[0].row?.status).toBe("needs_input");
  });

  it("never drops an entry just because it's absent from a snapshot", () => {
    const uploading: StagingEntry = {
      clientId: "still-uploading",
      file: new File([], "x.pdf"),
      phase: "uploading",
      requestError: null,
      row: null,
    };
    const result = reconcileWithServer([uploading], []);
    expect(result).toEqual([uploading]);
  });
});
