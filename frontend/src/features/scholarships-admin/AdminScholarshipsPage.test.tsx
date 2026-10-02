import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AdminScholarship } from "@/api/scholarships/types";
import { todayIso } from "@/features/scholarships-admin/editor-draft";
import { authUserFixture, defaultAuthenticatedFetch, jsonResponse, renderApp } from "@/test/render-app";

function admin(overrides: Partial<AdminScholarship>): AdminScholarship {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: new Date().toISOString(),
    updated_by_email: null,
    status: "draft",
    version: 4,
    name: "Future Leaders Award",
    sponsor: "Acme Foundation",
    summary: "For students who lead.",
    apply_url: "https://acme.org/apply",
    source_url: "https://acme.org/scholarship",
    logo_url: "",
    award: { kind: "fixed", amount: 5000, min: null, max: null, renewable: false, years: null, awards_count: null },
    deadline: { kind: "rolling", date: null, opens_on: null, recurs_annually: false },
    basis: ["merit"],
    fields: [],
    eligibility: [],
    other_eligibility: [],
    requirements: { essays: [], recommendations: 0, transcript: false, financial_documents: false, interview: false },
    last_checked_on: todayIso(),
    ...overrides,
  };
}

function server(records: AdminScholarship[]) {
  const posts: { url: string; body: unknown }[] = [];
  const handler = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/me")) return jsonResponse({ ...authUserFixture, is_superuser: true });
    if (url.endsWith("/v1/admin/scholarships")) return jsonResponse(records);
    if (init?.method === "POST" && url.includes("/v1/admin/scholarships/")) {
      posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      return jsonResponse({ ...records[0], version: records[0].version + 1, last_checked_on: todayIso() });
    }
    return defaultAuthenticatedFetch(input, init);
  };
  return { handler, posts };
}

afterEach(() => vi.unstubAllGlobals());

describe("AdminScholarshipsPage", () => {
  it("reads Never checked for a record never checked, and flags it", async () => {
    renderApp("/app/admin/scholarships", { fetchHandler: server([admin({ last_checked_on: null })]).handler });

    const row = (await screen.findByText("Future Leaders Award")).closest("tr") as HTMLElement;
    expect(within(row).getAllByText("Never checked").length).toBeGreaterThanOrEqual(1);
    expect(within(row).queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("marks checked from the row menu and sends the row's version on a status change", async () => {
    const user = userEvent.setup();
    const fake = server([admin({ status: "published" })]);
    renderApp("/app/admin/scholarships", { fetchHandler: fake.handler });

    await user.click(await screen.findByRole("button", { name: "Actions for Future Leaders Award" }));
    await user.click(screen.getByRole("menuitem", { name: "Mark checked today" }));
    await waitFor(() => expect(fake.posts.some((post) => post.url.endsWith("/checked"))).toBe(true));

    await user.click(screen.getByRole("button", { name: "Actions for Future Leaders Award" }));
    await user.click(screen.getByRole("menuitem", { name: "Unpublish" }));
    await waitFor(() => expect(fake.posts.find((post) => post.url.endsWith("/status"))?.body).toEqual({ status: "draft", expected_version: 4 }));
  });
});
