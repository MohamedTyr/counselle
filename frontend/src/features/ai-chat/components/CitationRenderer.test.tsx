import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Citation, SourceEntry } from "@/api/chat/types";

import { CitationRenderer } from "./CitationRenderer";

function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    source: "web",
    tier: "community",
    vintage: "Fetched 2026-06-11",
    ...overrides,
  };
}

function externalEntry(index: number, url: string): SourceEntry {
  return {
    index,
    label: "External",
    citation: citation({ url }),
  };
}

function dbEntry(index: number): SourceEntry {
  return {
    index,
    label: "North College — Common Data Set",
    citation: { source: "cds", tier: "official", vintage: "CDS 2024" },
  };
}

describe("CitationRenderer", () => {
  test("renders an inline citation chip for an external cited marker", async () => {
    render(
      <CitationRenderer
        markdown="Tuition is high [1]."
        sources={[externalEntry(1, "https://www.example.com/tuition")]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("example.com")).toBeInTheDocument();
    });
  });

  test("clicking an inline citation asks the shared sources rail to focus it", async () => {
    const onCitationOpen = vi.fn();
    render(
      <CitationRenderer
        markdown="Tuition is high [7]."
        onCitationOpen={onCitationOpen}
        sources={[externalEntry(7, "https://www.example.com/tuition")]}
      />,
    );

    const chip = await screen.findByText("example.com");
    fireEvent.click(chip);

    expect(onCitationOpen).toHaveBeenCalledWith(7);
  });

  test("unsafe citation urls are not rendered as clickable links", async () => {
    render(
      <CitationRenderer
        markdown="Unsafe [1]."
        sources={[externalEntry(1, "javascript:alert(1)")]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Source")).toBeInTheDocument();
    });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("does not treat a marker inside inline code as a citation", async () => {
    render(
      <CitationRenderer
        markdown="Visible [1] but not `[2]`."
        sources={[
          externalEntry(1, "https://www.example.com/a"),
          externalEntry(2, "https://www.example.com/b"),
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("example.com")).toBeInTheDocument();
    });

    // The code span keeps its literal bracketed text; it must never resolve
    // into a second citation chip for source #2.
    expect(screen.getByText("[2]")).toBeInTheDocument();
    expect(screen.getAllByText("example.com")).toHaveLength(1);
  });

  test("a DB-sourced marker renders no inline pill", async () => {
    render(
      <CitationRenderer
        markdown="Acceptance rate is 12% [1]."
        sources={[dbEntry(1)]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Acceptance rate is 12%/)).toBeInTheDocument();
    });

    // No chip renders for a DB source — the digit itself is dropped, not
    // replaced by a pill, and no external source label ever appears.
    expect(screen.queryByText("[1]")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("a marker with no matching source entry renders nothing inline", async () => {
    render(<CitationRenderer markdown="Unresolved claim [9]." sources={[]} />);

    await waitFor(() => {
      expect(screen.getByText(/Unresolved claim/)).toBeInTheDocument();
    });

    expect(screen.queryByText("[9]")).not.toBeInTheDocument();
  });
});
