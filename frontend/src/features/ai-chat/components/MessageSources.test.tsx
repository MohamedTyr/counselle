import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Citation, RenderSpec, SourceEntry } from "@/api/chat/types";
import { MessageSources } from "./MessageSources";

const SHA = "a".repeat(64);
const cds: Citation = { v: 2, source: "cds", tier: "official", vintage: "CDS 2024-25", document_sha256: SHA, source_kind: "upload", retrieved_at: "2026-07-15T00:00:00Z", academic_year: 2024, manifest_version: "5.0.1", school_unitid: 1 };
function source(index: number, citation: Citation): SourceEntry { return { v: 2, index, label: citation.source === "cds" ? "North College — Common Data Set 2024-25" : "External", citation, evidence: citation.source === "cds" ? [{ eid: "admissions.rate", value_display: "12%", label: "Rate", page: 7, excerpt: "Rate 12%" }] : [], evidence_omitted_count: 0 }; }
const spec: RenderSpec = { v: 2, type: "stat_block", title: "Rate", columns: [{ unitid: 1, name: "North College" }], rows: [{ label: "Rate", cells: [{ v: 2, field: "admissions.rate", label: "Rate", display: "12%", available: true, citation: cds, evidence: { eid: "admissions.rate", value_display: "12%", label: "Rate", page: 7, excerpt: "Rate 12%" }, caveats: [], marker: "[2]" }] }] };
const web: Citation = { v: 2, source: "web", tier: "official", vintage: "Retrieved 2026", url: "https://example.com" };

describe("MessageSources", () => {
  test("renders actual prose and viz documents, including viz-only CDS, with no synthetic credit", () => {
    const onOpen = vi.fn();
    render(<MessageSources message={{ blocks: [{ kind: "markdown", text: "External [1]." }, { kind: "viz", spec }], text: "", sources: [source(1, web), source(2, cds), source(9, cds)], turnStatus: "complete" }} onOpen={onOpen} />);
    expect(screen.getByText("2 sources")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith({ sources: [source(1, web), source(2, cds)], active: undefined });
    expect(JSON.stringify(onOpen.mock.calls[0][0])).not.toContain("counselle-data");
    expect(onOpen.mock.calls[0][0]).not.toHaveProperty("dbUsed");
  });

  test("renders nothing mid-stream or for uncited cumulative rows", () => {
    const { container, rerender } = render(<MessageSources message={{ blocks: [{ kind: "markdown", text: "No marker." }], text: "", sources: [source(2, cds)], turnStatus: "streaming" }} />);
    expect(container.firstChild).toBeNull();
    rerender(<MessageSources message={{ blocks: [{ kind: "markdown", text: "No marker." }], text: "", sources: [source(2, cds)], turnStatus: "complete" }} />);
    expect(container.firstChild).toBeNull();
  });
});
