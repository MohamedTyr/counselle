import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FactDistributionChart } from "@/features/schools/facts/charts/FactDistributionChart";
import type { Fact } from "@/features/schools/facts/school-facts-types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * Honesty-critical: a bucket the school marked unreported (`-1` on the wire,
 * `absence: "not_reported"` once normalized) or a bucket its own schema
 * omitted entirely must never become a bar of width zero — that reads as
 * "0% of the class", a different and false claim from "we don't know"
 * (plan §5.1/§7).
 */

function distributionFact(overrides: Partial<Fact> = {}): Fact {
  return {
    key: "class_profile.sat_math_distribution",
    label: "SAT Math distribution",
    tab: "admission",
    state: "value",
    kind: "distribution",
    display: "3 of 4 buckets reported",
    unit: "percent",
    value: {
      scale: "SAT Math score",
      buckets: [
        { label: "700-800", pct: 40 },
        { label: "600-699", pct: 35 },
        { label: "500-599", absence: "not_reported", absence_display: "Not reported" },
      ],
      omitted_buckets: [{ label: "Below 500", display: "Not reported" }],
      sums_to: 75,
    },
    observed_at: "2026-01-01T00:00:00Z",
    reported_period: "2025-26",
    caveat_ids: [],
    ...overrides,
  };
}

describe("a distribution's -1/omitted buckets", () => {
  test("never enter the plotted points — they render as text instead", () => {
    /* jsdom gives the chart's ResponsiveContainer a 0x0 box, so Recharts
     * never paints its SVG children here — the accessible `figcaption`
     * summary (plain text, unaffected by layout) is what asserts which
     * buckets were actually plotted (plan §16.1: the shape is never the
     * only channel). */
    const { container } = render(<FactDistributionChart fact={distributionFact()} />);
    const summary = container.querySelector("figcaption")?.textContent ?? "";
    expect(summary).toContain("700-800: 40%");
    expect(summary).toContain("600-699: 35%");
    expect(summary).not.toContain("500-599");
    expect(summary).not.toContain("Below 500");

    /* The unreported and the omitted bucket both render as words, never as
     * a bar — "Not reported" appears exactly for those two labels. */
    expect(screen.getByText("500-599")).toBeInTheDocument();
    expect(screen.getByText("Below 500")).toBeInTheDocument();
    const notReported = screen.getAllByText("Not reported");
    expect(notReported).toHaveLength(2);
  });

  test("a fact with only unreported/omitted buckets renders no chart, only rows", () => {
    const fact = distributionFact({
      value: {
        scale: "SAT Math score",
        buckets: [
          { label: "700-800", absence: "not_reported", absence_display: "Not reported" },
        ],
        omitted_buckets: [{ label: "600-699", display: "Not reported" }],
        sums_to: null,
      },
    });
    const { container } = render(<FactDistributionChart fact={fact} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("700-800")).toBeInTheDocument();
    expect(screen.getByText("600-699")).toBeInTheDocument();
  });

  test("an absent-state fact renders nothing", () => {
    const fact = distributionFact({ state: "not_reported", value: null });
    const { container } = render(<FactDistributionChart fact={fact} />);
    expect(container.firstChild).toBeNull();
  });

  test("renders the wire's absence_display/display verbatim, never a literal of its own", () => {
    /* Finding 5 (Phase 2 review): the absence word for an unreported or
     * omitted bucket is composed once, server-side
     * (`app/facts/service.py`'s `_enrich_distribution`) -- this component
     * must render whatever the wire sent, not a hardcoded string. */
    const fact = distributionFact({
      value: {
        scale: "SAT Math score",
        buckets: [
          { label: "500-599", absence: "not_reported", absence_display: "Withheld by source" },
        ],
        omitted_buckets: [{ label: "Below 500", display: "Never published" }],
        sums_to: null,
      },
    });
    render(<FactDistributionChart fact={fact} />);
    expect(screen.getByText("Withheld by source")).toBeInTheDocument();
    expect(screen.getByText("Never published")).toBeInTheDocument();
    expect(screen.queryByText("Not reported")).toBeNull();
  });

  test("grep guard: no absence-word literal is authored in this component's source", () => {
    const source = readFileSync(
      path.join(__dirname, "FactDistributionChart.tsx"),
      "utf-8",
    );
    for (const literal of [
      "Not reported",
      "Not checked",
      "Not on file",
      "Not offered",
      "Not collected",
    ]) {
      expect(source).not.toContain(literal);
    }
  });
});
