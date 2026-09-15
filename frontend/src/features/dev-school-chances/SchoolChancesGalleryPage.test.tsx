import { screen } from "@testing-library/react";
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
    expect(
      screen.getByTestId("school-chances-gallery-fixture-partial-profile"),
    ).toHaveTextContent("Not added");
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
