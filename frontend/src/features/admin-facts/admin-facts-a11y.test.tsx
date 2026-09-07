import { screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { expect, describe, test } from "vitest";

import type { CrawlRunSummary, FactsStatus } from "@/api/admin/facts-status";
import { authUserFixture, jsonResponse, renderApp } from "@/test/render-app";

expect.extend(toHaveNoViolations);

/**
 * Automated accessibility smoke test for the school-data admin dashboard
 * (plan §5.5, joins the rest of the Phase-1-and-onward a11y suite). axe-core
 * in jsdom cannot verify real computed colour contrast or exercise a live
 * screen reader — this catches invalid/missing ARIA, unlabeled interactive
 * controls, redundant roles, and duplicate ids. Covers the three states
 * most likely to be skipped: the loaded dashboard, the worker-disabled
 * empty state, and the error card.
 */

const superuserFixture = { ...authUserFixture, is_superuser: true };

function runFixture(): CrawlRunSummary {
  return {
    id: 1,
    started_at: "2026-09-05T03:12:00Z",
    finished_at: "2026-09-05T05:10:00Z",
    duration_s: 7080,
    status: "succeeded",
    error_code: null,
    error_message: null,
    build_id: "abc123",
    build_id_rotations: 1,
    schools_seen: 2584,
    pages_fetched: 15504,
    pages_changed: 218,
    pages_failed: 12,
    facts_changed: 900,
    unmapped_label_count: 41,
  };
}

function statusFixture(overrides: Partial<FactsStatus> = {}): FactsStatus {
  return {
    last_run: runFixture(),
    next_run_at: "2026-09-05T12:00:00Z",
    worker_enabled: true,
    queued_or_running: false,
    coverage: {
      sitemap_slugs: 2592,
      crosswalk_matched: 2584,
      crosswalk_unmatched: 8,
      schools_total: 2746,
      schools_with_facts: 2392,
    },
    tab_failures: [{ tab: "admission", status: "http_error", count: 3 }],
    unmapped_labels: [],
    unmapped_labels_truncated: false,
    history: [runFixture()],
    ...overrides,
  };
}

function fetchFor(status: FactsStatus | "error") {
  return (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/me")) {
      return jsonResponse(superuserFixture);
    }
    if (url.endsWith("/v1/admin/facts/status")) {
      return status === "error"
        ? jsonResponse({ error: { message: "boom" } }, { status: 500 })
        : jsonResponse(status);
    }
    if (url.includes("/v1/admin/facts/unmapped")) {
      return jsonResponse({ items: [], total: 0 });
    }
    return jsonResponse({});
  };
}

describe("admin facts dashboard accessibility", () => {
  test("the loaded dashboard has no automatically-detectable a11y violations", async () => {
    const { container } = renderApp("/app/admin/facts", {
      fetchHandler: fetchFor(statusFixture()),
    });
    await screen.findByText("Per-tab health");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test("the worker-disabled empty state has no automatically-detectable a11y violations", async () => {
    const { container } = renderApp("/app/admin/facts", {
      fetchHandler: fetchFor(
        statusFixture({
          last_run: null,
          next_run_at: null,
          worker_enabled: false,
          queued_or_running: false,
          history: [],
        }),
      ),
    });
    await screen.findByText("No passes yet");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test("the error state has no automatically-detectable a11y violations", async () => {
    const { container } = renderApp("/app/admin/facts", {
      fetchHandler: fetchFor("error"),
    });
    await screen.findByText("Could not load crawl status");
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
