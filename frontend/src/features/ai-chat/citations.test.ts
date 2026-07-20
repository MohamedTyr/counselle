import { describe, expect, test } from "vitest";

import type {
  Citation,
  CitationEnvelope,
  RenderSpec,
  SourceEntry,
} from "@/api/chat/types";
import {
  citedIndexesIn,
  schoolDomainsFromBlocks,
  sourceFocusForCell,
  sourcesUsedByMessage,
  uniqueSourceByIndex,
} from "./citations";

const SHA = "a".repeat(64);

function citation(source: Citation["source"] = "web"): Citation {
  if (source === "cds")
    return {
      v: 2,
      source,
      tier: "official",
      vintage: "CDS 2024-25",
      document_sha256: SHA,
      source_kind: "upload",
      retrieved_at: "2026-07-15T00:00:00Z",
      academic_year: 2024,
      manifest_version: "5.0.1",
      school_unitid: 1,
    };
  if (source === "profile")
    return {
      v: 2,
      source,
      tier: "official",
      vintage: "Snapshot 2024",
      school_unitid: 1,
      profile_sha256: SHA,
    };
  return {
    v: 2,
    source,
    tier: source === "reddit" ? "community" : "official",
    vintage: "Retrieved 2026",
    url: `https://${source}.example/a`,
  };
}

function entry(index: number, source: Citation["source"]): SourceEntry {
  return {
    v: 2,
    index,
    label: `${source} source`,
    citation: citation(source),
    evidence:
      source === "cds"
        ? [
            {
              eid: "admissions.rate",
              value_display: "12%",
              label: "Rate",
              page: 7,
              excerpt: "Rate 12%",
            },
          ]
        : [],
    evidence_omitted_count: 0,
  };
}

function cell(
  marker: string | null,
  source: Citation["source"] = "cds",
  available = true,
): CitationEnvelope {
  if (!available)
    return {
      v: 2,
      field: null,
      label: "Rate",
      display: "not available",
      raw: null,
      available: false,
      unit: null,
      citation: null,
      evidence: null,
      caveats: [],
      marker: null,
    };
  if (marker === null) throw new Error("available test cells require a marker");
  return {
    v: 2,
    field: "admissions.rate",
    label: "Rate",
    display: "12%",
    raw: 0.12,
    available: true,
    citation: citation(source),
    evidence:
      source === "cds"
        ? {
            eid: "admissions.rate",
            value_display: "12%",
            label: "Rate",
            page: 7,
            excerpt: "Rate 12%",
          }
        : null,
    caveats: [],
    marker,
  };
}

function viz(cells: CitationEnvelope[]): RenderSpec {
  return {
    v: 2,
    type: "comparison_table",
    title: "Rates",
    columns: cells.map((_, index) => ({
      unitid: index === 0 ? 1 : null,
      name: `School ${index}`,
    })),
    rows: [{ label: "Rate", cells }],
  };
}

describe("citation source selection", () => {
  test("parses positive markers of arbitrary width and ignores zero/code/links", () => {
    expect([
      ...citedIndexesIn(
        "Use [1], [1234], not [0], `[2]`, or [link](https://x.test/[3]).",
      ),
    ]).toEqual([1, 1234]);
  });

  test("unions prose and viz markers in registry order and excludes unused entries", () => {
    const sources = [
      entry(1, "web"),
      entry(2, "cds"),
      entry(3, "reddit"),
      entry(4, "profile"),
    ];
    expect(
      sourcesUsedByMessage({
        blocks: [
          { kind: "markdown", text: "Web [1]." },
          { kind: "viz", spec: viz([cell("[2]"), cell("[3]", "reddit")]) },
        ],
        sources,
      }).map(({ index }) => index),
    ).toEqual([1, 2, 3]);
  });

  test("includes viz-only CDS and ignores unavailable and opaque payloads", () => {
    const sources = [entry(2, "cds"), entry(4, "profile")];
    expect(
      sourcesUsedByMessage({
        blocks: [
          {
            kind: "viz",
            spec: viz([cell("[2]"), cell(null, "profile", false)]),
          },
          {
            kind: "viz",
            spec: { v: 2, type: "future", payload: { marker: "[4]" } },
          },
        ],
        sources,
      }).map(({ index }) => index),
    ).toEqual([2]);
  });

  test("fails closed on duplicate registry indexes", () => {
    const sources = [entry(1, "web"), entry(1, "edu")];
    expect(uniqueSourceByIndex(sources, 1)).toBeUndefined();
    expect(sourcesUsedByMessage({ text: "See [1].", sources })).toEqual([]);
  });

  test("CDS cells focus exact evidence while external and unavailable cells do not", () => {
    expect(sourceFocusForCell(cell("[123]"))).toEqual({
      index: 123,
      evidenceId: "admissions.rate",
    });
    expect(sourceFocusForCell(cell("[7]", "edu"))).toEqual({ index: 7 });
    expect(sourceFocusForCell(cell(null, "cds", false))).toBeUndefined();
  });
});

describe("schoolDomainsFromBlocks", () => {
  test("maps unitid to domain from tabular viz columns and ignores web-only columns", () => {
    const spec: RenderSpec = {
      v: 2,
      type: "comparison_table",
      title: "Rates",
      columns: [
        { unitid: 1, name: "Yale", domain: "yale.edu" },
        { unitid: null, name: "Some Blog" },
      ],
      rows: [{ label: "Rate", cells: [cell("[1]"), cell("[2]", "web")] }],
    };
    const domains = schoolDomainsFromBlocks([{ kind: "viz", spec }]);
    expect(domains.get(1)).toBe("yale.edu");
    expect(domains.size).toBe(1);
  });

  test("returns an empty map when no blocks are provided", () => {
    expect(schoolDomainsFromBlocks(undefined).size).toBe(0);
  });
});
