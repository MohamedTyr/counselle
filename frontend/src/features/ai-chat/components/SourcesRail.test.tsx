import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { MessageSourcesPayload, SourceEntry } from "@/api/chat/types";
import { SourcesRail } from "./SourcesRail";

function cds(): SourceEntry {
  return { v: 2, index: 3, label: "Yale — Common Data Set 2024-25", snippet: null, evidence_omitted_count: 2, citation: { v: 2, source: "cds", tier: "official", vintage: "CDS 2024-25", document_sha256: "a".repeat(64), source_kind: "upload", retrieved_at: "2026-05-02", academic_year: 2024, manifest_version: "5.0.1", school_unitid: 1, url: "https://example.edu/cds.pdf" }, evidence: [
    { eid: "z.metric", value_display: "9", label: "Later", page: 9, excerpt: "Later excerpt" },
    { eid: "admissions.rate", value_display: "12%", label: "Acceptance rate", page: 7, section: "C1", row_label: "Applicants", column_label: "Total", excerpt: "Acceptance rate 12%" },
  ] };
}
function web(): SourceEntry {
  return { v: 2, index: 8, label: "Example", snippet: "Aid overview", evidence: [], evidence_omitted_count: 0, citation: { v: 2, source: "web", tier: "official", vintage: "2026", url: "https://example.com/aid" } };
}

describe("SourcesRail", () => {
  test("renders nothing for a closed rail", () => {
    const { container } = render(<SourcesRail isMobile={false} onClose={vi.fn()} payload={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders marker order, CDS metadata, page-sorted evidence, omitted count and safe links", () => {
    const payload: MessageSourcesPayload = {
      sources: [web(), cds()],
      displayNumbers: new Map([[8, 1], [3, 2]]),
      schoolDomains: new Map(),
    };
    render(<SourcesRail isMobile={false} onClose={vi.fn()} payload={payload} />);
    expect(screen.getByRole("heading", { name: "2 sources" })).toHaveFocus();
    const rows = document.querySelectorAll("[id^='source-row-']");
    expect([...rows].map((row) => row.id)).toEqual(["source-row-3", "source-row-8"]);
    expect(screen.getByText(/upload · 2026-05-02/)).toBeInTheDocument();
    expect(screen.getByText(/Page 7 · Section C1 · Row: Applicants · Column: Total/)).toBeInTheDocument();
    expect(screen.getByText(/and 2 more values/)).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  test("focuses exact evidence and falls back to entry for missing evidence", () => {
    const displayNumbers = new Map([[3, 1]]);
    const schoolDomains = new Map<number, string>();
    const { rerender } = render(<SourcesRail isMobile={false} onClose={vi.fn()} payload={{ sources: [cds()], active: { index: 3, evidenceId: "admissions.rate" }, displayNumbers, schoolDomains }} />);
    expect(document.getElementById("source-evidence-3-admissions.rate")).toHaveFocus();
    rerender(<SourcesRail isMobile={false} onClose={vi.fn()} payload={{ sources: [cds()], active: { index: 3, evidenceId: "legacy.missing" }, displayNumbers, schoolDomains }} />);
    const fallback = document.getElementById("source-row-3");
    expect(fallback).toHaveFocus();
    expect(fallback).toHaveAttribute("data-active", "true");
    expect(fallback).toHaveAttribute("aria-current", "true");
    expect(fallback).toHaveClass("ring-2", "ring-ring");
  });

  test("legacy evidence-less CDS entries do not crash and unsafe URLs stay inert", () => {
    const legacy = { ...cds(), evidence: [], evidence_omitted_count: 0, citation: { ...cds().citation, url: "javascript:alert(1)" } };
    expect(() => render(<SourcesRail isMobile={false} onClose={vi.fn()} payload={{ sources: [legacy], displayNumbers: new Map(), schoolDomains: new Map() }} />)).not.toThrow();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("close button and Escape close the desktop rail", () => {
    const onClose = vi.fn();
    render(<SourcesRail isMobile={false} onClose={onClose} payload={{ sources: [web()], displayNumbers: new Map(), schoolDomains: new Map() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Close sources" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("visible number comes from the supplied displayNumbers map, not the raw registry index", () => {
    const payload: MessageSourcesPayload = {
      sources: [web(), cds()],
      displayNumbers: new Map([[8, 7], [3, 4]]),
      schoolDomains: new Map(),
    };
    render(<SourcesRail isMobile={false} onClose={vi.fn()} payload={payload} />);
    expect(screen.getByText(`[4] ${cds().label}`)).toBeInTheDocument();
    expect(screen.getByText(`[7] ${web().label}`)).toBeInTheDocument();
    const rows = document.querySelectorAll("[id^='source-row-']");
    expect([...rows].map((row) => row.id)).toEqual(["source-row-3", "source-row-8"]);
  });

  test("renders the real school favicon when schoolDomains resolves the entry's unitid", () => {
    const payload: MessageSourcesPayload = {
      sources: [cds()],
      displayNumbers: new Map([[3, 1]]),
      schoolDomains: new Map([[1, "yale.edu"]]),
    };
    const { container } = render(<SourcesRail isMobile={false} onClose={vi.fn()} payload={payload} />);
    expect(container.querySelector("img[src*='yale.edu']")).not.toBeNull();
  });
});
