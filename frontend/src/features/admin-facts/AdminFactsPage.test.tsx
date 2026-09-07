import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import type { CrawlRunSummary, CrawlStatus, FactsStatus } from "@/api/admin/facts-status";
import { authUserFixture, jsonResponse, renderApp } from "@/test/render-app";

/**
 * Behavior tests for the school-data admin dashboard (plan §5.5, §7 Phase 1
 * exit criteria). These are the exit-test-pinned assertions, verbatim:
 *
 * - Worker disabled: `next_run_at` null, screen says "Worker disabled", and
 *   BOTH `[Run a pass now]` instances render `aria-disabled` (not
 *   `disabled`), carry the reason in the accessible name, and enqueue
 *   nothing on click.
 * - A pass already queued: both buttons carry the queued reason instead.
 * - Neither ever renders `loading` while no POST is in flight.
 * - Run outcomes: `aborted` -> "Stopped", `partial` -> "Completed with
 *   errors", never "Completed" for either.
 * - Before the first pass ever runs: "No passes yet".
 */

const superuserFixture = { ...authUserFixture, is_superuser: true };

function runFixture(overrides: Partial<CrawlRunSummary> = {}): CrawlRunSummary {
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
    ...overrides,
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

function createFetch(status: FactsStatus) {
  let currentStatus = status;
  let enqueueCalls = 0;
  return {
    getEnqueueCalls: () => enqueueCalls,
    handler: (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/me")) {
        return jsonResponse(superuserFixture);
      }
      if (url.endsWith("/v1/admin/facts/status")) {
        return jsonResponse(currentStatus);
      }
      if (url.includes("/v1/admin/facts/unmapped")) {
        return jsonResponse({ items: [], total: 0 });
      }
      if (url.endsWith("/v1/admin/facts/passes") && init?.method === "POST") {
        enqueueCalls += 1;
        if (currentStatus.queued_or_running) {
          return jsonResponse(
            { error: { message: "A pass is already queued or running." } },
            { status: 409 },
          );
        }
        currentStatus = { ...currentStatus, queued_or_running: true };
        return new Response(null, { status: 202 });
      }
      return jsonResponse({});
    },
  };
}

async function findAllRunPassButtons() {
  return screen.findAllByRole("button", { name: /Run a pass now/ });
}

/** Both instances — the header's and the empty state's — only coexist when
 * there's no `last_run` yet (the empty state only renders then). */
async function findBothRunPassButtons() {
  const buttons = await findAllRunPassButtons();
  expect(buttons).toHaveLength(2);
  return buttons;
}

describe("admin facts dashboard — worker disabled", () => {
  test("both Run-a-pass-now buttons render aria-disabled with the worker-disabled reason, and enqueue nothing", async () => {
    const user = userEvent.setup();
    const status = statusFixture({
      last_run: null,
      next_run_at: null,
      worker_enabled: false,
      queued_or_running: false,
      history: [],
    });
    const fetch = createFetch(status);
    renderApp("/app/admin/facts", { fetchHandler: fetch.handler });

    await screen.findByText("Worker disabled");
    await screen.findByText("No passes yet");

    const buttons = await findBothRunPassButtons();
    for (const button of buttons) {
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleName(
        "Run a pass now unavailable: Set COUNSELLE_FACTS_WORKER_ENABLED=true, or run python -m app.facts --once, to start a pass",
      );
      await user.click(button);
    }

    expect(fetch.getEnqueueCalls()).toBe(0);
  });
});

describe("admin facts dashboard — a pass already queued", () => {
  test("both Run-a-pass-now buttons carry the queued reason and stay aria-disabled", async () => {
    // `last_run: null` so the empty state's button coexists with the
    // header's — the case the exit test names explicitly ("both instances").
    const status = statusFixture({
      last_run: null,
      history: [],
      queued_or_running: true,
    });
    const fetch = createFetch(status);
    renderApp("/app/admin/facts", { fetchHandler: fetch.handler });

    const buttons = await findBothRunPassButtons();
    for (const button of buttons) {
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleName(
        "Run a pass now unavailable: A pass is already queued or running",
      );
    }
  });

  test("never renders `loading` while no POST is in flight", async () => {
    const status = statusFixture();
    const fetch = createFetch(status);
    renderApp("/app/admin/facts", { fetchHandler: fetch.handler });

    const buttons = await findAllRunPassButtons();
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).not.toHaveAttribute("data-loading");
    }
  });
});

describe("admin facts dashboard — run outcomes render honestly", () => {
  test.each<[CrawlStatus, string]>([
    ["aborted", "Stopped"],
    ["partial", "Completed with errors"],
    ["succeeded", "Completed"],
  ])("a %s pass renders \"%s\"", async (crawlStatus, expectedLabel) => {
    const status = statusFixture({ last_run: runFixture({ status: crawlStatus }) });
    const fetch = createFetch(status);
    renderApp("/app/admin/facts", { fetchHandler: fetch.handler });

    const tile = await screen.findByText("Last pass");
    const card = tile.closest("div");
    expect(card).not.toBeNull();
    const scoped = within(card as HTMLElement);
    await waitFor(() => {
      expect(scoped.getByText(expectedLabel, { exact: true })).toBeInTheDocument();
    });
    // "aborted"/"partial" must never render the literal word "Completed"
    // on its own (plan §7 exit test) — only the exact expected label.
    if (expectedLabel !== "Completed") {
      expect(scoped.queryByText("Completed", { exact: true })).toBeNull();
    }
  });
});
