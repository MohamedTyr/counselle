import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, test, vi } from "vitest";

import { AppProviders } from "@/app/AppProviders";
import type { DocumentReviewOut } from "@/api/cds-admin/types";
import { createTestQueryClient, jsonResponse } from "@/test/render-app";

import { CdsReviewPage } from "./cds-review-page";

/** caa19e8: an admin's own edit can push a metric out of range (e.g. a
 * percent set above 100). The backend refuses to write and 409s — but
 * before this fix the frontend swallowed the reason twice over: the shared
 * error helper discarded the server's message, and the review page treated
 * every 409 as "flags already on the document," which for this
 * edit-caused case never resolves (nothing was written, so a refetch can
 * never raise `flags_summary.unresolved` above 0) — Approve just did
 * nothing. This pins the *edit-caused* 409 (`flags_summary.unresolved`
 * already 0 pre-click, the only state from which the Approve button can
 * even be clicked): the server's real message must reach the screen with
 * an "Approve anyway" escape hatch, and the stale flags-changed path must
 * stay silent. */
const SERVER_MESSAGE =
  "these edits fail 1 validation check(s) -- percent value '150%' is outside the valid 0-100 range";

function reviewFixture(): DocumentReviewOut {
  return {
    document: {
      id: 42,
      school_year_id: 1,
      school_id: 1,
      school_name: "Yale University",
      academic_year: 2025,
      pdf_sha256: "sha",
      pdf_size_bytes: 100,
      original_filename: "yale.pdf",
      source_kind: "upload",
      retrieved_at: "2026-08-01T00:00:00Z",
      invalidated_at: null,
      superseded_at: null,
      is_candidate: true,
      is_active: false,
      is_correction_pending: false,
      page_count: 43,
    },
    extraction: {
      id: "ext-1",
      status: "succeeded",
      extractor_version: "1",
      model_id: "m",
      finished_at: "2026-08-01T00:01:00Z",
      error_code: null,
      counts: {},
    },
    sections: [],
    // Pre-click `unresolved: 0` is what makes the Approve button clickable
    // in the first place — the exact state `useApproveDocument`'s doc
    // comment calls "case 2".
    flags_summary: { unresolved: 0, total: 0 },
  };
}

function renderPage() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/v1/admin/cds/documents/42") && method === "GET") {
      return Promise.resolve(jsonResponse(reviewFixture()));
    }
    if (url.endsWith("/v1/admin/cds/documents/42/approve") && method === "POST") {
      return Promise.resolve(
        jsonResponse(
          { error: { message: SERVER_MESSAGE, trace_id: "trace-1" } },
          { status: 409 },
        ),
      );
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <AppProviders queryClient={createTestQueryClient()}>
      <MemoryRouter initialEntries={["/admin/cds/documents/42"]}>
        <Routes>
          <Route element={<CdsReviewPage />} path="/admin/cds/documents/:documentId" />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("CdsReviewPage — an edit-caused 409 on Approve is visible, not a silent no-op", () => {
  test("surfaces the server's real message with an Approve-anyway action, and never claims flags changed server-side", async () => {
    renderPage();

    const approveButton = await screen.findByRole("button", { name: "Approve" });
    expect(approveButton).toBeEnabled();
    approveButton.click();

    // The server's real reason reaches the screen (not a generic
    // placeholder, and not silently dropped).
    const toastAction = await screen.findByRole("button", { name: "Approve anyway" });
    expect(screen.getByText(SERVER_MESSAGE)).toBeInTheDocument();

    // Case 1's consequence (the live region announcing a stale-flags
    // refetch) must never fire for this edit-caused case: nothing was
    // written, so `flags_summary.unresolved` can never rise for a refetch
    // to reveal.
    expect(
      screen.queryByText("Flags changed on the server — review before approving."),
    ).not.toBeInTheDocument();

    toastAction.click();

    // The dialog must show the server's own message, never a lying
    // "Approve with 0 blocking flags?" — there is no stored flag to list.
    expect(
      await screen.findByRole("heading", {
        name: "Approve despite this edit's validation failure?",
      }),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(SERVER_MESSAGE)).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/Approve with \d+ blocking flags/),
    ).not.toBeInTheDocument();
  });
});
