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

/** Regression for the stale-message bug: `ownEditConflictMessage` is set by
 * the edit-caused-409 toast path above, but nothing clears it when a later,
 * unrelated flag-count rise makes `ApproveBar` open the *same* dialog for a
 * real blocking flag. Before the fix, the dialog kept describing the old
 * edit conflict — wrong title, the stale message as body, and the flag list
 * (the thing an admin is about to override with `override_flags: true`) not
 * rendered at all. */
const YEAR_FLAG_MESSAGE = "extracted year does not match the document's own cover page";

function reviewFixtureWithRealFlag(): DocumentReviewOut {
  const base = reviewFixture();
  return {
    ...base,
    flags_summary: { unresolved: 1, total: 1 },
    sections: [
      {
        domain_id: "b1",
        title: "General Information",
        status: "flagged",
        counts: {},
        metrics: [
          {
            ref: "B1.year_consistency",
            title: "Academic year",
            description: null,
            type: "text",
            unit: null,
            source_hints: [],
            value: null,
            raw_value: null,
            display: null,
            availability_status: null,
            extraction_status: null,
            evidence: null,
            flags: [
              {
                code: "year_consistency",
                severity: "error",
                message: YEAR_FLAG_MESSAGE,
                metric_ref: "B1.year_consistency",
              },
            ],
            pending_edit: null,
          },
        ],
      },
    ],
  };
}

describe("CdsReviewPage — the approve-anyway dialog never misdescribes what it's about to override", () => {
  test("a real blocking flag from ApproveBar replaces a stale edit-conflict message, never hides behind it", async () => {
    let getCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/v1/admin/cds/documents/42") && method === "GET") {
        getCount += 1;
        // First load: unresolved 0 (what makes Approve clickable at all).
        // Every refetch after that (triggered by the 409's onSettled)
        // reflects a real blocking flag that appeared server-side — the
        // Re-run/concurrent-write case from the bug report, collapsed to
        // its shortest form: nothing about `ownEditConflictMessage` changes
        // this GET response, only `flags_summary` and `sections` do.
        return Promise.resolve(
          jsonResponse(getCount === 1 ? reviewFixture() : reviewFixtureWithRealFlag()),
        );
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

    // Step 1: trigger the edit-caused 409 exactly like the test above, which
    // sets `ownEditConflictMessage` to the server's edit-validation message.
    const approveButton = await screen.findByRole("button", { name: "Approve" });
    approveButton.click();
    await screen.findByText(SERVER_MESSAGE);

    // Step 2: the queued refetch lands `flags_summary.unresolved: 1` with a
    // real, stored `year_consistency` flag -- `ApproveBar` now renders its
    // own "Approve anyway" for the genuine blocking-flags path. (Two buttons
    // share that name once the toast is also on screen: the toast's action
    // and ApproveBar's. Only the latter is the real blocking-flags path.)
    const blockingSentence = await screen.findByText(/blocking flag/);
    const approveAnywayButtons = screen.getAllByRole("button", { name: "Approve anyway" });
    const approveBarButton = approveAnywayButtons.find(
      (button) => !button.closest("[data-sonner-toast]"),
    );
    expect(approveBarButton).toBeDefined();
    expect(blockingSentence).toBeInTheDocument();

    approveBarButton?.click();

    // The dialog must describe *this* override, not the stale one: the
    // blocking-flags title, the real flag's message and severity chip, and
    // a confirm button naming the real count -- never the old edit-conflict
    // title/body/button, and never a bare flag-less "Approve anyway".
    expect(
      await screen.findByRole("heading", { name: "Approve with 1 blocking flags?" }),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(YEAR_FLAG_MESSAGE)).toBeInTheDocument();
    expect(within(dialog).queryByText(SERVER_MESSAGE)).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("Approve despite this edit's validation failure?"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Approve with 1 blocking flags" }),
    ).toBeInTheDocument();
  });
});
