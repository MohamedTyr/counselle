import type { JobStatusRow, UploadRow } from "@/api/cds-admin/types";
import {
  buildProcessedSentence,
  cdsStatusFromJob,
  indexJobsByExtractionId,
  jobProgress,
} from "@/features/cds-admin/upload/document-status";

function makeJob(overrides: Partial<JobStatusRow> = {}): JobStatusRow {
  return {
    academic_year: 2025,
    document_id: 1,
    error_code: null,
    extraction_id: "ext-1",
    finished_at: null,
    progress: {},
    queued_at: "2026-08-01T00:00:00Z",
    school_id: 1,
    school_name: "Harvard University",
    started_at: null,
    status: "queued",
    ...overrides,
  };
}

describe("cdsStatusFromJob", () => {
  it("shows processing (not running) with no job yet — a queued item that hasn't arrived in a poll", () => {
    expect(cdsStatusFromJob(undefined)).toEqual({ running: false, status: "processing" });
  });

  it("distinguishes queued from running — a queued spinner would be a small lie", () => {
    expect(cdsStatusFromJob(makeJob({ status: "queued" }))).toEqual({
      running: false,
      status: "processing",
    });
    expect(cdsStatusFromJob(makeJob({ status: "running" }))).toEqual({
      running: true,
      status: "processing",
    });
  });

  it("maps every terminal extraction status to a CdsStatus", () => {
    expect(cdsStatusFromJob(makeJob({ status: "succeeded" })).status).toBe("needs_review");
    expect(cdsStatusFromJob(makeJob({ status: "partial" })).status).toBe("needs_review");
    expect(cdsStatusFromJob(makeJob({ status: "failed" })).status).toBe("failed");
  });
});

describe("jobProgress", () => {
  it("returns null instead of a fabricated determinate bar when the shape is missing", () => {
    expect(jobProgress(makeJob({ progress: {} }))).toBeNull();
    expect(jobProgress(makeJob({ progress: { done: 4 } }))).toBeNull();
    expect(jobProgress(undefined)).toBeNull();
  });

  it("reads real {done,total} numbers", () => {
    expect(jobProgress(makeJob({ progress: { done: 4, total: 8 } }))).toEqual({
      done: 4,
      total: 8,
    });
  });
});

describe("indexJobsByExtractionId", () => {
  it("keys jobs by extraction id for O(1) row lookups", () => {
    const jobs = [makeJob({ extraction_id: "a" }), makeJob({ extraction_id: "b" })];
    const index = indexJobsByExtractionId(jobs);
    expect(index.get("a")?.extraction_id).toBe("a");
    expect(index.size).toBe(2);
  });
});

function makeCommittedRow(overrides: Partial<UploadRow> = {}): UploadRow {
  return {
    academic_year: 2025,
    batch_id: "batch-1",
    committed_document_id: 1,
    committed_extraction_id: "ext-1",
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
    filename: "harvard.pdf",
    id: "row-1",
    page_count: 38,
    school_id: 1,
    school_name: "Harvard University",
    sha256: "abc",
    size_bytes: 100,
    status: "committed",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildProcessedSentence", () => {
  it("is not complete while any job is still running", () => {
    const jobs = indexJobsByExtractionId([makeJob({ extraction_id: "ext-1", status: "running" })]);
    const result = buildProcessedSentence([makeCommittedRow()], jobs);
    expect(result.isComplete).toBe(false);
    expect(result.sentence).toBe("1 processing");
  });

  it("is complete once every committed row has a terminal job status", () => {
    const jobs = indexJobsByExtractionId([
      makeJob({ extraction_id: "ext-1", status: "succeeded" }),
      makeJob({ extraction_id: "ext-2", status: "failed" }),
    ]);
    const rows = [
      makeCommittedRow({ committed_extraction_id: "ext-1", id: "1" }),
      makeCommittedRow({ committed_extraction_id: "ext-2", id: "2" }),
    ];
    const result = buildProcessedSentence(rows, jobs);
    expect(result.isComplete).toBe(true);
    expect(result.sentence).toBe("1 done · 1 failed");
  });
});
