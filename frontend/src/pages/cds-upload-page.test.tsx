import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, test, vi } from "vitest";

import { AppProviders } from "@/app/AppProviders";
import type { ProcessResult, UploadRow } from "@/api/cds-admin/types";
import { createTestQueryClient, jsonResponse } from "@/test/render-app";

import { CdsUploadPage } from "./cds-upload-page";

/** [F-04] regression: once a batch has been processed, a file added
 * afterward must still be queueable. The old `isProcessed` flag latched
 * `hasTriggeredProcess`/`committedRows.length > 0` permanently true, so
 * "Process all" never reappeared for a file dropped after an earlier batch
 * in the same `?batch=` session had already finished — see
 * `plans/cds-admin-polish-2.md` [F-04]. This in-memory fetch mock plays the
 * server for one batch: `POST /uploads` stages a ready row, `POST
 * /uploads/{id}/process` commits every ready row and hands it an
 * extraction, and `GET /jobs` reports every committed row as already
 * `succeeded` so the batch reads as complete without a poll loop. */
function makePdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

function renderUploadPage() {
  const rowsByBatch = new Map<string, UploadRow[]>();
  let nextRowId = 1;

  function rowFor(filename: string, batchId: string): UploadRow {
    const id = `row-${nextRowId++}`;
    return {
      academic_year: 2025,
      batch_id: batchId,
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
      filename,
      id,
      page_count: 10,
      school_id: 1,
      school_name: "Harvard University",
      sha256: `sha-${id}`,
      size_bytes: 1024,
      status: "matched",
      updated_at: "2026-08-01T00:00:00Z",
    };
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/v1/admin/cds/uploads") && method === "POST") {
      const formData = init!.body as FormData;
      const file = formData.get("file") as File;
      const batchId = String(formData.get("batch_id"));
      const row = rowFor(file.name, batchId);
      rowsByBatch.set(batchId, [...(rowsByBatch.get(batchId) ?? []), row]);
      return jsonResponse(row);
    }

    if (url.includes("/v1/admin/cds/uploads?") && method === "GET") {
      const batchId = new URL(url, "http://test").searchParams.get("batch_id")!;
      return jsonResponse({ batch_id: batchId, rows: rowsByBatch.get(batchId) ?? [] });
    }

    const processMatch = url.match(/\/v1\/admin\/cds\/uploads\/([^/]+)\/process$/);
    if (processMatch && method === "POST") {
      const batchId = processMatch[1];
      const rows = rowsByBatch.get(batchId) ?? [];
      const result: ProcessResult = { queued: [], skipped: [] };
      const updated = rows.map((row) => {
        if (row.status !== "matched" && row.status !== "replaces_existing") {
          return row;
        }
        const extractionId = `ext-${row.id}`;
        result.queued.push({
          document_id: Number(row.id.replace("row-", "")),
          extraction_id: extractionId,
          file_id: row.id,
          school_year_id: 1,
        });
        return {
          ...row,
          committed_document_id: Number(row.id.replace("row-", "")),
          committed_extraction_id: extractionId,
          status: "committed" as const,
          // `reconcileWithServer` only replaces an already-known row when
          // `updated_at` actually changes -- bump it here the same way the
          // real backend does on a status transition.
          updated_at: "2026-08-01T00:02:00Z",
        };
      });
      rowsByBatch.set(batchId, updated);
      return jsonResponse(result);
    }

    if (url.includes("/v1/admin/cds/jobs?") && method === "GET") {
      const batchId = new URL(url, "http://test").searchParams.get("batch_id")!;
      const rows = (rowsByBatch.get(batchId) ?? []).filter(
        (row) => row.status === "committed",
      );
      return jsonResponse(
        rows.map((row) => ({
          academic_year: row.academic_year ?? 2025,
          document_id: row.committed_document_id!,
          error_code: null,
          extraction_id: row.committed_extraction_id!,
          finished_at: "2026-08-01T00:05:00Z",
          progress: {},
          queued_at: "2026-08-01T00:00:00Z",
          school_id: row.school_id ?? 1,
          school_name: row.school_name ?? "Harvard University",
          started_at: "2026-08-01T00:01:00Z",
          status: "succeeded",
        })),
      );
    }

    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <AppProviders queryClient={createTestQueryClient()}>
      <MemoryRouter initialEntries={["/app/admin/cds/upload"]}>
        <Routes>
          <Route element={<CdsUploadPage />} path="/app/admin/cds/upload" />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

function addFiles(files: File[]) {
  const input = screen.getByLabelText("Choose Common Data Set PDF files");
  fireEvent.change(input, { target: { files } });
}

describe("CdsUploadPage — single-pass terminal state", () => {
  test("processing every staged file switches the action bar to Open coverage", async () => {
    renderUploadPage();

    addFiles([makePdf("a.pdf"), makePdf("b.pdf"), makePdf("c.pdf")]);

    const processButton = await screen.findByRole("button", { name: "Process all (3)" });
    processButton.click();

    expect(await screen.findByRole("link", { name: "Open coverage" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Process all/ }),
    ).not.toBeInTheDocument();
  });
});

describe("CdsUploadPage — [F-04] a file added after the batch finishes stays queueable", () => {
  test("Process all reappears for a file dropped in after Open coverage is already showing", async () => {
    renderUploadPage();

    addFiles([makePdf("a.pdf"), makePdf("b.pdf"), makePdf("c.pdf")]);
    const processButton = await screen.findByRole("button", { name: "Process all (3)" });
    processButton.click();
    await screen.findByRole("link", { name: "Open coverage" });

    // A 4th file dropped in after the batch already finished — the strip
    // drop zone is still on screen, unhidden and unguarded.
    addFiles([makePdf("d.pdf")]);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Process all (1)" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "Open coverage" })).not.toBeInTheDocument();
  });
});
