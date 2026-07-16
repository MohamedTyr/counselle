import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { CitationEnvelope, RenderSpec } from "@/api/chat/types";
import { VizBlock } from "./VizBlock";

function cell(source: "cds" | "edu" | "reddit", field = "admissions.rate"): CitationEnvelope {
  return { v: 2, field, label: "Rate", display: "12%", raw: 0.12, available: true, caveats: [], marker: "[12]", evidence: source === "cds" ? { eid: field, value_display: "12%", label: "Rate", page: 7, excerpt: "Rate 12%" } : null, citation: { v: 2, source, tier: source === "reddit" ? "community" : "official", vintage: "2026", ...(source === "cds" ? { document_sha256: "a".repeat(64), source_kind: "upload", retrieved_at: "2026-07-01T00:00:00Z", academic_year: 2025, manifest_version: "5.0.1", school_unitid: 1 } : { url: "https://example.com" }) } };
}
const unavailable: CitationEnvelope = { v: 2, field: null, label: "Missing", display: "not available", available: false, caveats: [], citation: null, evidence: null, marker: null };

describe("VizBlock", () => {
  test("renders mixed source tiers, an inert unavailable hole, and exact CDS evidence focus", () => {
    const onOpen = vi.fn();
    const spec: RenderSpec = { v: 2, type: "comparison_table", title: "Admissions", columns: [{ unitid: 1, name: "North", domain: "north.edu" }, { unitid: null, name: "Web school", domain: null }], rows: [{ label: "CDS", cells: [cell("cds"), cell("edu")] }, { label: "Community", cells: [cell("reddit"), unavailable] }] };
    const { container } = render(<VizBlock onSourceOpen={onOpen} spec={spec} />);
    expect(screen.getAllByText("Official")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Open community source 12" })).toBeInTheDocument();
    expect(screen.getByText("not available")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Open official source 12" })[0]);
    expect(onOpen).toHaveBeenCalledWith({ index: 12, evidenceId: "admissions.rate" });
    expect(container.querySelector(".overflow-x-auto")).toBeInTheDocument();
  });

  test("supports null-unitid columns with collision-safe rendering", () => {
    const spec: RenderSpec = { v: 2, type: "stat_block", title: "Web", columns: [{ unitid: null, name: "Example", domain: "example.edu" }], rows: [{ label: "Rate", cells: [cell("edu")] }] };
    expect(() => render(<VizBlock spec={spec} />)).not.toThrow();
    expect(screen.getByText("Example")).toBeInTheDocument();
  });

  test("opaque types reveal no arbitrary payload values", () => {
    render(<VizBlock spec={{ v: 9, type: "future", title: "Future", secret: "do not render" }} />);
    expect(screen.getByText("Future")).toBeInTheDocument();
    expect(screen.getByText(/requires a newer client/i)).toBeInTheDocument();
    expect(screen.queryByText("do not render")).not.toBeInTheDocument();
  });
});
