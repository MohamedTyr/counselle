import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { CitationEnvelope, RenderSpec } from "@/api/chat/types";
import { VizBlock } from "./VizBlock";

function cell(
  source: "cds" | "edu" | "reddit" | "db",
  field = "admissions.rate",
  marker = "[12]",
): CitationEnvelope {
  return {
    v: 2,
    field,
    label: "Rate",
    display: "12%",
    raw: 0.12,
    available: true,
    caveats: [],
    marker,
    evidence:
      source === "cds"
        ? {
            eid: field,
            value_display: "12%",
            label: "Rate",
            page: 7,
            excerpt: "Rate 12%",
          }
        : null,
    citation: {
      v: 2,
      source,
      tier: source === "reddit" ? "community" : source === "db" ? null : "official",
      vintage: "2026",
      ...(source === "cds"
        ? {
            document_sha256: "a".repeat(64),
            source_kind: "upload",
            retrieved_at: "2026-07-01T00:00:00Z",
            academic_year: 2025,
            manifest_version: "5.0.1",
            school_unitid: 1,
          }
        : source === "db"
          ? { school_unitid: 1 }
          : { url: "https://example.com" }),
    },
  };
}
const unavailable: CitationEnvelope = {
  v: 2,
  field: null,
  label: "Missing",
  display: "not available",
  available: false,
  caveats: [],
  citation: null,
  evidence: null,
  marker: null,
};

describe("VizBlock", () => {
  test("renders mixed source tiers, an inert unavailable hole, and exact CDS evidence focus", () => {
    const onOpen = vi.fn();
    const spec: RenderSpec = {
      v: 2,
      type: "comparison_table",
      title: "Admissions",
      columns: [
        { unitid: 1, name: "North", domain: "north.edu" },
        { unitid: null, name: "Web school", domain: null },
      ],
      rows: [
        { label: "CDS", cells: [cell("cds"), cell("edu")] },
        { label: "Community", cells: [cell("reddit"), unavailable] },
      ],
      foot: [],
    };
    const { container } = render(
      <VizBlock onSourceOpen={onOpen} spec={spec} />,
    );
    expect(screen.getAllByText("Official")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Open community source 12" }),
    ).toBeInTheDocument();
    expect(screen.getByText("not available")).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Open official source 12" })[0],
    );
    expect(onOpen).toHaveBeenCalledWith({
      index: 12,
      evidenceId: "admissions.rate",
    });
    expect(container.querySelector(".overflow-x-auto")).toBeInTheDocument();
  });

  test("supports null-unitid columns with collision-safe rendering", () => {
    const spec: RenderSpec = {
      v: 2,
      type: "stat_block",
      title: "Web",
      columns: [{ unitid: null, name: "Example", domain: "example.edu" }],
      rows: [{ label: "Rate", cells: [cell("edu")] }],
      foot: [],
    };
    expect(() => render(<VizBlock spec={spec} />)).not.toThrow();
    expect(screen.getByText("Example")).toBeInTheDocument();
  });

  test("renders no tier badge for a db-sourced cell", () => {
    const onOpen = vi.fn();
    const spec: RenderSpec = {
      v: 2,
      type: "stat_block",
      title: "Facts",
      columns: [{ unitid: 1, name: "North" }],
      rows: [{ label: "Rate", cells: [cell("db", "admissions.rate", "[9]")] }],
      foot: [],
    };
    render(<VizBlock onSourceOpen={onOpen} spec={spec} />);
    expect(screen.queryByText("Official")).not.toBeInTheDocument();
    expect(screen.queryByText("Community")).not.toBeInTheDocument();
    const openButton = screen.getByRole("button", { name: "Open source 9" });
    expect(openButton).toHaveTextContent("Source");
    fireEvent.click(openButton);
    expect(onOpen).toHaveBeenCalledWith({ index: 9 });
  });

  test("opaque types reveal no arbitrary payload values", () => {
    render(
      <VizBlock
        spec={{
          v: 9,
          type: "future",
          title: "Future",
          secret: "do not render",
        }}
      />,
    );
    expect(screen.getByText("Future")).toBeInTheDocument();
    expect(screen.getByText(/requires a newer client/i)).toBeInTheDocument();
    expect(screen.queryByText("do not render")).not.toBeInTheDocument();
  });
});
