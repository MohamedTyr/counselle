import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { Citation, RenderSpec, SourceEntry } from "@/api/chat/types";

import { MessageSources } from "./MessageSources";

function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    source: "web",
    tier: "community",
    vintage: "Fetched 2026-06-11",
    ...overrides,
  };
}

function externalEntry(index: number, url: string): SourceEntry {
  return { index, label: "External", citation: citation({ url }) };
}

function dbEntry(index: number): SourceEntry {
  return {
    index,
    label: "North College — Common Data Set",
    citation: { source: "cds", tier: "official", vintage: "CDS 2024" },
  };
}

function vizSpec(): RenderSpec {
  return {
    v: 1,
    type: "stat_block",
    title: "Acceptance rate",
    schools: [{ unitid: 1, name: "North College" }],
    rows: [
      {
        label: "Acceptance rate",
        cells: [
          {
            v: 1,
            field: "admissions.acceptance_rate",
            label: "Acceptance rate",
            display: "12%",
            available: true,
            citation: { source: "cds", tier: "official", vintage: "CDS 2024" },
          },
        ],
      },
    ],
  };
}

describe("MessageSources", () => {
  test("never renders mid-stream, even with cited sources present", () => {
    const { container } = render(
      <MessageSources
        message={{
          blocks: [{ kind: "markdown", text: "Cited [1]." }],
          text: "Cited [1].",
          sources: [externalEntry(1, "https://www.example.com/a")],
          turnStatus: "streaming",
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  test("renders external cited sources once the turn completes", () => {
    render(
      <MessageSources
        message={{
          blocks: [{ kind: "markdown", text: "Cited [1] and [2]." }],
          text: "Cited [1] and [2].",
          sources: [
            externalEntry(1, "https://www.example.com/a"),
            externalEntry(2, "https://www.forbes.com/b"),
          ],
          turnStatus: "complete",
        }}
      />,
    );

    expect(screen.getByText("2 sources")).toBeInTheDocument();
  });

  test("shows exactly one Counselle-data credit for DB-backed viz cells with no DB source rows", () => {
    render(
      <MessageSources
        message={{
          // No markdown block cites [1], so the external source entry is not
          // "cited" — only the DB-backed viz cell's visible-content signal
          // should surface a credit here.
          blocks: [{ kind: "viz", spec: vizSpec() }],
          text: "",
          sources: [externalEntry(1, "https://www.example.com/a")],
          turnStatus: "complete",
        }}
      />,
    );

    expect(screen.getByText("1 source")).toBeInTheDocument();
  });

  test("a DB-only answer still renders a clickable strip with zero external badges", () => {
    const onOpen = vi.fn();
    render(
      <MessageSources
        message={{
          blocks: [{ kind: "markdown", text: "Acceptance rate is 12% [1]." }],
          text: "Acceptance rate is 12% [1].",
          sources: [dbEntry(1)],
          turnStatus: "complete",
        }}
        onOpen={onOpen}
      />,
    );

    const button = screen.getByRole("button");
    expect(screen.getByText("1 source")).toBeInTheDocument();
    button.click();
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ dbUsed: true, dbSchools: ["North College"] }),
    );
  });

  test("renders nothing when there is nothing to cite", () => {
    const { container } = render(
      <MessageSources
        message={{
          blocks: [{ kind: "markdown", text: "No citations here." }],
          text: "No citations here.",
          sources: [],
          turnStatus: "complete",
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  test("a stray uncited DB source row does not manufacture a Counselle-data credit", () => {
    const { container } = render(
      <MessageSources
        message={{
          blocks: [{ kind: "markdown", text: "Plain prose, no markers." }],
          text: "Plain prose, no markers.",
          sources: [dbEntry(1)],
          turnStatus: "complete",
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
