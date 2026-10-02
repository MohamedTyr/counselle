import { screen, waitFor } from "@testing-library/react";

import type { ScholarshipPublic } from "@/api/scholarships/types";
import { defaultAuthenticatedFetch, jsonResponse, renderApp } from "@/test/render-app";

function record(overrides: Partial<ScholarshipPublic> = {}): ScholarshipPublic {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-09-01T00:00:00Z",
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
    last_checked_on: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

function scholarshipFetch(list: () => Promise<Response> | Response) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/v1/scholarships")) return list();
    if (url.endsWith("/v1/scholarships/saved")) return jsonResponse({ ids: [] });
    return defaultAuthenticatedFetch(input, init);
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("ScholarshipsRoute", () => {
  it("shows the nothing-published state for an empty list, not the filtered one", async () => {
    renderApp("/app/scholarships", { fetchHandler: scholarshipFetch(() => jsonResponse({ items: [] })) });

    expect(await screen.findByText("No scholarships yet")).toBeInTheDocument();
    expect(screen.queryByText("No scholarships match")).not.toBeInTheDocument();
  });

  it("clears a deep link to a record missing from the loaded list and says so", async () => {
    renderApp("/app/scholarships?view=all&s=22222222-2222-4222-8222-222222222222", {
      fetchHandler: scholarshipFetch(() => jsonResponse({ items: [record()] })),
    });

    expect(await screen.findByText("That scholarship isn't available any more.")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).not.toContain("s=2222"));
  });

  it("leaves a deep link alone while the list is still loading", async () => {
    renderApp("/app/scholarships?s=22222222-2222-4222-8222-222222222222", {
      fetchHandler: scholarshipFetch(() => new Promise<Response>(() => {})),
    });

    await screen.findByRole("heading", { name: "Scholarships" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.location.search).toContain("s=2222");
    expect(screen.queryByText("That scholarship isn't available any more.")).not.toBeInTheDocument();
  });
});
