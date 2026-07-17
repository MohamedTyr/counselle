import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SourceEntry, SourceName } from "@/api/chat/types";
import { citationDisplayNumbers, citedIndexOrderForMessage } from "../citations";
import { CitationRenderer } from "./CitationRenderer";

function entry(index: number, source: SourceName): SourceEntry {
  return {
    v: 2, index, label: `${source} source`, evidence: source === "cds" ? [{
      eid: "enrollment.undergraduate_total",
      value_display: "6,814",
      label: "Undergraduate enrollment",
      page: 4,
      excerpt: "Undergraduate enrollment 6,814.",
    }] : [], evidence_omitted_count: 0,
    citation: {
      v: 2, source, tier: source === "reddit" ? "community" : "official", vintage: "2026",
      ...(source === "cds" ? { document_sha256: "a".repeat(64), source_kind: "upload", retrieved_at: "2026-07-01", academic_year: 2025, manifest_version: "5.0.1", school_unitid: 1 } : {}),
      ...(source === "profile" ? { school_unitid: 1, profile_sha256: "b".repeat(64) } : {}),
      ...(["web", "edu", "reddit"].includes(source) ? { url: "https://example.com/a" } : {}),
    },
  };
}

describe("CitationRenderer", () => {
  test.each(["cds", "profile"] as const)("renders %s markers as accessible source buttons", async (source) => {
    const onOpen = vi.fn();
    render(<CitationRenderer markdown="Claim [12]." onCitationOpen={onOpen} sources={[entry(12, source)]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open source 12" }));
    expect(onOpen).toHaveBeenCalledWith({ index: 12 });
  });

  test("external markers render as a unified accessible chip", async () => {
    const onOpen = vi.fn();
    render(<CitationRenderer markdown="Claim [7]." onCitationOpen={onOpen} sources={[entry(7, "web")]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open source 7" }));
    expect(onOpen).toHaveBeenCalledWith({ index: 7 });
  });

  test("unresolved markers fail closed", async () => {
    render(<CitationRenderer markdown="Claim [99]." sources={[]} />);
    expect(await screen.findByText(/Claim/)).toBeInTheDocument();
    expect(screen.queryByText("[99]")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("evidence-less CDS markers remain resolvable for document-level support", async () => {
    const onOpen = vi.fn();
    const cds = { ...entry(1, "cds"), evidence: [] };
    render(
      <CitationRenderer
        markdown="Yale's CDS 2024-25 provides the document context [1]."
        onCitationOpen={onOpen}
        sources={[cds]}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open source 1" }));
    expect(onOpen).toHaveBeenCalledWith({ index: 1 });
  });

  test("raw registry indices above the cited count render as sequential display numbers", async () => {
    const displayNumbers = citationDisplayNumbers([12, 30]);
    render(
      <CitationRenderer
        displayNumbers={displayNumbers}
        markdown="First [12], second [30]."
        sources={[entry(12, "web"), entry(30, "edu")]}
      />,
    );
    expect(await screen.findByRole("button", { name: "Open source 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open source 2" })).toBeInTheDocument();
    expect(screen.queryByText(/\[12\]/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[30\]/)).not.toBeInTheDocument();
  });

  test("display numbers follow first-appearance prose order, not raw registry order", () => {
    const markdown = "Community reports [14] agree, but the official figure [3] confirms it.";
    const order = citedIndexOrderForMessage({ text: markdown });
    const displayNumbers = citationDisplayNumbers(order);
    render(
      <CitationRenderer
        displayNumbers={displayNumbers}
        markdown={markdown}
        sources={[entry(3, "cds"), entry(14, "reddit")]}
      />,
    );
    expect(screen.getByRole("button", { name: "Open source 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open source 2" })).toBeInTheDocument();
    expect(displayNumbers.get(14)).toBe(1);
    expect(displayNumbers.get(3)).toBe(2);
  });

  test("CDS chip shows the real school favicon when a matching viz domain is supplied", () => {
    const schoolDomains = new Map([[1, "yale.edu"]]);
    const withDomain = render(
      <CitationRenderer markdown="Claim [1]." schoolDomains={schoolDomains} sources={[entry(1, "cds")]} />,
    );
    expect(withDomain.container.querySelector("img[src*='yale.edu']")).not.toBeNull();
    withDomain.unmount();

    const withoutDomain = render(<CitationRenderer markdown="Claim [1]." sources={[entry(1, "cds")]} />);
    expect(withoutDomain.container.querySelector("img")).toBeNull();
  });
});
