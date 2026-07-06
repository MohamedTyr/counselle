import { describe, expect, test } from "vitest";

import type { Citation, RenderSpec, SourceEntry } from "@/api/chat/types";

import {
  citedIndexesIn,
  citedSourcesForMessage,
  dbSchoolsForMessage,
  friendlySourceName,
  isDbSource,
  uniqueSourceByIndex,
  usedDbData,
} from "./citations";

function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    source: "web",
    tier: "community",
    vintage: "Fetched 2026-06-11",
    ...overrides,
  };
}

function entry(
  index: number,
  source: SourceEntry["citation"]["source"],
  url?: string | null,
): SourceEntry {
  return {
    index,
    label: source === "cds" ? "North College — Common Data Set" : "External",
    citation: citation({
      source,
      tier: isDbSource(source) || source === "edu" ? "official" : "community",
      url,
    }),
  };
}

function renderSpec(): RenderSpec {
  return {
    v: 1,
    type: "comparison_table",
    title: "Admissions",
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
            raw: 0.12,
            available: true,
            citation: {
              source: "cds",
              tier: "official",
              vintage: "CDS 2024",
            },
          },
        ],
      },
    ],
  };
}

describe("citation parsing", () => {
  test("parses one, two, and three digit citation markers", () => {
    expect([...citedIndexesIn("See [1], [12], [123], and [1234].")]).toEqual([
      1,
      12,
      123,
    ]);
  });

  test("does not parse markers inside inline or fenced code", () => {
    const markdown = [
      "Visible [1] but not `[2]`.",
      "```ts",
      "const x = '[3]'",
      "```",
      "Visible again [4].",
    ].join("\n");

    expect([...citedIndexesIn(markdown)]).toEqual([1, 4]);
  });

  test("does not parse markers inside link destinations", () => {
    expect(
      [...citedIndexesIn("Visible [1] and [link](https://example.com/[2]).")],
    ).toEqual([1]);
  });

  test("fails closed for duplicate source indexes", () => {
    const sources = [
      entry(1, "web", "https://a.example"),
      entry(1, "web", "https://b.example"),
    ];

    expect(uniqueSourceByIndex(sources, 1)).toBeUndefined();
    expect(
      citedSourcesForMessage({
        blocks: [{ kind: "markdown", text: "Cited [1]." }],
        sources,
      }),
    ).toEqual([]);
  });

  test("filters cited external and DB sources by prose markers only", () => {
    const sources = [
      entry(1, "web", "https://external.example"),
      entry(2, "cds"),
      entry(3, "reddit", "https://reddit.com/r/ApplyingToCollege/comments/x"),
    ];

    expect(
      citedSourcesForMessage({
        blocks: [
          { kind: "markdown", text: "External [1]." },
          { kind: "viz", spec: renderSpec() },
          { kind: "markdown", text: "DB [2]." },
        ],
        sources,
      }).map((source) => source.index),
    ).toEqual([1, 2]);
  });

  test("DB-backed viz cells count as Counselle data even without DB source rows", () => {
    const message = {
      blocks: [{ kind: "viz" as const, spec: renderSpec() }],
      sources: [entry(1, "web", "https://external.example")],
    };

    expect(usedDbData(message)).toBe(true);
    expect(dbSchoolsForMessage(message)).toEqual(["North College"]);
  });

  test("stray cumulative DB source rows do not count as Counselle data", () => {
    const message = {
      blocks: [{ kind: "markdown" as const, text: "External [1]." }],
      sources: [
        entry(1, "web", "https://external.example"),
        entry(2, "cds"),
      ],
    };

    expect(usedDbData(message)).toBe(false);
    expect(dbSchoolsForMessage(message)).toEqual([]);
  });

  test("friendly source names use subreddit handle or host", () => {
    expect(
      friendlySourceName(
        citation({
          source: "reddit",
          url: "https://www.reddit.com/r/ApplyingToCollege/comments/x",
        }),
      ),
    ).toBe("r/ApplyingToCollege");
    expect(
      friendlySourceName(
        citation({ source: "web", url: "https://www.example.com/path" }),
      ),
    ).toBe("example.com");
  });
});
