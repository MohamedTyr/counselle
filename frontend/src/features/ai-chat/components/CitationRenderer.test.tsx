import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SourceEntry, SourceName } from "@/api/chat/types";
import { CitationRenderer } from "./CitationRenderer";

function entry(index: number, source: SourceName): SourceEntry {
  return {
    v: 2,
    index,
    label: `${source} source`,
    evidence:
      source === "cds"
        ? [
            {
              eid: "enrollment.undergraduate_total",
              value_display: "6,814",
              label: "Undergraduate enrollment",
              page: 4,
              excerpt: "Undergraduate enrollment 6,814.",
            },
          ]
        : [],
    evidence_omitted_count: 0,
    citation: {
      v: 2,
      source,
      tier: source === "reddit" ? "community" : "official",
      vintage: "2026",
      ...(source === "cds"
        ? {
            document_sha256: "a".repeat(64),
            source_kind: "upload",
            retrieved_at: "2026-07-01",
            academic_year: 2025,
            manifest_version: "5.0.1",
            school_unitid: 1,
          }
        : {}),
      ...(source === "profile"
        ? { school_unitid: 1, profile_sha256: "b".repeat(64) }
        : {}),
      ...(["web", "edu", "reddit"].includes(source)
        ? { url: "https://example.com/a" }
        : {}),
    },
  };
}

describe("CitationRenderer", () => {
  test("renders cds markers as an accessible chip labeled 'Common Data Set', not a number", async () => {
    const onOpen = vi.fn();
    render(
      <CitationRenderer
        markdown="Claim [12]."
        onCitationOpen={onOpen}
        sources={[entry(12, "cds")]}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open source: Common Data Set",
      }),
    );
    expect(onOpen).toHaveBeenCalledWith({ index: 12 });
    expect(screen.queryByText(/\[12\]/)).not.toBeInTheDocument();
  });

  test("renders profile markers as an accessible chip labeled 'School profile'", async () => {
    const onOpen = vi.fn();
    render(
      <CitationRenderer
        markdown="Claim [12]."
        onCitationOpen={onOpen}
        sources={[entry(12, "profile")]}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open source: School profile",
      }),
    );
    expect(onOpen).toHaveBeenCalledWith({ index: 12 });
  });

  test("external markers render as a chip labeled with the hostname", async () => {
    const onOpen = vi.fn();
    render(
      <CitationRenderer
        markdown="Claim [7]."
        onCitationOpen={onOpen}
        sources={[entry(7, "web")]}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Open source: example.com" }),
    );
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
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open source: Common Data Set",
      }),
    );
    expect(onOpen).toHaveBeenCalledWith({ index: 1 });
  });

  test("CDS chip shows the real school favicon when a matching viz domain is supplied", async () => {
    const schoolDomains = new Map([[1, "yale.edu"]]);
    const withDomain = render(
      <CitationRenderer
        markdown="Claim [1]."
        schoolDomains={schoolDomains}
        sources={[entry(1, "cds")]}
      />,
    );
    await screen.findByRole("button", { name: "Open source: Common Data Set" });
    expect(
      withDomain.container.querySelector("img[src*='yale.edu']"),
    ).not.toBeNull();
    withDomain.unmount();

    const withoutDomain = render(
      <CitationRenderer markdown="Claim [1]." sources={[entry(1, "cds")]} />,
    );
    await screen.findByRole("button", { name: "Open source: Common Data Set" });
    expect(withoutDomain.container.querySelector("img")).toBeNull();
  });
});
