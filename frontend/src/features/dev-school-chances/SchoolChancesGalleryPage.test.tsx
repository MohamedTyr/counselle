import { act, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { renderApp } from "@/test/render-app";
import { SchoolChancesGalleryPage } from "./SchoolChancesGalleryPage";
import { render } from "@testing-library/react";

describe("SchoolChancesGalleryPage", () => {
  test("renders the complete Phase 4 fixture matrix without network requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<SchoolChancesGalleryPage />);

    expect(
      screen.getByRole("heading", { name: "School chances gallery" }),
    ).toBeVisible();
    for (const label of [
      "Full GPA · compatible",
      "Partial GPA",
      "All GPA buckets absent",
      "Non-4.0 GPA",
      "Full paired SAT",
      "SAT total only",
      "One SAT section",
      "ACT band · no distribution",
      "No student score",
      "No school data",
      "Stale facts",
      "Different reported periods",
      "Invalid score distributions",
      "Malformed score band",
      "Malformed score distribution",
      "Endpoint absence grammar",
      "Profile request error",
      "Off-grid values",
      "Unparseable/shared-boundary GPA",
    ]) {
      expect(screen.getByRole("heading", { name: label })).toBeVisible();
    }

    expect(
      screen.getAllByRole("radio", { name: "GPA" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Fixture navigation")).toBeVisible();
    expect(
      screen.getByTestId("school-chances-gallery-fixture-all-absent"),
    ).toHaveTextContent("not reported");
    expect(
      screen.getByTestId("school-chances-gallery-fixture-endpoint-absence"),
    )
      .toHaveTextContent("Not reported")
      .toHaveTextContent("Not checked")
      .toHaveTextContent("Not on file")
      .toHaveTextContent("Not collected");
    // The SAT screen's own two-lane redesign (and its number row) is P4
    // scope (school-chances-minimal-redesign §4) — the "Not added" ledger
    // cell this asserted on died with `ComparisonLedger` in P2; the
    // unadded section still states its own absence in the placement
    // message and the accessible summary instead.
    expect(
      screen.getByTestId("school-chances-gallery-fixture-partial-profile"),
    ).toHaveTextContent(
      "Add your SAT Reading and Writing score to place yourself on this chart.",
    );
    expect(
      await screen.findByTestId("school-chances-gallery-fixture-request-error"),
    )
      .toHaveTextContent("Could not load your profile")
      .toHaveTextContent("Retry");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test("keeps every fixture addressable by stable id", () => {
    render(<SchoolChancesGalleryPage />);

    for (const id of [
      "all-absent",
      "endpoint-absence",
      "partial-profile",
      "malformed-score-band",
      "malformed-score-distribution",
      "request-error",
    ]) {
      expect(
        screen.getByTestId(`school-chances-gallery-fixture-${id}`),
      ).toBeVisible();
    }
  });

  test("is reachable through the development-only route", async () => {
    const fetchHandler = vi.fn(() => new Response(null, { status: 500 }));

    renderApp("/dev/school-chances", { fetchHandler });
    // This route boots through React Router’s dynamic import. Finish that boot
    // before starting the normal DOM-query timeout.
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(
      await screen.findByRole("heading", { name: "School chances gallery" }),
    ).toBeVisible();
    expect(fetchHandler).not.toHaveBeenCalledWith(
      expect.stringContaining("/v1/profile"),
      expect.anything(),
    );
    expect(fetchHandler).not.toHaveBeenCalledWith(
      expect.stringContaining("/v1/schools/"),
      expect.anything(),
    );
  });
});
