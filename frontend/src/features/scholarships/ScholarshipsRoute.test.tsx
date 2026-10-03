import { screen, waitFor } from "@testing-library/react";

import { jsonResponse, renderApp } from "@/test/render-app";
import { scholarshipFetch, scholarshipRecord as record } from "@/test/scholarship-fixtures";

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
